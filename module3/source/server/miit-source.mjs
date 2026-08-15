const MIIT_BASE_URL = 'https://www.miit.gov.cn'
const MIIT_WEBSITE_ID = '110000000000000'
const MIIT_SEARCH_MANAGER_ID = '183'
const MIIT_POLICY_LIBRARY_URL = `${MIIT_BASE_URL}/search/zcwjk.html?websiteid=${MIIT_WEBSITE_ID}&pg=&p=&tpl=14&category=${MIIT_SEARCH_MANAGER_ID}&q=`
const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'accept-language': 'zh-CN,zh;q=0.9',
  accept: 'application/json, text/javascript, */*; q=0.01',
  referer: MIIT_POLICY_LIBRARY_URL,
  'x-requested-with': 'XMLHttpRequest',
}
const SELECT_FIELDS = [
  'title', 'title_text', 'content', 'infocontent', 'deploytime', 'createdate', 'cdate',
  'url', 'infoextends', 'columnname', 'filenumbername', 'publishgroupname', 'publishtime',
  'metaid', 'columnid', 'xxgkextend1', 'xxgkextend2', 'themename', 'typename', 'indexcode',
].join(',')

let categoryCache = null

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
      if (!response.ok) throw new Error(`工信部接口返回 HTTP ${response.status}`)
      const body = await response.json()
      if (!body?.success) throw new Error(body?.message || '工信部接口返回失败状态')
      return body
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < retries) await delay(500 * (attempt + 1), signal)
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
      if (!response.ok) throw new Error(`工信部详情页返回 HTTP ${response.status}`)
      return await response.text()
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < retries) await delay(500 * (attempt + 1), signal)
    }
  }
  throw lastError
}

const resolveCategoryId = async (signal) => {
  if (categoryCache && categoryCache.expiresAt > Date.now()) return categoryCache.id
  const params = new URLSearchParams({
    websiteid: MIIT_WEBSITE_ID,
    searchid: MIIT_SEARCH_MANAGER_ID,
  })
  const body = await fetchJson(`${MIIT_BASE_URL}/search-front-server/api/structure/list-category?${params}`, { signal })
  const categoryId = body?.data?.categories?.[0]?.iid
  if (!categoryId) throw new Error('未能解析工信部政策文件库的查询分类')
  categoryCache = { id: String(categoryId), expiresAt: Date.now() + 10 * 60_000 }
  return categoryCache.id
}

const decodeHtmlEntities = (value) => value
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))

