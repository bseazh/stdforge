// 全国专业标准化技术委员会信息公示系统（org.sacinfo.org.cn:8088/tcrm）标委会通知爬取（案例7）
// 数据源：征集委员（recruit）、征集意见公示（suggest）、公告（announcement）
//   - 征集委员列表：/tcrm/cmrNotice/notice/list?menuItem=3&noticeType=recruit&businessType=BUILD&businessType=CHANGE
//   - 征集意见公示：/tcrm/cmrNotice/notice/list?menuItem=4&noticeType=suggest&businessType=BUILD&businessType=SECRETARIAT_ADJUST&businessType=CHANGE_PLAN
//   - 公告列表：    /tcrm/cmrNotice/announcement/list?menuItem=11
//   - 详情页：      /tcrm/html/{id}.html（标题/发布时间/正文/附件/加入按钮）
// 广东省市场监督管理局（amr.gd.gov.cn）搜索为 Vue SPA + search.gd.gov.cn JSONP，本环境不可达 → best-effort 降级
// 编码：站点声明 UTF-8，实测内容为 UTF-8（列表/详情均验证）

const TCRM_BASE = 'http://org.sacinfo.org.cn:8088/tcrm'
const NOTICE_LIST_PATH = `${TCRM_BASE}/cmrNotice/notice/list`
const ANNOUNCEMENT_LIST_PATH = `${TCRM_BASE}/cmrNotice/announcement/list`
const DETAIL_PREFIX = `${TCRM_BASE}/html/`

// 通知类型（二-③ 覆盖：筹建、换届、征集委员）
export const NOTICE_TYPES = {
  recruit: { label: '征集委员', businessTypes: ['BUILD', 'CHANGE'] },
  suggest: { label: '征集意见公示', businessTypes: ['BUILD', 'SECRETARIAT_ADJUST', 'CHANGE_PLAN'] },
  announcement: { label: '公告', businessTypes: [] },
}

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9',
  accept: 'text/html,application/xhtml+xml',
  referer: TCRM_BASE,
}

const delay = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(signal.reason ?? new DOMException('任务已终止', 'AbortError'))
    return
  }
  const timeout = setTimeout(resolve, milliseconds)
  signal?.addEventListener('abort', () => {
    clearTimeout(timeout)
    reject(signal.reason ?? new DOMException('任务已终止', 'AbortError'))
  }, { once: true })
})

