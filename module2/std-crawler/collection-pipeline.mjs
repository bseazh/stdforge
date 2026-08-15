// 采集模块管线（基础版）：关键词 × 数据源/类型 → 爬取 → LLM 提取
//   → 规范化公告字段（标准号/标题/文号/发文机关/发布日期/实施日期/原文链接/摘要/标签）
//   → 相关度评分（标题命中×30 + 范围/标签命中×10 + ICS/CCS 白名单×40，0-100 封顶）
//   → 按阈值标记「⚠ 提醒」（默认 80）
// 输出：{ items, log: { 任务时间/数据源/新增条数/失败原因/LLM 耗时 }, stats }
// 领域配置（关键词/类型/ICS/CCS 白名单/阈值）统一来自 domain-config.mjs，可通过 domain-config.json 自定义
import { crawlSamrStandards, extractStandardsWithLlm } from './crawl-samr.mjs'
import { getDomain, getDefaultDomain, DEFAULT_DOMAIN, matchWhitelist } from './domain-config.mjs'

export const DEFAULT_RELEVANCE_THRESHOLD = getDefaultDomain().relevanceThreshold

const today = () => new Date().toISOString().slice(0, 10)

// 相关度评分（供采集模块与外部复用）：0-100 归一化，threshold 决定是否「⚠ 提醒」
// icsWhitelist/ccsWhitelist 不传或 null → 使用领域配置白名单；传 [] → 关闭该白名单
export const scoreRelevance = (standard, {
  keywords = [],
  domain = DEFAULT_DOMAIN,
  icsWhitelist = null,
  ccsWhitelist = null,
  threshold = DEFAULT_RELEVANCE_THRESHOLD,
} = {}) => {
  const domainConfig = getDomain(domain)
  const effectiveIcs = Array.isArray(icsWhitelist) ? icsWhitelist : domainConfig.icsWhitelist
  const effectiveCcs = Array.isArray(ccsWhitelist) ? ccsWhitelist : domainConfig.ccsWhitelist
  const title = String(standard?.title || '')
  const scope = String(standard?.llmExtraction?.scope || standard?.scope || standard?.orgScope || '')
  const tags = Array.isArray(standard?.llmExtraction?.techAreas) && standard.llmExtraction.techAreas.length > 0
    ? standard.llmExtraction.techAreas
    : (Array.isArray(standard?.techAreas) ? standard.techAreas : [])
  const safeKeywords = [...new Set((Array.isArray(keywords) ? keywords : [])
    .map((item) => String(item).trim())
    .filter(Boolean))]
  const titleHits = safeKeywords.filter((item) => title.includes(item)).length
  const textHits = safeKeywords.filter((item) => `${scope} ${tags.join(' ')}`.includes(item)).length
  const icsHit = matchWhitelist(standard?.ics, effectiveIcs)
  const ccsHit = matchWhitelist(standard?.ccs, effectiveCcs)
  const score = Math.min(100, titleHits * 30 + textHits * 10 + (icsHit || ccsHit ? 40 : 0))
  return {
    score,
    remind: score >= threshold,
    threshold,
    breakdown: { titleHits, textHits, icsHit, ccsHit },
  }
}

// 规范化公告字段：保留原始字段（status/ics/ccs/rawType 等）与 LLM 置信度，便于后续口径调整
const normalizeCollectionItem = (standard) => ({
  standardNo: standard.standardNo || '',
  title: standard.title || '',
  issueAnnouncementNo: standard.issueAnnouncementNo || '', // 文号
  issuer: standard.issuer || '',                          // 发文机关
  publishedAt: standard.publishedAt || '',
  effectiveAt: standard.effectiveAt || '',
  url: standard.url || '',
  scope: standard.llmExtraction?.scope || standard.scope || standard.orgScope || '',
  tags: standard.llmExtraction?.techAreas || standard.techAreas || [],
  status: standard.status || '',
  domain: standard.domain || '',
  standardType: standard.standardType || '',
  ics: standard.ics || '',
  ccs: standard.ccs || '',
  planForm: standard.planForm || '',
  planCode: standard.planCode || '',
  rawType: standard.rawType || '',
  llmStatus: standard.llmStatus || '',
  llmConfidence: standard.llmExtraction?.confidence ?? null,
})