const htmlToText = (html = '') => decodeHtmlEntities(String(html)
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  .replace(/<(?:br|hr)\s*\/?\s*>/gi, '\n')
  .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, '\n')
  .replace(/<[^>]+>/g, ''))
  .replace(/[\t\f\v ]+/g, ' ')
  .replace(/ *\n */g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

const parseExtendedContent = (raw) => {
  if (!raw) return ''
  try {
    const extension = JSON.parse(raw)
    const infoContent = typeof extension.infoContent === 'string'
      ? JSON.parse(extension.infoContent)
      : extension.infoContent
    return infoContent?.elementList?.find((item) => item.fieldName === 'content')?.fieldValue ?? ''
  } catch {
    return ''
  }
}

const extractAttachments = (html) => [...String(html).matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .map((match) => ({
    name: htmlToText(match[2]) || '附件',
    url: new URL(match[1], MIIT_BASE_URL).toString(),
  }))
  .filter((attachment, index, all) => all.findIndex((item) => item.url === attachment.url) === index)

const extractDetailContentHtml = (html) => {
  const source = String(html || '')
  const openingTag = source.match(/<div\b[^>]*\bid=["']con_con["'][^>]*>/i)
    || source.match(/<div\b[^>]*\bclass=["'][^"']*\bccontent\b[^"']*["'][^>]*>/i)
  if (!openingTag || openingTag.index === undefined) return ''

  const contentStart = openingTag.index + openingTag[0].length
  const divTag = /<\/?div\b[^>]*>/gi
  divTag.lastIndex = contentStart
  let depth = 1
  let match
  while ((match = divTag.exec(source))) {
    depth += /^<\/div/i.test(match[0]) ? -1 : 1
    if (depth === 0) return source.slice(contentStart, match.index)
  }
  return ''
}

const mergeAttachments = (...groups) => groups
  .flat()
  .filter((attachment, index, all) => all.findIndex((item) => item.url === attachment.url) === index)

const toOfficialUrl = (path) => {
  const url = new URL(path, MIIT_BASE_URL)
  if (!url.hostname.endsWith('miit.gov.cn')) throw new Error('政策详情链接不属于工信部官方域名')
  return url.toString()
}

const normalizePolicy = (result) => {
  const record = result?.groupData?.[0]?.data
  if (!record?.url) return null
  const contentHtml = parseExtendedContent(record.infoextends)
  const content = htmlToText(contentHtml || record.infocontent || '')
  return {
    id: result?.groupData?.[0]?.pkValue || record.metaid || record.indexcode || record.url,
    title: htmlToText(record.title_text || record.xxgkextend1 || record.title || '未命名政策'),
    url: toOfficialUrl(record.url),
    publishedAt: record.jsearch_date || (record.deploytime ? new Date(Number(record.deploytime)).toISOString().slice(0, 10) : ''),
    documentNumber: htmlToText(record.filenumbername || ''),
    publisher: htmlToText(record.publishgroupname || record.xxgkextend2 || '工业和信息化部'),
    documentType: htmlToText(record.typename || record.columnname || ''),
    theme: htmlToText(record.themename || ''),
    source: '工业和信息化部政策文件库',
    sourceDomain: 'miit.gov.cn',
    content,
    contentPreview: content.slice(0, 220),
    contentSource: 'search-snippet',
    attachments: extractAttachments(contentHtml),
  }
}

export const hydrateMiitPolicyDetails = async (policy, { signal } = {}) => {
  if (!policy?.url) return policy
  const url = new URL(policy.url)
  if (!url.hostname.endsWith('miit.gov.cn')) return policy

  try {
    const detailPageHtml = await fetchText(url.toString(), { signal })
    const contentHtml = extractDetailContentHtml(detailPageHtml)
    const content = htmlToText(contentHtml)
    if (!content) return { ...policy, contentFetchStatus: 'empty' }
    return {
      ...policy,
      content,
      contentPreview: content.slice(0, 220),
      contentSource: 'official-detail-page',
      contentFetchStatus: 'completed',
      attachments: mergeAttachments(policy.attachments || [], extractAttachments(contentHtml)),
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') throw error
    return {
      ...policy,
      contentFetchStatus: 'error',
      contentFetchError: error instanceof Error ? error.message : '详情页正文读取失败',
    }
  }
}

export const hydrateMiitPolicies = async (policies, { signal } = {}) => {
  const safePolicies = Array.isArray(policies) ? policies.slice(0, 20) : []
  const hydrated = []
  for (let index = 0; index < safePolicies.length; index += 3) {
    const batch = safePolicies.slice(index, index + 3)
    hydrated.push(...await Promise.all(batch.map((policy) => hydrateMiitPolicyDetails(policy, { signal }))))
  }
  return hydrated
}

const buildSearchUrl = ({ keyword, startDate, endDate, page, pageSize, categoryId }) => {
  const params = new URLSearchParams({
    websiteid: MIIT_WEBSITE_ID,
    scope: 'basic',
    q: keyword,
    pg: String(pageSize),
    cateid: categoryId,
    pos: 'title_text,infocontent,titlepy',
    _cus_eq_typename: '',
    _cus_eq_publishgroupname: '',
    _cus_eq_themename: '',
    begin: startDate,
    end: endDate,
    dateField: 'deploytime',
    selectFields: SELECT_FIELDS,
    group: 'distinct',
    highlightConfigs: '[{"field":"infocontent","numberOfFragments":2,"fragmentOffset":0,"fragmentSize":30,"noMatchSize":145}]',
    highlightFields: 'title_text,infocontent,webid',
    level: '6',
    sortFields: '[{"name":"deploytime","type":"desc"}]',
    p: String(page),
  })
  return `${MIIT_BASE_URL}/search-front-server/api/search/info?${params}`
}

const normalizeKeywords = (keywords) => [...new Set((Array.isArray(keywords) ? keywords : [])
  .map((keyword) => String(keyword).trim())
  .filter(Boolean))].slice(0, 8)

export const crawlMiitPolicies = async ({
  keywords,
  startDate,
  endDate,
  maxPages = 3,
  pageSize = 10,
}, { signal } = {}) => {
  const normalizedKeywords = normalizeKeywords(keywords)
  if (normalizedKeywords.length === 0) throw new Error('至少需要一个有效关键词')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('发布日期必须使用 YYYY-MM-DD 格式')
  }
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期')

  const safeMaxPages = Math.min(Math.max(Number(maxPages) || 1, 1), 5)
  const safePageSize = Math.min(Math.max(Number(pageSize) || 10, 1), 20)
  const categoryId = await resolveCategoryId(signal)
  const policies = new Map()
  const keywordStats = []
  const logs = [{ level: '成功', stage: '来源校验', message: `已连接工信部政策文件库，查询分类 ${categoryId}` }]

  for (const keyword of normalizedKeywords) {
    let totalHits = 0
    let fetched = 0
    for (let page = 1; page <= safeMaxPages; page += 1) {
      const body = await fetchJson(buildSearchUrl({
        keyword,
        startDate,
        endDate,
        page,
        pageSize: safePageSize,
        categoryId,
      }), { signal })
      const searchResult = body?.data?.searchResult
      totalHits = Number(searchResult?.totalHits ?? searchResult?.total ?? 0)
      const results = searchResult?.dataResults ?? []
      fetched += results.length
      for (const result of results) {
        const policy = normalizePolicy(result)
        if (policy) policies.set(policy.url, policy)
      }
      if (results.length < safePageSize || page * safePageSize >= totalHits) break
      await delay(800, signal)
    }
    keywordStats.push({ keyword, totalHits, fetched })
    logs.push({
      level: totalHits > 0 ? '信息' : '警告',
      stage: '关键词检索',
      message: totalHits > 0
        ? `“${keyword}”命中 ${totalHits} 条，本次读取 ${fetched} 条`
        : `“${keyword}”在所选发布日期范围内未命中政策`,
    })
    await delay(500, signal)
  }

  const sortedPolicies = [...policies.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  logs.push({ level: '成功', stage: '政策收集', message: `去重后取得 ${sortedPolicies.length} 条工信部官方政策` })

  return {
    source: {
      name: '工业和信息化部政策文件库',
      domain: 'miit.gov.cn',
      entryUrl: MIIT_POLICY_LIBRARY_URL,
      categoryId,
    },
    query: { keywords: normalizedKeywords, startDate, endDate, maxPages: safeMaxPages, pageSize: safePageSize },
    keywordStats,
    policies: sortedPolicies,
    logs,
    collectedAt: new Date().toISOString(),
  }
}