const fetchText = async (url, { signal, retries = 2 } = {}) => {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(15_000)
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetch(url, { headers: DEFAULT_HEADERS, signal: combinedSignal })
      if (!response.ok) throw new Error(`标委会平台返回 HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < retries) await delay(700 * (attempt + 1), signal)
    }
  }
  throw lastError
}

const compactText = (value = '') => String(value || '')
  .replace(/\s+/g, ' ')
  .trim()

const decodeHtmlEntities = (value) => String(value || '')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")

const stripTags = (html) => String(html || '')
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/[\t ]+/g, ' ')
  .replace(/ +/g, ' ')

// ---------- 列表解析 ----------

// 从列表页提取单条通知：/tcrm/html/{id}.html 链接 + 发布日期/截止日期
const parseListRow = (block, { noticeType, businessType }) => {
  const hrefMatch = block.match(/href="(\/tcrm\/html\/(\d+)\.html)"/)
  const id = hrefMatch?.[2] || ''
  const title = compactText(decodeHtmlEntities(block.match(/href="\/tcrm\/html\/\d+\.html"[^>]*>\s*([\s\S]*?)\s*<\/a>/)?.[1]?.replace(/<[^>]+>/g, '') || ''))
    .replace(/^[・.\s]+/, '')
  if (!id || !title) return null
  const publishedAt = block.match(/发布日期：(\d{4}-\d{2}-\d{2})/)?.[1] || ''
  const deadline = block.match(/截止日期：(\d{4}-\d{2}-\d{2})/)?.[1] || ''
  const hasApply = /申请加入|我要加入/.test(block)
  return {
    id,
    title,
    noticeType,
    businessType,
    publishedAt,
    deadline,
    hasApply,
    url: `${DETAIL_PREFIX}${id}.html`,
  }
}

// 按通知类型抓取列表（默认一次拿全量 businessType；分页按 total/limit 控制）
export const crawlTcrmNotices = async ({
  keywords = [],
  noticeTypes = ['recruit', 'suggest'],
  maxPages = 1,
  pageSize = 100,
}, { signal } = {}) => {
  const safeKeywords = [...new Set((Array.isArray(keywords) ? keywords : []).map((s) => String(s).trim()).filter(Boolean))]
  const safeTypes = (Array.isArray(noticeTypes) ? noticeTypes : []).filter((t) => Object.hasOwn(NOTICE_TYPES, t))
  if (safeTypes.length === 0) throw new Error('至少需要一种通知类型（recruit/suggest/announcement）')
  const safeMaxPages = Math.min(Math.max(Number(maxPages) || 1, 1), 5)
  const safePageSize = Math.min(Math.max(Number(pageSize) || 100, 10), 200)

  const notices = new Map()
  const keywordStats = []
  const logs = []

  for (const type of safeTypes) {
    const { label, businessTypes } = NOTICE_TYPES[type]
    const baseUrl = type === 'announcement' ? ANNOUNCEMENT_LIST_PATH : NOTICE_LIST_PATH
    let totalHits = 0
    let fetched = 0
    for (let page = 1; page <= safeMaxPages; page += 1) {
      const params = new URLSearchParams()
      if (type !== 'announcement') {
        params.set('noticeType', type)
        params.set('menuItem', type === 'recruit' ? '3' : '4')
        for (const bt of businessTypes) params.append('businessType', bt)
      } else {
        params.set('menuItem', '11')
      }
      params.set('current', String(page))
      params.set('limit', String(safePageSize))
      const html = await fetchText(`${baseUrl}?${params}`, { signal })
      totalHits = Number(html.match(/id="total" value="(\d+)"/)?.[1] ?? 0)
      // 每条记录是一个 .line（或 .line wid2）块；注意源码存在 `class="line wid2" >`、`class="line wid2" style=""` 等变体
      const blocks = [...html.matchAll(/<div class="line[^"]*"[^>]*>([\s\S]*?)(?=<div class="line[^"]*"[^>]*>|<\/form>|<div class="foot)/g)]
        .map((m) => m[1])
      const pageRows = blocks
        .map((block) => parseListRow(block, { noticeType: type, businessType: '' }))
        .filter(Boolean)
      fetched += pageRows.length
      for (const row of pageRows) {
        const key = `${row.noticeType}:${row.id}`
        const existing = notices.get(key)
        if (existing) {
          // 保留更完整的日期与标题
          existing.title = existing.title || row.title
          existing.publishedAt = existing.publishedAt || row.publishedAt
          existing.deadline = existing.deadline || row.deadline
          existing.hasApply = existing.hasApply || row.hasApply
        } else {
          notices.set(key, row)
        }
      }
      if (pageRows.length < safePageSize || page * safePageSize >= totalHits) break
      await delay(900, signal)
    }
    keywordStats.push({ noticeType: type, label, totalHits, fetched })
    logs.push({
      level: totalHits > 0 ? '信息' : '警告',
      stage: '通知检索',
      message: `${label}命中 ${totalHits} 条，本次读取 ${fetched} 条`,
    })
    await delay(500, signal)
  }

  const all = [...notices.values()].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))

  // 关键词过滤（标题子串 + 全文仅过滤标题层；正文过滤留到详情补抓后）
  const matched = safeKeywords.length > 0
    ? all.filter((n) => safeKeywords.some((k) => n.title.includes(k)))
    : all
  logs.push({
    level: '成功',
    stage: '通知收集',
    message: `标委会通知去重后 ${all.length} 条，关键词「${safeKeywords.join(' / ')}」过滤后 ${matched.length} 条`,
  })

  return {
    source: { name: '全国专业标准化技术委员会信息公示系统', domain: 'org.sacinfo.org.cn', entryUrl: TCRM_BASE },
    query: { keywords: safeKeywords, noticeTypes: safeTypes, maxPages: safeMaxPages, pageSize: safePageSize },
    keywordStats,
    notices: matched,
    allNotices: all,
    logs,
    collectedAt: new Date().toISOString(),
  }
}

// ---------- 详情补抓 ----------

// 详情页显式键值/结构化字段抽取（正文 + 附件 + 加入按钮）
export const parseTcrmDetail = (html = '') => {
  const source = String(html || '')
  const title = compactText(decodeHtmlEntities(source.match(/<div\s+id\s*=\s*"showNoticeTitle"\s*[^>]*>\s*([\s\S]*?)\s*<\/div>/)?.[1] || ''))
  const publishedAt = source.match(/<div\s+id\s*=\s*"titleInfo"[^>]*>\s*发布时间：(\d{4}-\d{2}-\d{2})/)?.[1] || ''
  const contentHtml = source.match(/<div\s+id\s*=\s*"showNoticeContent"[^>]*>([\s\S]*?)(?=<div style="position:fixed|<div class="foot|<div class=" blank)/)?.[1] || ''
  const detailText = compactText(decodeHtmlEntities(stripTags(contentHtml)))
  // 附件下载（登记表模板等）
  const downloads = [...source.matchAll(/downloadFile\('([^']+)'\)[^>]*>\s*([^<]+)/g)]
    .map((m) => ({ path: m[1], name: compactText(m[2]) }))
  const hasJoin = /我要加入|申请加入/.test(source)
  return { title, publishedAt, detailText, downloads, hasJoin }
}

export const hydrateTcrmNotices = async (notices, { signal, concurrency = 4, maxItems = 40, onProgress = null } = {}) => {
  const safe = Array.isArray(notices) ? notices.slice(0, maxItems) : []
  const hydrated = new Array(safe.length)
  let cursor = 0
  let doneCount = 0

  const worker = async () => {
    while (cursor < safe.length) {
      const index = cursor
      cursor += 1
      const notice = safe[index]
      try {
        const html = await fetchText(notice.url, { signal })
        const detail = parseTcrmDetail(html)
        hydrated[index] = {
          ...notice,
          detailTitle: detail.title || notice.title,
          detailText: detail.detailText.slice(0, 6000),
          downloads: detail.downloads,
          hasJoin: detail.hasJoin || notice.hasApply,
          detailFetchStatus: 'completed',
        }
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error
        hydrated[index] = { ...notice, detailFetchStatus: 'error', detailFetchError: error instanceof Error ? error.message : '详情页读取失败' }
      }
      doneCount += 1
      if (typeof onProgress === 'function') onProgress({ done: doneCount, total: safe.length })
    }
  }

  const safeConcurrency = Math.min(Math.max(Number(concurrency) || 1, 1), 8)
  const workers = Array.from({ length: Math.min(safeConcurrency, safe.length || 1) }, () => worker())
  await Promise.all(workers)
  await delay(600, signal)
  return hydrated
}

// ---------- 广东省市场监督管理局（best-effort，本环境不可达时降级） ----------

const GD_AMR_BASE = 'https://amr.gd.gov.cn'
const GD_SEARCH_PAGE = `${GD_AMR_BASE}/gkmlpt/search`

export const crawlGdAmrNotices = async ({ keywords = [], maxPages = 1 }, { signal } = {}) => {
  const safeKeywords = [...new Set((Array.isArray(keywords) ? keywords : []).map((s) => String(s).trim()).filter(Boolean))]
  const safeMaxPages = Math.min(Math.max(Number(maxPages) || 1, 1), 3)
  const logs = []
  const notices = new Map()
  let reachable = true

  // search.gd.gov.cn 为 JSONP 接口；amr.gd.gov.cn/gkmlpt/search 为 Vue SPA
  // 本环境实测 search.gd.gov.cn 返回服务端错误页（不可达）→ 记录告警并返回空，不阻塞主流程
  for (const keyword of safeKeywords) {
    try {
      const timeoutSignal = AbortSignal.timeout(12_000)
      const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      const response = await fetch(`${GD_SEARCH_PAGE}?keywords=${encodeURIComponent(keyword)}&order=0&position=title`, {
        headers: DEFAULT_HEADERS,
        signal: combinedSignal,
      })
      const html = await response.text()
      if (!html || /错误|error|Bad Gateway|public_error/i.test(html.slice(0, 400))) {
        reachable = false
        logs.push({ level: '警告', stage: '广东市监局', message: `「${keyword}」搜索页返回异常（SPA/反爬/不可达），本次跳过（best-effort）` })
        continue
      }
      // SPA 首屏不含结果列表，真实数据来自 search.gd.gov.cn JSONP（需浏览器执行）；此处仅记录可达性
      logs.push({ level: '信息', stage: '广东市监局', message: `「${keyword}」搜索页可达，结果需浏览器渲染（二期接入 JSONP 契约）` })
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error
      reachable = false
      logs.push({ level: '警告', stage: '广东市监局', message: `「${keyword}」不可达：${error instanceof Error ? error.message : '网络错误'}（best-effort 跳过）` })
    }
    await delay(900, signal)
  }

  logs.push({
    level: reachable ? '成功' : '警告',
    stage: '广东市监局',
    message: reachable ? '广东市监局搜索页可达（二期接入结果解析）' : '广东市监局本环境不可达，本次使用全国标委会数据源（详见 案例7 配置说明）',
  })
  return {
    source: { name: '广东省市场监督管理局', domain: 'amr.gd.gov.cn', entryUrl: GD_SEARCH_PAGE },
    reachable,
    notices: [...notices.values()],
    logs,
    collectedAt: new Date().toISOString(),
  }
}
