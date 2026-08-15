// 全国标准信息公共服务平台（std.samr.gov.cn）标准数据爬取验证原型
// 接口：/gb/search/gbAdvancedSearchPage（GET，返回 JSON），与前端 bootstrap-table 使用同一接口
// 用法示例：
//   node crawl-samr.mjs --keywords "冰箱保鲜,无霜,化霜,微冻" --types gb,hb,plan --start 2021-01-01 --end 2026-08-15

const SAMR_BASE_URL = 'https://std.samr.gov.cn'
const SEARCH_ENDPOINT = `${SAMR_BASE_URL}/gb/search/gbAdvancedSearchPage`
const SIMPLE_SEARCH_PAGE = `${SAMR_BASE_URL}/search/stdPage`
// 各类型详情页路径（gb/hb 已真实验证；db 按同站规律，未验证时自动回退 gbDetailed）
const TYPE_DETAIL_PATH = {
  plan: '/gb/search/gbDetailed',
  gb: '/gb/search/gbDetailed',
  hb: '/hb/search/stdHBDetailed',
  db: '/db/search/stdDBDetailed',
}

const HBBA_BASE_URL = 'https://hbba.sacinfo.org.cn'
const HBBA_QUERY_ENDPOINT = `${HBBA_BASE_URL}/stdQueryList`
const HBBA_DETAIL_PREFIX = `${HBBA_BASE_URL}/stdDetail/`

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'accept-language': 'zh-CN,zh;q=0.9',
  accept: 'application/json, text/javascript, */*; q=0.01',
  referer: `${SAMR_BASE_URL}/gb/search/gbAdvancedSearch`,
  'x-requested-with': 'XMLHttpRequest',
}

// 检索类型与页面 tid 的对应关系（已验证：1=国家标准计划，2=国家标准，3=行业标准，4=地方标准）
const TYPE_TID = { plan: '1', gb: '2', hb: '3', db: '4' }
const TYPE_LABEL = { plan: '国家标准计划', gb: '国家标准', hb: '行业标准', db: '地方标准' }

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

const fetchJson = async (url, { signal, retries = 2 } = {}) => {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(15_000)
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetch(url, { headers: DEFAULT_HEADERS, signal: combinedSignal })
      if (!response.ok) throw new Error(`标准平台接口返回 HTTP ${response.status}`)
      const body = await response.json()
      if (!Array.isArray(body?.rows)) throw new Error('标准平台接口返回结构异常')
      return body
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < retries) await delay(700 * (attempt + 1), signal)
    }
  }
  throw lastError
}

