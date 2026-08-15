// 预警模块管线（基础版）：关键词 × 类型（默认 gb/plan）→ 爬取 → LLM 提取
//   → 筛选新发布/即将实施国标（状态=即将实施 或 实施日期 > 今天）
//   → 计算距实施天数，标记 90/30/7 天节点
// 输出：{ alerts, upcoming, stats }
// 飞书推送、角色模板、推送记录、定时调度不在本迭代（架构预留扩展位）。
import { crawlSamrStandards, extractStandardsWithLlm } from './crawl-samr.mjs'

export const DEFAULT_ALERT_NODES = [90, 30, 7]

const DEFAULT_KEYWORDS = ['冰箱', '保鲜']
const DEFAULT_TYPES = ['gb', 'plan']

const today = () => new Date().toISOString().slice(0, 10)

// YYYY-MM-DD 相对今天的剩余天数（未来为正，过去为负，非法返回 null）
const daysUntil = (dateStr) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null
  const target = new Date(`${dateStr}T00:00:00Z`)
  const todayUtc = new Date(`${today()}T00:00:00Z`)
  return Math.ceil((target - todayUtc) / 86_400_000)
}

// 预警标记计算（独立函数，便于确定性单测）：状态=即将实施 或 实施日期 > 今天 → alert
export const computeAlertFlags = (standard, { nodes = DEFAULT_ALERT_NODES, newDays = 30 } = {}) => {
  const status = String(standard?.status || '')
  const effectiveAt = String(standard?.effectiveAt || standard?.llmExtraction?.effectiveAt || '')
  const publishedAt = String(standard?.publishedAt || '')
  const daysToEffective = daysUntil(effectiveAt)
  const statusUpcoming = status.includes('即将实施') || status.includes('即将')
  const isUpcoming = daysToEffective !== null && daysToEffective > 0
  const daysSincePublished = daysToEffective === null || !publishedAt ? null : -daysUntil(publishedAt)
  const isNewlyPublished = daysSincePublished !== null && daysSincePublished >= 0 && daysSincePublished <= newDays

  const sortedNodes = [...new Set((Array.isArray(nodes) ? nodes : []).map(Number).filter(Number.isFinite))].sort((a, b) => b - a)
  let alertNode = null
  const upcomingNodes = []
  if (daysToEffective !== null && daysToEffective > 0) {
    for (const node of sortedNodes) {
      if (daysToEffective <= node) upcomingNodes.push(node)
    }
    alertNode = upcomingNodes[upcomingNodes.length - 1] ?? null // 最近的一个节点（如 45 天 → 30）
  }

  return {
    alert: statusUpcoming || isUpcoming,
    statusUpcoming,
    isUpcoming,
    isNewlyPublished,
    daysToEffective,
    alertNode,
    upcomingNodes,
    urgent: daysToEffective !== null && daysToEffective > 0 && daysToEffective <= Math.min(...sortedNodes, Infinity),
    newDays,
  }
}

const normalizeAlertItem = (standard, flags) => ({
  standardNo: standard.standardNo || '',
  title: standard.title || '',
  status: standard.status || '',
  publishedAt: standard.publishedAt || '',
  effectiveAt: standard.effectiveAt || '',
  url: standard.url || '',
  domain: standard.domain || '',
  rawType: standard.rawType || '',
  llmStatus: standard.llmStatus || '',
  llmConfidence: standard.llmExtraction?.confidence ?? null,
  daysToEffective: flags.daysToEffective,
  alertNode: flags.alertNode,
  upcomingNodes: flags.upcomingNodes,
  isUpcoming: flags.isUpcoming,
  isNewlyPublished: flags.isNewlyPublished,
  urgent: flags.urgent,
})

export const runAlert = async ({
  keywords = DEFAULT_KEYWORDS,
  types = DEFAULT_TYPES,
  startDate = '2021-01-01',
  endDate = today(),
  maxPages = 1,
  pageSize = 20,
  maxItems = 24,
  searchConcurrency = 3,
  llmConcurrency = 5,
  llmConfig = null,
  alertNodes = DEFAULT_ALERT_NODES,
  newDays = 30,
  withLlm = true,
  onLog = null,
} = {}) => {
  const log = (stage, message) => {
    if (typeof onLog === 'function') onLog({ stage, message, time: new Date().toISOString() })
  }
  const taskStartedAt = new Date().toISOString()
  const startedAtMs = Date.now()
  const safeKeywords = [...new Set((Array.isArray(keywords) ? keywords : []).map((item) => String(item).trim()).filter(Boolean))]
  const safeTypes = (Array.isArray(types) ? types : []).filter((type) => ['gb', 'hb', 'db', 'plan'].includes(type))
  const safeMaxItems = Math.min(Math.max(Number(maxItems) || 1, 1), 60)
  const safeLlmConcurrency = Math.min(Math.max(Number(llmConcurrency) || 1, 1), 8)
  const safeNewDays = Math.max(Number(newDays) || 30, 1)

  log('检索', `关键词「${safeKeywords.join(' / ')}」× 类型「${safeTypes.join(' / ')}」窗口 ${startDate} ~ ${endDate}`)
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

  const flagged = standards.map((standard) => {
    const flags = computeAlertFlags(standard, { nodes: alertNodes, newDays: safeNewDays })
    return { standard, flags, item: normalizeAlertItem(standard, flags) }
  })
  const alerts = flagged
    .filter((entry) => entry.flags.alert)
    .map((entry) => entry.item)
    .sort((a, b) => {
      // 即将实施的按剩余天数从近到远，其余按发布日期从新到旧
      if (a.isUpcoming && b.isUpcoming) return (a.daysToEffective ?? Infinity) - (b.daysToEffective ?? Infinity)
      if (a.isUpcoming !== b.isUpcoming) return a.isUpcoming ? -1 : 1
      return (b.publishedAt || '').localeCompare(a.publishedAt || '')
    })
  const upcoming = alerts
    .filter((item) => item.isUpcoming)
    .sort((a, b) => (a.daysToEffective ?? Infinity) - (b.daysToEffective ?? Infinity))

  const byNode = {}
  for (const node of [...new Set((Array.isArray(alertNodes) ? alertNodes : []).map(Number).filter(Number.isFinite))]) {
    byNode[node] = alerts.filter((item) => item.alertNode === node).length
  }
  const byType = {}
  for (const item of alerts) byType[item.rawType || 'unknown'] = (byType[item.rawType || 'unknown'] || 0) + 1

  return {
    alerts,
    upcoming,
    stats: {
      taskTime: taskStartedAt,
      durationMs: Date.now() - startedAtMs,
      total: standards.length,
      alertCount: alerts.length,
      upcomingCount: upcoming.length,
      newlyPublishedCount: alerts.filter((item) => item.isNewlyPublished).length,
      byNode,
      byType,
      llmDurationMs,
      llmOk,
      llmFailed: standards.length - llmOk,
      keywordStats: crawl.keywordStats,
      query: crawl.query,
    },
  }
}