export const runCollection = async ({
  domain = DEFAULT_DOMAIN,
  keywords = null,
  types = null,
  startDate = '2021-01-01',
  endDate = today(),
  maxPages = 1,
  pageSize = 20,
  maxItems = 24,
  searchConcurrency = 3,
  llmConcurrency = 5,
  llmConfig = null,
  relevanceThreshold = null,
  icsWhitelist = null,
  ccsWhitelist = null,
  withLlm = true,
  onLog = null,
} = {}) => {
  const domainConfig = getDomain(domain)
  const safeKeywords = [...new Set((Array.isArray(keywords) ? keywords : domainConfig.keywords)
    .map((item) => String(item).trim())
    .filter(Boolean))]
  const safeTypes = (Array.isArray(types) ? types : domainConfig.types)
    .filter((type) => ['gb', 'hb', 'db', 'plan'].includes(type))
  const safeThreshold = relevanceThreshold != null ? Number(relevanceThreshold) : domainConfig.relevanceThreshold
  const effectiveIcs = Array.isArray(icsWhitelist) ? icsWhitelist : domainConfig.icsWhitelist
  const effectiveCcs = Array.isArray(ccsWhitelist) ? ccsWhitelist : domainConfig.ccsWhitelist
  const safeMaxItems = Math.min(Math.max(Number(maxItems) || 1, 1), 60)
  const safeLlmConcurrency = Math.min(Math.max(Number(llmConcurrency) || 1, 1), 8)

  const log = (stage, message) => {
    if (typeof onLog === 'function') onLog({ stage, message, time: new Date().toISOString() })
  }
  const taskStartedAt = new Date().toISOString()
  const startedAtMs = Date.now()

  log('检索', `领域「${domainConfig.name}」关键词「${safeKeywords.join(' / ')}」× 类型「${safeTypes.join(' / ')}」窗口 ${startDate} ~ ${endDate}`)
  const crawl = await crawlSamrStandards({
    keywords: safeKeywords,
    startDate,
    endDate,
    types: safeTypes,
    maxPages,
    pageSize,
    searchConcurrency,
  })
  log('检索', `共命中去重 ${crawl.standards.length} 条（${crawl.keywordStats.map((s) => `${s.label}「${s.keyword}」${s.totalHits}`).join('；')}）`)

  let standards = crawl.standards.slice(0, safeMaxItems)
  let llmOk = 0
  const llmStart = Date.now()
  if (withLlm) {
    standards = await extractStandardsWithLlm(standards, {
      config: llmConfig || {},
      concurrency: safeLlmConcurrency,
      maxItems: safeMaxItems,
      onProgress: ({ done, total }) => {
        if (done % 4 === 0 || done === total) log('LLM 提取', `已结构化提取 ${done}/${total}`)
      },
    })
    llmOk = standards.filter((item) => item.llmStatus === 'completed').length
    log('LLM 提取', `成功 ${llmOk}/${standards.length}`)
  }
  const llmDurationMs = Date.now() - llmStart

  const items = standards.map((standard) => ({
    ...normalizeCollectionItem(standard),
    relevance: scoreRelevance(standard, {
      keywords: safeKeywords,
      domain,
      icsWhitelist: effectiveIcs,
      ccsWhitelist: effectiveCcs,
      threshold: safeThreshold,
    }),
  }))

  const byType = {}
  for (const item of items) byType[item.rawType || 'unknown'] = (byType[item.rawType || 'unknown'] || 0) + 1

  const failures = [
    ...items
      .filter((item) => item.llmStatus === 'error')
      .map((item) => ({ standardNo: item.standardNo, stage: 'LLM 提取', reason: item.llmError || '未知错误' })),
    ...crawl.logs
      .filter((entry) => entry.level === '警告')
      .map((entry) => ({ standardNo: '', stage: entry.stage, reason: entry.message })),
  ]

  return {
    items,
    log: {
      taskTime: taskStartedAt,
      durationMs: Date.now() - startedAtMs,
      sources: [crawl.source],
      totalCount: items.length,
      llmDurationMs,
      llmOk,
      llmFailed: items.length - llmOk,
      failures,
    },
    stats: {
      total: items.length,
      remindCount: items.filter((item) => item.relevance.remind).length,
      byType,
      keywordStats: crawl.keywordStats,
      query: crawl.query,
    },
  }
}