const fetchText = async (url, { signal, retries = 2 } = {}) => {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(15_000)
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, accept: 'text/html,application/xhtml+xml' },
        signal: combinedSignal,
      })
      if (!response.ok) throw new Error(`标准详情页返回 HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < retries) await delay(700 * (attempt + 1), signal)
    }
  }
  throw lastError
}

const fetchJsonPost = async (url, body, { signal, retries = 1 } = {}) => {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const timeoutSignal = AbortSignal.timeout(15_000)
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...DEFAULT_HEADERS, 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body,
        signal: combinedSignal,
      })
      if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < retries) await delay(600 * (attempt + 1), signal)
    }
  }
  throw lastError
}

const splitList = (value) => [...new Set(String(value || '')
  .split(/[、,，;；]/)
  .map((item) => item.trim())
  .filter(Boolean))]

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

// tid 前缀 → 详情页路径（与 stdPage 页内脚本一致；已验证 BV_HB/BV_DB/BV_GB）
const detailUrlFromTid = (tid, pid) => {
  const base = tid === 'BV_HB'
    ? '/hb/search/stdHBDetailed'
    : tid === 'BV_DB'
      ? '/db/search/stdDBDetailed'
      : '/gb/search/gbDetailed'
  return `${SAMR_BASE_URL}${base}?id=${encodeURIComponent(pid)}`
}

const parsePostBlock = (block) => {
  const tid = block.match(/tid="([^"]+)"/)?.[1] || ''
  const pid = block.match(/pid="([^"]+)"/)?.[1] || ''
  const standardNo = compactText(block.match(/class="en-code">([^<]+)</)?.[1] || '')
  const linkText = block.match(/<a[^>]*\btid="BV_\w+"[^>]*>([\s\S]*?)<\/a>/)?.[1] || ''
  const title = compactText(decodeHtmlEntities(linkText.replace(/<[^>]+>/g, '')))
    .replace(new RegExp(`^${standardNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`), '')
  const status = compactText(block.match(/s-status[^>]*>([^<]+)</)?.[1] || '')
  const ics = compactText(block.match(/国际标准分类号（ICS）<\/span>\s*<span>([^<]*)</)?.[1] || '')
  const ccs = compactText(block.match(/中国标准分类号（CCS）<\/span>\s*<span>([^<]*)</)?.[1] || '')
  const titleEn = compactText(block.match(/英文标题<\/span>\s*<\/div>\s*<div class="media-body">\s*([\s\S]*?)\s*<\/div>/)?.[1] || '')
  const tc = compactText(block.match(/归口单位<\/span>[\s\S]*?<span rid="\d+">([^<]+)</)?.[1] || '')
  const publishedAt = compactText(block.match(/class="post-date"[^>]*>\s*([^<]*)\s*<\/time>/)?.[1]
    || block.match(/<time[^>]*>\s*([^<]*)\s*<\/time>/)?.[1] || '')
  if (!pid && !standardNo) return null
  return {
    id: pid,
    rawTid: tid,
    standardNo,
    title,
    titleEn,
    status,
    ics,
    ccs,
    tc,
    publishedAt,
    domain: tid === 'BV_HB' ? '行业标准' : tid === 'BV_DB' ? '地方标准' : tid === 'BV_GB' ? '国家标准' : '国家标准计划',
    url: pid ? detailUrlFromTid(tid, pid) : '',
    rawType: tid === 'BV_HB' ? 'hb' : tid === 'BV_DB' ? 'db' : tid === 'BV_GB' ? 'gb' : 'plan',
  }
}

const parseStdPageRows = (html) => {
  const source = decodeHtmlEntities(String(html || ''))
  const marker = 'class="panel panel-default post"'
  const blocks = []
  let cursor = 0
  while (true) {
    const start = source.indexOf(marker, cursor)
    if (start < 0) break
    const next = source.indexOf(marker, start + marker.length)
    blocks.push(source.slice(start, next < 0 ? source.length : next))
    cursor = start + marker.length
  }
  return blocks.map(parsePostBlock).filter(Boolean)
}

// 简单检索入口：/search/std?q= → /search/stdPage?q=&pageNo=（服务端渲染，混合类型，召回更广）
export const crawlSamrSimpleSearch = async ({
  keyword,
  maxPages = 1,
}, { signal } = {}) => {
  const safeKeyword = String(keyword || '').trim()
  if (!safeKeyword) throw new Error('至少需要一个有效关键词')
  const safeMaxPages = Math.min(Math.max(Number(maxPages) || 1, 1), 9)
  const standards = new Map()
  const logs = []
  let totalHits = 0

  for (let page = 1; page <= safeMaxPages; page += 1) {
    const url = `${SIMPLE_SEARCH_PAGE}?q=${encodeURIComponent(safeKeyword)}&tid=&pageNo=${page}`
    const html = await fetchText(url, { signal })
    const totalMatch = html.match(/为您找到相关结果约&nbsp;<span>(\d+)<\/span>/)
    totalHits = Number(totalMatch?.[1] ?? 0)
    const rows = parseStdPageRows(html)
    for (const row of rows) {
      const key = row.id ? `${row.rawTid}:${row.id}` : `${row.rawType}:${row.standardNo}:${row.title}`
      standards.set(key, row)
    }
    logs.push({
      level: rows.length > 0 ? '信息' : '警告',
      stage: '关键词检索',
      message: `简单检索“${safeKeyword}”第 ${page} 页取得 ${rows.length} 条（总计约 ${totalHits} 条）`,
    })
    if (rows.length < 10) break
    await delay(900, signal)
  }

  const sorted = [...standards.values()].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
  logs.push({ level: '成功', stage: '标准收集', message: `简单检索去重后取得 ${sorted.length} 条记录（混合类型）` })
  return {
    source: { name: '全国标准信息公共服务平台-简单检索', domain: 'std.samr.gov.cn', entryUrl: `${SAMR_BASE_URL}/search/std?q=${encodeURIComponent(safeKeyword)}` },
    query: { keyword: safeKeyword, maxPages: safeMaxPages },
    keywordStats: [{ keyword: safeKeyword, totalHits, fetched: sorted.length }],
    standards: sorted,
    logs,
    collectedAt: new Date().toISOString(),
  }
}

const toDetailUrl = (id, type) => `${SAMR_BASE_URL}${TYPE_DETAIL_PATH[type] || TYPE_DETAIL_PATH.gb}?id=${encodeURIComponent(id)}`

// 列表接口字段 → 案例8业务字段（字段名已通过真实响应验证）
const normalizeStandard = (row = {}, type) => {
  const id = row.id || row.DETAIL_ID || row.PROJECT_ID || ''
  const isPlan = type === 'plan'
  return {
    id,
    standardNo: compactText(row.C_STD_CODE || row.STD_CODE || row.C_PLAN_CODE || ''),
    title: compactText(row.C_C_NAME || row.C_NAME || ''),
    titleEn: compactText(row.C_E_NAME || row.E_NAME || ''),
    domain: compactText(row.STD_DOMAIN || row.G_STD_DOMAIN || TYPE_LABEL[type]),
    nature: compactText(row.STD_NATURE || row.G_STD_NATURE || ''),
    standardType: compactText(row.STD_TYPE || ''),
    status: compactText(row.STATE || row.STATE2 || row.G_STATE || ''),
    publishedAt: compactText(row.ISSUE_DATE || ''),
    effectiveAt: compactText(row.ACT_DATE || ''),
    deadline: compactText(row.END_DATE || ''),
    planForm: isPlan ? (row.STD_FORM === 'Z' ? '制定' : row.STD_FORM === 'X' ? '修订' : compactText(row.STD_FORM)) : '',
    planCode: compactText(row.C_PLAN_CODE || row.PLAN_CODE || ''),
    issueAnnouncementNo: compactText(row.ISSUE_ANN_NO || ''),
    issuer: compactText(row.CD_NAME || ''),
    reporter: compactText(row.UTA_NAME || ''),
    tc: compactText(row.TA_NAME || ''),
    tcCode: compactText(row.TA_CODE || ''),
    sc: compactText(row.TM_NAME || ''),
    scCode: compactText(row.TM_CODE || ''),
    draftUnits: splitList(row.DRAFT_UNIT),
    draftStaff: splitList(row.DRAFT_STAFF),
    ics: compactText(row.ICS || ''),
    icsFull: compactText(row.ICS_NAME1_FULL || ''),
    ccs: compactText(row.CCS || ''),
    adoptedType: compactText(row.ADOPT_TYPE || ''),
    replaces: compactText(row.TOTAL_REPE || ''),
    orgScope: compactText(row.ORG_SCOPE || ''),
    openDownload: row.OPEN_DOWNLOAD_STATUS === 1 || row.OPEN_STATUS === 1,
    url: id ? toDetailUrl(id, type) : '',
    rawType: type,
  }
}

const buildSearchUrl = ({ keyword, startDate, endDate, type, page, pageSize }) => {
  const params = new URLSearchParams({
    tid: TYPE_TID[type],
    std_p8: keyword, // 中文标准/项目名称
    std_p10: startDate, // 发布日期从
    std_p11: endDate, // 发布日期到
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  })
  return `${SEARCH_ENDPOINT}?${params}`
}

const normalizeKeywords = (keywords) => [...new Set((Array.isArray(keywords) ? keywords : [])
  .map((keyword) => String(keyword).trim())
  .filter(Boolean))].slice(0, 8)

const normalizeTypes = (types) => [...new Set((Array.isArray(types) ? types : [])
  .map((type) => String(type).trim())
  .filter((type) => Object.hasOwn(TYPE_TID, type)))].slice(0, 4)

export const crawlSamrStandards = async ({
  keywords,
  startDate,
  endDate,
  types = ['gb', 'hb', 'plan'],
  maxPages = 3,
  pageSize = 20,
  searchConcurrency = 3,
}, { signal } = {}) => {
  const normalizedKeywords = normalizeKeywords(keywords)
  const normalizedTypes = normalizeTypes(types)
  if (normalizedKeywords.length === 0) throw new Error('至少需要一个有效关键词')
  if (normalizedTypes.length === 0) throw new Error('至少需要一个有效标准类型（gb/hb/db/plan）')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('发布日期必须使用 YYYY-MM-DD 格式')
  }
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期')

  const safeMaxPages = Math.min(Math.max(Number(maxPages) || 1, 1), 5)
  const safePageSize = Math.min(Math.max(Number(pageSize) || 10, 1), 50)
  const safeSearchConcurrency = Math.min(Math.max(Number(searchConcurrency) || 1, 1), 6)
  const standards = new Map()
  const keywordStats = []
  const logs = [{ level: '成功', stage: '来源校验', message: '已连接全国标准信息公共服务平台高级检索接口' }]

  // 关键词×类型并发检索（默认 3 路，波间仍保留限速延时，避免对目标站点压力过大）
  const tasks = []
  for (const keyword of normalizedKeywords) {
    for (const type of normalizedTypes) {
      tasks.push({ keyword, type })
    }
  }
  const taskResults = new Array(tasks.length)
  let cursor = 0
  const worker = async () => {
    while (cursor < tasks.length) {
      const index = cursor
      cursor += 1
      const { keyword, type } = tasks[index]
      let totalHits = 0
      let fetched = 0
      const rows = []
      for (let page = 1; page <= safeMaxPages; page += 1) {
        const body = await fetchJson(buildSearchUrl({
          keyword, startDate, endDate, type, page, pageSize: safePageSize,
        }), { signal })
        totalHits = Number(body.total ?? 0)
        const pageRows = Array.isArray(body.rows) ? body.rows : []
        fetched += pageRows.length
        for (const row of pageRows) rows.push(normalizeStandard(row, type))
        if (pageRows.length < safePageSize || page * safePageSize >= totalHits) break
        await delay(900, signal)
      }
      await delay(500, signal)
      taskResults[index] = { keyword, type, totalHits, fetched, rows }
    }
  }
  await Promise.all(Array.from({ length: Math.min(safeSearchConcurrency, tasks.length || 1) }, () => worker()))

  // 按原始顺序合并结果与统计，保证输出与并发前一致
  for (const task of taskResults) {
    const { keyword, type, totalHits, fetched, rows } = task
    for (const standard of rows) {
      const key = standard.id ? `${standard.id}` : `${type}:${standard.standardNo}:${standard.title}`
      standards.set(key, standard)
    }
    keywordStats.push({ keyword, type, label: TYPE_LABEL[type], totalHits, fetched })
    logs.push({
      level: totalHits > 0 ? '信息' : '警告',
      stage: '关键词检索',
      message: `${TYPE_LABEL[type]}“${keyword}”命中 ${totalHits} 条，本次读取 ${fetched} 条`,
    })
  }

  const sorted = [...standards.values()].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
  logs.push({ level: '成功', stage: '标准收集', message: `并发 ${safeSearchConcurrency} 路检索完成，去重后取得 ${sorted.length} 条标准/计划记录` })

  return {
    source: {
      name: '全国标准信息公共服务平台',
      domain: 'std.samr.gov.cn',
      entryUrl: `${SAMR_BASE_URL}/gb/search/gbAdvancedSearch`,
      searchEndpoint: SEARCH_ENDPOINT,
    },
    query: { keywords: normalizedKeywords, types: normalizedTypes, startDate, endDate, maxPages: safeMaxPages, pageSize: safePageSize },
    keywordStats,
    standards: sorted,
    logs,
    collectedAt: new Date().toISOString(),
  }
}

// 详情页正文抽取：定位“主要起草单位 / 主要起草人 / 归口单位 / 主管部门”等信息块（原型用文本近似，生产建议用 DOM 解析）
const extractDetailText = (html = '') => compactText(String(html)
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/[\t ]+/g, ' ')
  .replace(/ +/g, ' '))

// 显式键值解析：只读取详情页中明确成对的 key→value 结构
// 1) <dt class="basicInfo-item name">KEY</dt><dd class="basicInfo-item value">VALUE</dd>
// 2) <h2 class="title-text">起草单位/起草人</h2> 后逐条 <dd class="basicInfo-item value">…</dd>
export const parseSamrDetailKeyValues = (html = '') => {
  const source = String(html || '')
  const result = {}
  const pairPattern = /<dt class="basicInfo-item name">([^<]+)<\/dt>[\s\S]*?<dd class="basicInfo-item value">([\s\S]*?)<\/dd>/gi
  let pair
  while ((pair = pairPattern.exec(source))) {
    const key = compactText(decodeHtmlEntities(pair[1]))
    const value = compactText(decodeHtmlEntities(pair[2].replace(/<[^>]+>/g, ' ')))
    if (key && value) result[key] = value
  }
  const sectionPattern = /<h2 class="title-text">([^<]+)<\/h2>([\s\S]*?)(?=<h2 class="title-text">|$)/gi
  let section
  while ((section = sectionPattern.exec(source))) {
    const name = compactText(section[1])
    if (name === '起草单位' || name === '起草人') {
      let items = [...section[2].matchAll(/<dd class="basicInfo-item value">([\s\S]*?)<\/dd>/gi)]
        .map((dd) => compactText(decodeHtmlEntities(dd[1].replace(/<[^>]+>/g, ' '))))
        .filter(Boolean)
      if (items.length === 0) {
        const paragraph = section[2].match(/<p>([\s\S]*?)<\/p>/)
        if (paragraph) items = [compactText(decodeHtmlEntities(paragraph[1].replace(/<[^>]+>/g, ' ')))]
      }
      if (items.length > 0) result[name] = items.join('、')
    }
  }
  return result
}

// 详情补抓：按 tid/类型取正确路径，并行拉取（默认并发 6，波间限速）
export const hydrateSamrStandardDetails = async (standards, { signal, concurrency = 6, maxItems = 40, onProgress = null } = {}) => {
  const safe = Array.isArray(standards) ? standards.slice(0, maxItems) : []
  const hydrated = new Array(safe.length)
  let cursor = 0
  let doneCount = 0

  const worker = async () => {
    while (cursor < safe.length) {
      const index = cursor
      cursor += 1
      const standard = safe[index]
      if (!standard?.url) {
        hydrated[index] = { ...standard, detailFetchStatus: 'skipped' }
        continue
      }
      try {
        const html = await fetchText(standard.url, { signal })
        const detailKeyValues = parseSamrDetailKeyValues(html)
        const detailText = extractDetailText(html)
        const draftUnitsFromKv = splitList(detailKeyValues['起草单位'] || '')
        hydrated[index] = {
          ...standard,
          draftUnits: (standard.draftUnits || []).length > 0 ? standard.draftUnits : draftUnitsFromKv,
          draftStaff: (standard.draftStaff || []).length > 0 ? standard.draftStaff : splitList(detailKeyValues['起草人'] || ''),
          tc: standard.tc || detailKeyValues['归口单位'] || '',
          issuer: standard.issuer || detailKeyValues['主管部门'] || detailKeyValues['批准发布部门'] || '',
          standardType: standard.standardType || detailKeyValues['标准类别'] || '',
          status: standard.status || detailKeyValues['标准状态'] || '',
          publishedAt: standard.publishedAt || detailKeyValues['发布日期'] || '',
          effectiveAt: standard.effectiveAt || detailKeyValues['实施日期'] || '',
          ics: standard.ics || detailKeyValues['国际标准分类号'] || '',
          ccs: standard.ccs || detailKeyValues['中国标准分类号'] || '',
          replaces: standard.replaces || detailKeyValues['代替标准'] || '',
          detailKeyValues,
          detailText: detailText.slice(0, 6000),
          detailFetchStatus: 'completed',
        }
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error
        hydrated[index] = { ...standard, detailFetchStatus: 'error', detailFetchError: error instanceof Error ? error.message : '详情页读取失败' }
      }
      doneCount += 1
      if (typeof onProgress === 'function') onProgress({ done: doneCount, total: safe.length })
    }
  }

  const safeConcurrency = Math.min(Math.max(Number(concurrency) || 1, 1), 12)
  const workers = Array.from({ length: Math.min(safeConcurrency, safe.length || 1) }, () => worker())
  await Promise.all(workers)
  await delay(600, signal)
  return hydrated
}

// 行业标准（hb）在 samr 列表与详情页均不提供起草单位，尝试从行业标准信息服务平台按标准号补抓（best-effort）
export const enrichHbbaDraftUnits = async (standards, { signal, maxItems = 20 } = {}) => {
  const targets = (Array.isArray(standards) ? standards : [])
    .filter((standard) => standard.rawType === 'hb' && (standard.draftUnits || []).length === 0 && standard.standardNo)
    .slice(0, maxItems)
  const enriched = []
  for (let index = 0; index < targets.length; index += 3) {
    const batch = targets.slice(index, index + 3)
    enriched.push(...await Promise.all(batch.map(async (standard) => {
      try {
        const body = await fetchJsonPost(
          HBBA_QUERY_ENDPOINT,
          new URLSearchParams({ current: '1', size: '5', key: standard.standardNo }).toString(),
          { signal, retries: 1 },
        )
        const record = (Array.isArray(body.records) ? body.records : [])
          .find((item) => String(item.code || '').replace(/\s/g, '') === standard.standardNo.replace(/\s/g, ''))
        if (!record?.pk) return { ...standard, hbbaStatus: 'not_found' }
        const html = await fetchText(`${HBBA_DETAIL_PREFIX}${record.pk}`, { signal, retries: 1 })
        const detailKeyValues = parseSamrDetailKeyValues(html)
        const draftUnits = splitList(detailKeyValues['起草单位'] || '')
        const draftStaff = splitList(detailKeyValues['起草人'] || '')
        return {
          ...standard,
          draftUnits: draftUnits.length > 0 ? draftUnits : standard.draftUnits,
          draftStaff: draftStaff.length > 0 ? draftStaff : standard.draftStaff,
          hbbaPk: record.pk,
          hbbaKeyValues: detailKeyValues,
          hbbaStatus: draftUnits.length > 0 ? 'completed' : 'empty',
        }
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error
        return { ...standard, hbbaStatus: 'error', hbbaError: error instanceof Error ? error.message : 'hbba 补抓失败' }
      }
    })))
    await delay(800, signal)
  }
  const map = new Map(enriched.map((item) => [item.id, item]))
  return (Array.isArray(standards) ? standards : []).map((item) => map.get(item.id) || item)
}

// ---------- LLM 结构化提取（复用 Policyanalysize 的 OpenAI Chat Completions 适配模式） ----------

const resolveChatCompletionsUrl = (baseUrl) => {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

const normalizeLlmExtraction = (value = {}) => ({
  draftUnits: Array.isArray(value.draftUnits) ? value.draftUnits.map(compactText).filter(Boolean) : [],
  draftStaff: Array.isArray(value.draftStaff) ? value.draftStaff.map(compactText).filter(Boolean) : [],
  tc: compactText(value.tc),
  sc: compactText(value.sc),
  issuer: compactText(value.issuer),
  standardType: compactText(value.standardType),
  techAreas: Array.isArray(value.techAreas) ? value.techAreas.map(compactText).filter(Boolean) : [],
  scope: compactText(value.scope),
  status: compactText(value.status),
  publishedAt: compactText(value.publishedAt),
  effectiveAt: compactText(value.effectiveAt),
  replaces: compactText(value.replaces),
  ics: compactText(value.ics),
  ccs: compactText(value.ccs),
  confidence: Number.isFinite(Number(value.confidence))
    ? Math.min(Math.max(Number(value.confidence), 0), 1)
    : 0,
  reasoning: compactText(value.reasoning || '模型未提供判断说明'),
  evidence: Array.isArray(value.evidence) ? value.evidence.map(compactText).filter(Boolean).slice(0, 5) : [],
})

const parseModelJson = (content) => {
  const text = Array.isArray(content)
    ? content.map((item) => item?.text || '').join('')
    : String(content || '')
  const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回有效 JSON')
  return JSON.parse(withoutFence.slice(start, end + 1))
}

const buildStandardLlmPrompt = (standard) => `你是一名标准情报分析助手。请以详情页文本为主、列表字段与页面显式键值（detailKeyValues）为辅，提取并校核该标准的完整结构化信息。

要求：
1. detailKeyValues 是页面明确成对的键值，优先采信；列表字段（draftUnits/status/日期等）来自官方检索接口，也可采信。
2. draftUnits/draftStaff 按详情页原文顺序输出完整列表，单位名称不得合并、拆分或臆造；详情缺失时保留列表字段或留空。
3. tc/sc 为归口技术委员会与执行分技术委员会；issuer 为主管部门。
4. standardType 只能是：产品标准、方法标准、基础标准、管理标准、其他。
5. techAreas 从标准名称、ICS/CCS、详情文本中识别技术领域，候选：保鲜、微冻、无霜、化霜、保湿、精准控温、智能保鲜、零度保鲜、能效、安全、其他，可多选。
6. scope 为 60 字以内的标准适用范围摘要；status/publishedAt/effectiveAt/replaces/ics/ccs 缺失时留空，不得编造。
7. confidence 为 0-1 的置信度；evidence 返回 1-5 条来自输入原文的简短依据，不得编造。

只返回一个 JSON 对象，不要返回 Markdown：
{
  "draftUnits": ["单位一", "单位二"],
  "draftStaff": ["起草人一"],
  "tc": "全国家用电器标准化技术委员会",
  "sc": "全国家用电器标准化技术委员会制冷空调器具分会",
  "issuer": "中国轻工业联合会",
  "standardType": "产品标准",
  "techAreas": ["保鲜"],
  "scope": "适用范围摘要",
  "status": "现行",
  "publishedAt": "2024-09-29",
  "effectiveAt": "2025-04-01",
  "replaces": "",
  "ics": "97.040.30",
  "ccs": "Y61",
  "confidence": 0.85,
  "reasoning": "判断说明",
  "evidence": ["依据一"]
}

标准 JSON：
${JSON.stringify(standard)}`

export const extractStandardWithLlm = async (standard, { config = {}, signal } = {}) => {
  const configured = Boolean(config.baseUrl && config.model && config.apiKey)
  if (!configured) {
    const kv = standard.detailKeyValues || {}
    return {
      ...standard,
      llmStatus: 'model_unconfigured',
      llmExtraction: null,
      draftUnits: (standard.draftUnits || []).length > 0 ? standard.draftUnits : splitList(kv['起草单位'] || ''),
      draftStaff: (standard.draftStaff || []).length > 0 ? standard.draftStaff : splitList(kv['起草人'] || ''),
      tc: standard.tc || kv['归口单位'] || '',
      issuer: standard.issuer || kv['主管部门'] || kv['批准发布部门'] || '',
      standardType: standard.standardType || kv['标准类别'] || '',
      status: standard.status || kv['标准状态'] || '',
      publishedAt: standard.publishedAt || kv['发布日期'] || '',
      effectiveAt: standard.effectiveAt || kv['实施日期'] || '',
      replaces: standard.replaces || kv['代替标准'] || '',
      ics: standard.ics || kv['国际标准分类号'] || '',
      ccs: standard.ccs || kv['中国标准分类号'] || '',
    }
  }
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(resolveChatCompletionsUrl(config.baseUrl), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: '你负责对标准公开信息做审慎的结构化提取，只能依据输入材料输出 JSON。' },
            { role: 'user', content: buildStandardLlmPrompt(standard) },
          ],
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `模型接口返回 HTTP ${response.status}`)
      if (!body?.choices?.[0]?.message) throw new Error('模型响应缺少 choices/message（可能为空响应）')
      const content = body.choices[0].message.content
      if (!content) throw new Error('模型返回空内容')
      const finishReason = body.choices[0].finish_reason
      const reasoningContent = body.choices[0].message.reasoning_content
      let extraction
      try {
        extraction = normalizeLlmExtraction(parseModelJson(content))
      } catch (error) {
        const raw = String(content || '').slice(0, 600)
        throw new Error(`${error.message}；finish=${finishReason}；contentLen=${String(content || '').length}；reasoningLen=${String(reasoningContent || '').length}；原始内容前600字：${raw}`)
      }
      return {
        ...standard,
        llmStatus: 'completed',
        llmExtraction: extraction,
        draftUnits: (standard.draftUnits || []).length > 0 ? standard.draftUnits : extraction.draftUnits,
        draftStaff: (standard.draftStaff || []).length > 0 ? standard.draftStaff : extraction.draftStaff,
        tc: standard.tc || extraction.tc || '',
        sc: standard.sc || extraction.sc || '',
        issuer: standard.issuer || extraction.issuer || '',
        standardType: standard.standardType || extraction.standardType || '',
        status: standard.status || extraction.status || '',
        publishedAt: standard.publishedAt || extraction.publishedAt || '',
        effectiveAt: standard.effectiveAt || extraction.effectiveAt || '',
        replaces: standard.replaces || extraction.replaces || '',
        ics: standard.ics || extraction.ics || '',
        ccs: standard.ccs || extraction.ccs || '',
      }
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < 2) await delay(3000 * (attempt + 1), signal)
    }
  }
  return { ...standard, llmStatus: 'error', llmError: lastError instanceof Error ? lastError.message : 'LLM 提取失败' }
}

export const extractStandardsWithLlm = async (standards, { config = {}, concurrency = 4, maxItems = 20, signal, onProgress = null } = {}) => {
  const safe = Array.isArray(standards) ? standards.slice(0, maxItems) : []
  const results = new Array(safe.length)
  let cursor = 0
  let doneCount = 0
  const worker = async () => {
    while (cursor < safe.length) {
      const index = cursor
      cursor += 1
      results[index] = await extractStandardWithLlm(safe[index], { config, signal })
      doneCount += 1
      if (typeof onProgress === 'function') onProgress({ done: doneCount, total: safe.length })
    }
  }
  const safeConcurrency = Math.min(Math.max(Number(concurrency) || 1, 1), 8)
  await Promise.all(Array.from({ length: Math.min(safeConcurrency, safe.length || 1) }, () => worker()))
  return results
}

// CLI 运行入口
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (isMain) {
  const parseArg = (name, fallback = '') => {
    const index = process.argv.indexOf(name)
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
  }
  const keywords = parseArg('--keywords', '').split(',').map((item) => item.trim()).filter(Boolean)
  const types = parseArg('--types', 'gb,hb,plan').split(',').map((item) => item.trim()).filter(Boolean)
  const startDate = parseArg('--start', '2021-01-01')
  const endDate = parseArg('--end', new Date().toISOString().slice(0, 10))
  const maxPages = Number(parseArg('--maxPages', '2'))
  const pageSize = Number(parseArg('--pageSize', '10'))
  const output = parseArg('--output', '')
  const enrichHb = process.argv.includes('--enrich-hb')
  const mode = parseArg('--mode', 'advanced')
  const hydrate = process.argv.includes('--hydrate')
  const extract = process.argv.includes('--extract')
  const concurrency = Number(parseArg('--concurrency', '6'))
  const searchConcurrency = Number(parseArg('--searchConcurrency', '3'))
  const llmConcurrency = Math.min(Math.max(Number(parseArg('--llmConcurrency', '3')) || 1, 1), 8)

  let result
  if (mode === 'simple' || mode === 'both') {
    const simpleResults = []
    for (const keyword of keywords) {
      simpleResults.push(await crawlSamrSimpleSearch({ keyword, maxPages }, {}))
    }
    const merged = new Map()
    for (const item of simpleResults) for (const standard of item.standards) merged.set(`${standard.rawTid}:${standard.id}`, standard)
    result = {
      source: { name: '全国标准信息公共服务平台-简单检索', domain: 'std.samr.gov.cn' },
      query: { keywords, mode: 'simple' },
      keywordStats: simpleResults.flatMap((item) => item.keywordStats),
      standards: [...merged.values()],
      logs: simpleResults.flatMap((item) => item.logs),
      collectedAt: new Date().toISOString(),
    }
  }
  if (mode === 'advanced' || mode === 'both') {
    const advanced = await crawlSamrStandards({ keywords, startDate, endDate, types, maxPages, pageSize, searchConcurrency })
    if (result) {
      const merged = new Map(result.standards.map((item) => [item.id, item]))
      for (const item of advanced.standards) merged.set(item.id, item)
      result = {
        ...result,
        query: { keywords, mode, startDate, endDate },
        standards: [...merged.values()],
        logs: [...result.logs, ...advanced.logs],
      }
    } else {
      result = advanced
    }
  }
  if (!result) throw new Error('mode 只能是 simple / advanced / both')

  if (enrichHb && result.standards.some((item) => item.rawType === 'hb')) {
    result = {
      ...result,
      standards: await enrichHbbaDraftUnits(result.standards),
      logs: [...result.logs, { level: '信息', stage: '起草单位补抓', message: '已对行业标准尝试从 hbba.sacinfo.org.cn 补抓起草单位（best-effort）' }],
    }
  }
  if (hydrate) {
    result = {
      ...result,
      standards: await hydrateSamrStandardDetails(result.standards, { concurrency }),
      logs: [...result.logs, { level: '信息', stage: '详情补抓', message: `已按并发 ${concurrency} 抓取详情页正文与起草单位` }],
    }
  }
  if (extract) {
    const llmConfig = {
      baseUrl: process.env.STD_LLM_BASE_URL || process.env.POLICY_LLM_BASE_URL || '',
      model: process.env.STD_LLM_MODEL || process.env.POLICY_LLM_MODEL || '',
      apiKey: process.env.STD_LLM_API_KEY || process.env.POLICY_LLM_API_KEY || '',
    }
    const extracted = await extractStandardsWithLlm(result.standards, { config: llmConfig, concurrency: llmConcurrency })
    result = {
      ...result,
      llmConfigured: Boolean(llmConfig.baseUrl && llmConfig.model && llmConfig.apiKey),
      standards: extracted,
      logs: [...result.logs, {
        level: '信息',
        stage: 'LLM 提取',
        message: llmConfig.baseUrl
          ? `已调用 ${llmConfig.model} 结构化提取 ${extracted.length} 条标准`
          : '未配置模型（STD_LLM_BASE_URL/STD_LLM_MODEL/STD_LLM_API_KEY），保留规则提取结果',
      }],
    }
  }
  const sample = result.standards.slice(0, 5).map((item) => ({
    standardNo: item.standardNo, title: item.title, status: item.status,
    publishedAt: item.publishedAt, domain: item.domain, nature: item.nature,
    tc: item.tc || item.detailTc?.join('、') || '', draftUnits: item.draftUnits,
    hbbaStatus: item.hbbaStatus || null, detailFetchStatus: item.detailFetchStatus || null,
    llmStatus: item.llmStatus || null, techAreas: item.llmExtraction?.techAreas || null,
    ics: item.ics, ccs: item.ccs, url: item.url,
  }))
  console.log(JSON.stringify({
    collectedAt: result.collectedAt,
    keywordStats: result.keywordStats,
    uniqueCount: result.standards.length,
    sample,
    logs: result.logs,
  }, null, 2))
  if (output) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(output, JSON.stringify(result, null, 2), 'utf8')
    console.log(`\n已写入 ${output}`)
  }
}
