// 采集+预警合并管线（每日采集预警）：外部标准自动采集 + 新国标发布自动预警推送
// 默认检索「最近一天」（Asia/Shanghai 时区）的全国标准信息公共服务平台数据；
// 可通过 reportDate 参数调整检索日期（用于补采历史日期，界面默认仍为最近一天）
// 流程：指定日期标准检索 → LLM 结构化提取 → 采集规范化 + 预警标记
//       → LLM 生成两份报告（采集报告 / 预警推送报告）→ 输出
// 默认只生成报告；LLM 审查（withReview=true / CLI --review）为可选项
// 输出：{ reportDate, collection, alert, reports, review, log, stats }
import { readFileSync } from 'node:fs'
import { crawlSamrStandards, extractStandardsWithLlm } from './crawl-samr.mjs'
import { scoreRelevance, DEFAULT_RELEVANCE_THRESHOLD } from './collection-pipeline.mjs'
import { computeAlertFlags, DEFAULT_ALERT_NODES } from './alert-pipeline.mjs'
import { getDomain, DEFAULT_DOMAIN } from './domain-config.mjs'

const DEFAULT_KEYWORDS = getDomain(DEFAULT_DOMAIN).keywords
const DEFAULT_TYPES = getDomain(DEFAULT_DOMAIN).types
const DEFAULT_MAX_ITEMS = 60

// Asia/Shanghai 时区下的「最近一天」：YYYY-MM-DD
export const yesterdayInShanghai = (now = new Date()) => {
  const formatShanghai = (date) => {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = formatter.formatToParts(date)
    const map = {}
    for (const part of parts) map[part.type] = part.value
    return `${map.year}-${map.month}-${map.day}`
  }
  const today = formatShanghai(now)
  // 上海时区今天 00:00 对应的时间戳减去一天，再按上海时区格式化，避免系统本地时区干扰
  const yesterday = new Date(Date.parse(`${today}T00:00:00+08:00`) - 86_400_000)
  return formatShanghai(yesterday)
}

// 校验并归一化报告检索日期：合法 YYYY-MM-DD 直接采用，否则回退最近一天
export const normalizeReportDate = (value) => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number)
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) return value
  }
  return yesterdayInShanghai()
}

// 报告日期对应的自然语言标签：默认（最近一天）→「最近一天」，自定义日期 → 直接显示日期
export const reportDateLabel = (reportDate) => (
  reportDate === yesterdayInShanghai() ? '最近一天' : reportDate
)

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

const resolveChatCompletionsUrl = (baseUrl) => {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

// 通用 LLM JSON 调用（带重试与超时，与 crawl-samr/analysis-pipeline 同款模式）
const chatJson = async (config, { system, user, temperature = 0.2, signal }) => {
  if (!(config?.baseUrl && config?.model && config?.apiKey)) {
    return { status: 'model_unconfigured', data: null }
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
          temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `模型接口返回 HTTP ${response.status}`)
      const content = body?.choices?.[0]?.message?.content
      if (!content) throw new Error('模型返回空内容')
      return { status: 'completed', model: config.model, data: parseModelJson(content) }
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 4000 * (attempt + 1)))
    }
  }
  return {
    status: 'error',
    error: lastError instanceof Error ? lastError.message : 'LLM 调用失败',
    data: null,
  }
}

// 采集条目（采集字段契约）
const normalizeCollectionItem = (standard, relevance) => ({
  standardNo: standard.standardNo || '',
  title: standard.title || '',
  issueAnnouncementNo: standard.issueAnnouncementNo || '',
  issuer: standard.issuer || '',
  publishedAt: standard.publishedAt || '',
  effectiveAt: standard.effectiveAt || '',
  url: standard.url || '',
  scope: standard.llmExtraction?.scope || standard.scope || standard.orgScope || '',
  tags: standard.llmExtraction?.techAreas || standard.techAreas || [],
  status: standard.status || '',
  domain: standard.domain || '',
  rawType: standard.rawType || '',
  planForm: standard.planForm || '',
  planCode: standard.planCode || '',
  llmStatus: standard.llmStatus || '',
  llmError: standard.llmError || '',
  relevance,
})

// 预警条目（预警字段契约）
const normalizeAlertItem = (standard, flags) => ({
  standardNo: standard.standardNo || '',
  title: standard.title || '',
  status: standard.status || '',
  publishedAt: standard.publishedAt || '',
  effectiveAt: standard.effectiveAt || '',
  url: standard.url || '',
  domain: standard.domain || '',
  rawType: standard.rawType || '',
  daysToEffective: flags.daysToEffective,
  alertNode: flags.alertNode,
  upcomingNodes: flags.upcomingNodes,
  isUpcoming: flags.isUpcoming,
  isNewlyPublished: flags.isNewlyPublished,
  urgent: flags.urgent,
})

// 构建采集报告提示词：仅依据输入真实数据，格式对齐《开发测试演示案例手册》期望输出
const buildCollectionNarrativePrompt = (context) => `你是一名标准情报分析师。请为《外部标准自动采集报告》生成标题、摘要和行动建议。报告的统计骨架（命中条数、相关度、新发布、明细表、日志）已由系统按真实数据生成，你只需生成叙述性内容。

硬性要求：
1. 只能引用下方 stats 中真实存在的数字与 items 中的标准号/标题/日期，禁止编造；0 条也要如实表述。
2. 报告日期为 ${context.reportDate}（${reportDateLabel(context.reportDate)}）。若为默认最近一天场景，不得使用「最近一天新增标准公告」表述；统一使用「${reportDateLabel(context.reportDate)}检索命中 … 条记录」；若 newlyPublishedCount=0 可写「${reportDateLabel(context.reportDate)}无新发布标准公告」。
3. 摘要 80 字以内，包含：检索命中条数、相关度≥threshold 条数、${reportDateLabel(context.reportDate)}新发布条数。
4. suggestions 为 2-3 条行动建议，每条 60 字以内，引用真实标准号或统计数字。

数据输入（JSON）：
${JSON.stringify(context, null, 2)}

只返回一个 JSON 对象，不要返回 Markdown：
{
  "title": "不超过 25 字的报告标题（含报告日期，如：外部标准自动采集报告（2026-08-14））",
  "summary": "80 字以内摘要",
  "suggestions": ["建议一", "建议二"]
}`

// 构建预警推送报告叙述提示词：仅生成标题/摘要/分角色推送/解读
const buildAlertNarrativePrompt = (context) => `你是一名标准合规与预警分析专家。请为《新国标发布自动预警推送报告》生成标题、摘要、分角色差异化推送文案与 AI 解读。报告的统计骨架（命中条数、预警/即将实施条数、新发布条数、即将实施列表、节点判断）已由系统按真实数据生成，你只需生成叙述性内容。

硬性要求：
1. 只能引用下方 stats 中真实存在的数字与 alerts 中的标准号/标题/日期，禁止编造；0 条也要如实表述。
2. 监测概况由系统生成，你的摘要不得与其数字冲突；统一口径：「${reportDateLabel(context.reportDate)}检索命中标准/计划记录 N 条，其中即将实施/预警 M 条；${reportDateLabel(context.reportDate)}新发布标准公告 X 条」。
3. pushRows 固定 4 行：张工（标准化）、王工（研发）、认证部、市场部；channel 固定「飞书消息 + 邮箱」；content 按角色关注点生成，必须引用 alerts 中的真实标准号与实施日期。
4. insights 为 2-3 条 AI 解读，每条 70 字以内，引用真实标准号或天数（daysToEffective）。

数据输入（JSON）：
${JSON.stringify(context, null, 2)}

只返回一个 JSON 对象，不要返回 Markdown：
{
  "title": "不超过 25 字的报告标题（含报告日期）",
  "summary": "80 字以内摘要",
  "pushRows": [
    {"role": "张工（标准化）", "channel": "飞书消息 + 邮箱", "content": "…"},
    {"role": "王工（研发）", "channel": "飞书消息 + 邮箱", "content": "…"},
    {"role": "认证部", "channel": "飞书消息 + 邮箱", "content": "…"},
    {"role": "市场部", "channel": "飞书消息 + 邮箱", "content": "…"}
  ],
  "insights": ["解读一", "解读二", "解读三"]
}`

// 采集报告：确定性骨架（统计数字全部由代码计算，LLM 只填充叙述部分）
const buildCollectionReportSkeleton = (context, narrative) => {
  const { reportDate, keywords, source, collection, alert } = context
  const threshold = context.relevanceThreshold ?? 80
  const items = collection.items || []
  const remind = items.filter((item) => item.relevance?.remind)
  const upcoming = alert?.upcoming || []
  const byType = collection.byType || {}
  const planFormStats = collection.planFormStats || {}
  const log = collection.log || {}
  const esc = (value) => String(value ?? '').replace(/\|/g, '／').replace(/\r?\n/g, ' ')
  // 标准号/标题文字可点击跳转原文
  const mdLink = (text, url) => (url ? `[${String(text ?? '—')}](${url})` : String(text ?? '—'))
  const remindRows = remind.map((item) => `| ${mdLink(item.standardNo, item.url)} | ${mdLink(esc(item.title), item.url)} | ${Math.round(item.relevance?.score || 0)} |`).join('\n')
  const upcomingRows = upcoming.map((item) => `| ${mdLink(item.standardNo, item.url)} | ${mdLink(esc(item.title), item.url)} | ${item.effectiveAt || '—'} | ${item.daysToEffective ?? '—'} |`).join('\n')
  const detailRows = items.map((item) => `| ${mdLink(item.standardNo, item.url)} | ${mdLink(esc(item.title), item.url)} | ${esc(item.issuer) || '—'} | ${esc(item.issueAnnouncementNo) || '—'} | ${item.publishedAt || '—'} | ${item.effectiveAt || '—'} | ${esc(item.scope) || '—'} | ${esc((item.tags || []).join('、')) || '—'} | ${Math.round(item.relevance?.score || 0)} | [查看](${item.url || '#'}) |`).join('\n')
  const typeRows = Object.entries(byType).map(([type, count]) => `| ${type === 'plan' ? '国家标准计划' : type === 'gb' ? '国家标准' : type === 'hb' ? '行业标准' : type === 'db' ? '地方标准' : type} | ${count} |`).join('\n')
  const planFormRows = Object.entries(planFormStats).map(([form, count]) => `| ${form} | ${count} |`).join('\n') || '| — | 0 |'
  const suggestions = Array.isArray(narrative.suggestions) && narrative.suggestions.length
    ? narrative.suggestions.map((item) => `- ${item}`).join('\n')
    : '- 无'
  return `# ${narrative.title || `外部标准自动采集报告（${reportDate}）`}

**报告日期**：${reportDate}${reportDateLabel(reportDate) === '最近一天' ? '（最近一天）' : ''}
**数据源**：${source?.name || '全国标准信息公共服务平台'}（${source?.domain || 'std.samr.gov.cn'}）
**检索关键词**：${keywords.join('、')}
**相关度阈值**：${threshold}%

## 📢 待办提醒

📢 ${reportDateLabel(reportDate)}检索命中标准/计划记录 **${collection.total}** 条，其中相关度≥${threshold}% 的有 **${collection.remindCount}** 条；${reportDateLabel(reportDate)}新发布标准公告 **${collection.newlyPublishedCount}** 条${collection.newlyPublishedCount === 0 ? `（${reportDateLabel(reportDate)}无新发布标准公告）` : ''}。

**相关度≥${threshold}% 的记录（${remind.length} 条）：**

| 标准号 | 标题 | 相关度 |
| --- | --- | --- |
${remindRows || '| — | 无 | — |'}

**⚠ 即将实施/预警标准（${upcoming.length} 条，与相关度阈值无关）：**

| 标准号 | 标题 | 实施日期 | 距实施天数 |
| --- | --- | --- | --- |
${upcomingRows || '| — | 无 | — | — |'}

## 一、采集明细表

| 标准号 | 标题 | 发文机关 | 文号 | 发布日期 | 实施日期 | 摘要 | 标签 | 相关度 | 原文链接 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${detailRows || `| — | ${reportDateLabel(reportDate)}无检索命中记录 | — | — | — | — | — | — | 0 | — |`}
## 二、按类型统计

| 类型 | 数量 |
| --- | --- |
${typeRows || '| — | 0 |'}

## 三、计划形式统计

| 计划形式 | 数量 |
| --- | --- |
${planFormRows}

## 四、采集日志

| 任务时间 | 数据源 | 检索命中条数 | LLM 处理耗时 | LLM 成功/失败 | 失败原因 |
| --- | --- | --- | --- | --- | --- |
| ${log.taskTime || '—'} | ${log.sources?.map((s) => s.domain).join('、') || 'std.samr.gov.cn'} | ${log.totalCount ?? collection.total} | ${log.llmDurationMs != null ? `${(Number(log.llmDurationMs) / 1000).toFixed(1)}s` : '—'} | ${log.llmOk ?? '—'}/${log.llmFailed ?? '—'} | ${log.failures?.length ? log.failures.map((f) => `${f.standardNo}:${f.reason}`).join('；') : '无'} |

## 五、行动建议

${suggestions}

> 说明：本报告「检索命中」指按关键词检索返回的记录（含历史发布标准与在审国家标准计划），并非全部为${reportDateLabel(reportDate)}新发布公告。`
}

// 预警推送报告：确定性骨架
const buildAlertReportSkeleton = (context, narrative) => {
  const { reportDate, keywords, source, alert } = context
  const hitTotal = alert.hitTotal ?? alert.total
  const upcoming = alert.upcoming || []
  const nodes = alert.alertNodes || []
  const byNode = alert.byNode || {}
  const esc = (value) => String(value ?? '').replace(/\|/g, '／').replace(/\r?\n/g, ' ')
  // 标准号/标题文字可点击跳转原文
  const mdLink = (text, url) => (url ? `[${String(text ?? '—')}](${url})` : String(text ?? '—'))
  const upcomingRows = upcoming.map((item) => `| ${mdLink(item.standardNo, item.url)} | ${mdLink(esc(item.title), item.url)} | ${item.effectiveAt || '—'} | ${item.daysToEffective ?? '—'} | ${item.alertNode ? `≤${item.alertNode}天` : '未触发'} | [查看](${item.url || '#'}) |`).join('\n')
  const nodeSummary = nodes.length
    ? nodes.map((node) => `${node}天 ${byNode[node] ?? 0} 条`).join(' / ')
    : '—'
  const pushRows = Array.isArray(narrative.pushRows) && narrative.pushRows.length
    ? narrative.pushRows.map((row) => `| ${row.role || '—'} | ${row.channel || '飞书消息 + 邮箱'} | ${esc(row.content) || '—'} |`).join('\n')
    : ''
  const insights = Array.isArray(narrative.insights) && narrative.insights.length
    ? narrative.insights.map((item, index) => `${index + 1}. ${item}`).join('\n')
    : ''
  return `# ${narrative.title || `新国标发布自动预警推送报告（${reportDate}）`}

**报告日期**：${reportDate}${reportDateLabel(reportDate) === '最近一天' ? '（最近一天）' : ''}
**监测来源**：${source?.name || '全国标准信息公共服务平台'}（${source?.domain || 'std.samr.gov.cn'}）
**检索关键词**：${keywords.join('、')}
**预警节点**：${nodeSummary}

## 一、监测概况

${reportDateLabel(reportDate)}检索命中标准/计划记录 **${hitTotal}** 条，其中即将实施/预警 **${alert.upcomingCount}** 条；${reportDateLabel(reportDate)}新发布标准公告 **${alert.newlyPublishedCount}** 条${alert.newlyPublishedCount === 0 ? `（${reportDateLabel(reportDate)}未监测到新发布标准公告）` : ''}。
${alert.upcomingCount === 0 ? '未监测到即将实施/预警标准。' : `预警节点分布：${nodeSummary}${upcoming.every((item) => !item.alertNode) ? '；当前即将实施记录均未触发 90/30/7 天预警节点。' : ''}`}

## 二、即将实施标准列表

| 标准号 | 标题 | 实施日期 | 距实施天数 | 预警节点 90/30/7 天 | 原文 |
| --- | --- | --- | --- | --- | --- |
${upcomingRows || '| — | 无 | — | — | — | — |'}

## 三、分角色差异化推送

| 接收角色 | 推送渠道 | 推送内容 |
| --- | --- | --- |
${pushRows}

## 四、AI 解读

${insights}

> 说明：预警节点仅在距实施 ≤ 90/30/7 天时触发；「即将实施」指实施日期晚于报告日期的记录。`
}

// 审查提示词：核对两份报告与原始数据的一致性、覆盖度与幻觉风险
const buildReviewPrompt = (context) => `你是报告质量审查员。请审查下面两份 AI 生成的报告是否与「原始检索数据」一致。

审查维度：
1. 数据一致性：报告中的标准号、标题、日期、相关度、条数与原始数据是否完全一致。
2. 覆盖完整性：相关度≥80% 或即将实施的标准是否遗漏。
3. 幻觉风险：报告是否出现原始数据之外的标准/数字/结论。
4. 格式规范：是否符合 Markdown 表格规范，是否包含要求的章节。

原始数据（JSON）：
${JSON.stringify(context.source, null, 2)}

采集报告：
${context.reports.collection}

预警推送报告：
${context.reports.alert}

只返回一个 JSON 对象：
{
  "status": "passed 或 needs_review",
  "issues": [{"level": "error|warn", "report": "collection|alert", "description": "问题描述（含标准号/字段）"}],
  "conclusion": "审查结论（80字以内）",
  "confidence": 0.9
}`

export const runCase56 = async ({
  keywords = DEFAULT_KEYWORDS,
  types = DEFAULT_TYPES,
  relevanceThreshold = DEFAULT_RELEVANCE_THRESHOLD,
  alertNodes = DEFAULT_ALERT_NODES,
  maxItems = DEFAULT_MAX_ITEMS,
  searchConcurrency = 3,
  llmConcurrency = 5,
  llmConfig = null,
  withLlm = true,
  withReview = false, // 只生成报告：默认不做 LLM 审查，需要时显式开启
  reportDate: requestedReportDate = null, // 可配置检索日期（YYYY-MM-DD）；缺省/非法时回退最近一天
  onLog = null,
} = {}) => {
  const log = (stage, message) => {
    if (typeof onLog === 'function') onLog({ stage, message, time: new Date().toISOString() })
  }
  const reportDate = normalizeReportDate(requestedReportDate)
  const dateLabel = reportDateLabel(reportDate)
  const taskStartedAt = new Date().toISOString()
  const startedAtMs = Date.now()
  const safeKeywords = [...new Set((Array.isArray(keywords) ? keywords : []).map((item) => String(item).trim()).filter(Boolean))]
  const safeTypes = (Array.isArray(types) ? types : []).filter((type) => ['gb', 'hb', 'db', 'plan'].includes(type))
  const safeMaxItems = Math.min(Math.max(Number(maxItems) || 1, 1), 60)
  const safeLlmConcurrency = Math.min(Math.max(Number(llmConcurrency) || 1, 1), 8)
  const safeThreshold = Math.min(Math.max(Number(relevanceThreshold) || DEFAULT_RELEVANCE_THRESHOLD, 0), 100)
  const safeNodes = [...new Set((Array.isArray(alertNodes) ? alertNodes : []).map(Number).filter(Number.isFinite))].sort((a, b) => b - a)

  log('配置', `采集+预警合并执行：检索日期 ${reportDate}（${dateLabel}），关键词「${safeKeywords.join(' / ')}」，类型「${safeTypes.join(' / ')}」，相关度阈值 ${safeThreshold}，预警节点 ${safeNodes.join('/')} 天`)

  // 1. 指定日期标准检索
  const crawl = await crawlSamrStandards({
    keywords: safeKeywords,
    startDate: reportDate,
    endDate: reportDate,
    types: safeTypes,
    maxPages: 1,
    pageSize: 50,
    searchConcurrency,
  })
  log('检索', `${dateLabel}（${reportDate}）共命中去重 ${crawl.standards.length} 条（${crawl.keywordStats.map((s) => `${s.label}「${s.keyword}」${s.totalHits}`).join('；')}）`)

  // 2. LLM 结构化提取
  let standards = crawl.standards.slice(0, safeMaxItems)
  let llmOk = 0
  const llmStart = Date.now()
  if (withLlm) {
    standards = await extractStandardsWithLlm(standards, {
      config: llmConfig || {},
      concurrency: safeLlmConcurrency,
      maxItems: safeMaxItems,
      onProgress: ({ done, total }) => {
        if (done % 5 === 0 || done === total) log('LLM 提取', `已结构化提取 ${done}/${total}`)
      },
    })
    llmOk = standards.filter((item) => item.llmStatus === 'completed').length
    log('LLM 提取', `成功 ${llmOk}/${standards.length}`)
  }
  const llmDurationMs = Date.now() - llmStart

  // 3. 采集规范化 + 预警标记
  const collectionItems = standards.map((standard) => normalizeCollectionItem(
    standard,
    scoreRelevance(standard, { keywords: safeKeywords, threshold: safeThreshold }),
  ))
  const flagged = standards.map((standard) => {
    const flags = computeAlertFlags(standard, { nodes: safeNodes, newDays: 7 })
    return { standard, flags, item: normalizeAlertItem(standard, flags) }
  })
  const alerts = flagged
    .filter((entry) => entry.flags.alert)
    .map((entry) => entry.item)
    .sort((a, b) => (a.daysToEffective ?? Infinity) - (b.daysToEffective ?? Infinity))
  const upcoming = alerts
    .filter((item) => item.isUpcoming)
    .sort((a, b) => (a.daysToEffective ?? Infinity) - (b.daysToEffective ?? Infinity))
  const remindItems = collectionItems.filter((item) => item.relevance.remind)
  log('处理', `采集条目 ${collectionItems.length} 条（相关度≥${safeThreshold} 提醒 ${remindItems.length} 条）；预警 ${alerts.length} 条（即将实施 ${upcoming.length} 条）`)

  const byType = {}
  for (const item of collectionItems) byType[item.rawType || 'unknown'] = (byType[item.rawType || 'unknown'] || 0) + 1
  const planFormStats = {}
  for (const item of collectionItems) planFormStats[item.planForm || '未知'] = (planFormStats[item.planForm || '未知'] || 0) + 1
  const byNode = {}
  for (const node of safeNodes) byNode[node] = alerts.filter((item) => item.alertNode === node).length
  const failures = collectionItems
    .filter((item) => item.llmStatus === 'error')
    .map((item) => ({ standardNo: item.standardNo, stage: 'LLM 提取', reason: item.llmError || '未知错误' }))

  // 4. LLM 生成两份报告
  const reportContext = {
    reportDate,
    keywords: safeKeywords,
    types: safeTypes,
    relevanceThreshold: safeThreshold,
    alertNodes: safeNodes,
    source: {
      name: '全国标准信息公共服务平台',
      domain: 'std.samr.gov.cn',
      entryUrl: crawl.source.entryUrl,
      query: crawl.query,
    },
    collection: {
      total: collectionItems.length,
      remindCount: remindItems.length,
      byType,
      planFormStats,
      newlyPublishedCount: collectionItems.filter((item) => item.publishedAt === reportDate).length,
      items: collectionItems.slice(0, 60),
      log: {
        taskTime: taskStartedAt,
        sources: [crawl.source],
        totalCount: collectionItems.length,
        llmDurationMs,
        llmOk,
        llmFailed: collectionItems.length - llmOk,
        failures,
      },
    },
    alert: {
      total: alerts.length,
      hitTotal: collectionItems.length,
      upcomingCount: upcoming.length,
      alertNodes: safeNodes,
      byNode,
      newlyPublishedCount: collectionItems.filter((item) => item.publishedAt === reportDate).length,
      alerts,
      upcoming,
    },
  }

  const reports = { collection: null, alert: null }
  log('LLM 报告', '开始生成《外部标准自动采集报告》…')
  const collectionNarrative = await chatJson(llmConfig, {
    system: '你只依据输入的真实数据撰写报告，禁止编造标准、日期或数字。',
    user: buildCollectionNarrativePrompt({
      reportDate: reportContext.reportDate,
      keywords: reportContext.keywords,
      stats: {
        total: reportContext.collection.total,
        remindCount: reportContext.collection.remindCount,
        newlyPublishedCount: reportContext.collection.newlyPublishedCount,
        threshold: safeThreshold,
      },
      items: reportContext.collection.items.slice(0, 12).map((item) => ({
        standardNo: item.standardNo,
        title: item.title,
        publishedAt: item.publishedAt,
        effectiveAt: item.effectiveAt,
        score: item.relevance?.score,
      })),
    }),
    temperature: 0.2,
  })
  const collectionNarrativeData = collectionNarrative.status === 'completed' ? collectionNarrative.data || {} : {}
  if (collectionNarrative.status === 'completed') {
    const narrative = {
      title: String(collectionNarrativeData.title || '').trim(),
      summary: String(collectionNarrativeData.summary || '').trim(),
      suggestions: Array.isArray(collectionNarrativeData.suggestions)
        ? collectionNarrativeData.suggestions.map(String).filter(Boolean).slice(0, 3)
        : [],
    }
    reports.collection = {
      title: narrative.title || `外部标准自动采集报告（${reportDate}）`,
      markdown: buildCollectionReportSkeleton(reportContext, narrative),
      summary: narrative.summary || `${dateLabel}（${reportDate}）检索命中标准/计划记录 ${collectionItems.length} 条，其中相关度≥${safeThreshold} 提醒 ${remindItems.length} 条；${dateLabel}新发布标准公告 ${reportContext.collection.newlyPublishedCount} 条。`,
      model: collectionNarrative.model,
    }
    log('LLM 报告', `采集报告生成完成：${reports.collection.title}`)
  } else {
    reports.collection = {
      title: `外部标准自动采集报告（${reportDate}）`,
      markdown: buildCollectionReportSkeleton(reportContext, {
        title: `外部标准自动采集报告（${reportDate}）`,
        suggestions: [`建议标准化部核对相关度≥${safeThreshold} 的 ${remindItems.length} 条记录并纳入重点跟踪。`],
      }),
      summary: `${dateLabel}（${reportDate}）检索命中标准/计划记录 ${collectionItems.length} 条，其中相关度≥${safeThreshold} 提醒 ${remindItems.length} 条；${dateLabel}新发布标准公告 ${collectionItems.filter((item) => item.publishedAt === reportDate).length} 条。`,
      model: null,
      error: collectionNarrative.error || (collectionNarrative.status === 'model_unconfigured' ? 'LLM 未配置，降级为结构化摘要' : 'LLM 报告生成失败，降级为结构化摘要'),
    }
    log('LLM 报告', `采集报告降级：${reports.collection.error}`)
  }

  log('LLM 报告', '开始生成《新国标发布自动预警推送报告》…')
  const alertNarrative = await chatJson(llmConfig, {
    system: '你只依据输入的真实数据撰写报告，禁止编造标准、日期或数字。',
    user: buildAlertNarrativePrompt({
      reportDate: reportContext.reportDate,
      keywords: reportContext.keywords,
      stats: {
        hitTotal: reportContext.alert.hitTotal,
        upcomingCount: reportContext.alert.upcomingCount,
        newlyPublishedCount: reportContext.alert.newlyPublishedCount,
        nodes: safeNodes,
      },
      alerts: reportContext.alert.alerts.map((item) => ({
        standardNo: item.standardNo,
        title: item.title,
        effectiveAt: item.effectiveAt,
        daysToEffective: item.daysToEffective,
        alertNode: item.alertNode,
      })),
    }),
    temperature: 0.2,
  })
  const alertNarrativeData = alertNarrative.status === 'completed' ? alertNarrative.data || {} : {}
  if (alertNarrative.status === 'completed') {
    const narrative = {
      title: String(alertNarrativeData.title || '').trim(),
      summary: String(alertNarrativeData.summary || '').trim(),
      pushRows: Array.isArray(alertNarrativeData.pushRows) ? alertNarrativeData.pushRows.slice(0, 4) : [],
      insights: Array.isArray(alertNarrativeData.insights)
        ? alertNarrativeData.insights.map(String).filter(Boolean).slice(0, 3)
        : [],
    }
    reports.alert = {
      title: narrative.title || `新国标发布自动预警推送报告（${reportDate}）`,
      markdown: buildAlertReportSkeleton(reportContext, narrative),
      summary: narrative.summary || `${dateLabel}（${reportDate}）检索命中标准/计划记录 ${collectionItems.length} 条，其中即将实施/预警 ${alerts.length} 条；${dateLabel}新发布标准公告 ${reportContext.alert.newlyPublishedCount} 条。`,
      model: alertNarrative.model,
    }
    log('LLM 报告', `预警推送报告生成完成：${reports.alert.title}`)
  } else {
    reports.alert = {
      title: `新国标发布自动预警推送报告（${reportDate}）`,
      markdown: buildAlertReportSkeleton(reportContext, {
        title: `新国标发布自动预警推送报告（${reportDate}）`,
        pushRows: alerts.length ? [{
          role: '张工（标准化）',
          channel: '飞书消息 + 邮箱',
          content: `${dateLabel}监测到即将实施标准 ${alerts.length} 条，请及时获取批准发布文本并更新标准库。`,
        }] : [],
        insights: [`${dateLabel}（${reportDate}）检索命中标准/计划记录 ${collectionItems.length} 条，其中即将实施/预警 ${alerts.length} 条，均未触发 90/30/7 天预警节点。`],
      }),
      summary: `${dateLabel}（${reportDate}）监测到预警 ${alerts.length} 条，其中即将实施 ${upcoming.length} 条。`,
      model: null,
      error: alertNarrative.error || (alertNarrative.status === 'model_unconfigured' ? 'LLM 未配置，降级为结构化摘要' : 'LLM 报告生成失败，降级为结构化摘要'),
    }
    log('LLM 报告', `预警推送报告降级：${reports.alert.error}`)
  }

  // 5. LLM 审查（写完先审查）
  let review = { status: 'pending', issues: [], conclusion: '尚未审查', confidence: 0 }
  if (withReview) {
    log('LLM 审查', '开始审查两份报告…')
    const reviewResult = await chatJson(llmConfig, {
      system: '你是严格的报告质量审查员，只能依据输入数据给出审查结论，不得臆断。',
      user: buildReviewPrompt({
        source: {
          reportDate,
          collection: {
            total: collectionItems.length,
            remindCount: remindItems.length,
            newlyPublishedCount: reportContext.collection.newlyPublishedCount,
            threshold: safeThreshold,
            items: collectionItems,
            log: reportContext.collection.log,
          },
          alert: {
            total: alerts.length,
            hitTotal: collectionItems.length,
            newlyPublishedCount: reportContext.alert.newlyPublishedCount,
            upcoming,
            alerts,
          },
        },
        reports: { collection: reports.collection.markdown, alert: reports.alert.markdown },
      }),
      temperature: 0.1,
    })
    if (reviewResult.status === 'completed' && reviewResult.data) {
      review = {
        status: String(reviewResult.data.status || 'needs_review').trim() === 'passed' ? 'passed' : 'needs_review',
        issues: Array.isArray(reviewResult.data.issues) ? reviewResult.data.issues.slice(0, 20) : [],
        conclusion: String(reviewResult.data.conclusion || '').trim() || '审查完成',
        confidence: Number(reviewResult.data.confidence) || 0,
        model: reviewResult.model,
      }
      log('LLM 审查', `审查完成：${review.status === 'passed' ? '通过' : '需复核'}（${review.issues.length} 条问题）${review.conclusion}`)
    } else {
      review = {
        status: 'error',
        issues: [],
        conclusion: reviewResult.error || '审查调用失败',
        confidence: 0,
        model: null,
      }
      log('LLM 审查', `审查降级：${review.conclusion}`)
    }
  } else {
    log('LLM 审查', '已跳过审查（withReview=false）')
  }

  return {
    reportDate,
    collection: {
      items: collectionItems,
      remindCount: remindItems.length,
      byType,
      log: {
        taskTime: taskStartedAt,
        durationMs: Date.now() - startedAtMs,
        sources: [crawl.source],
        totalCount: collectionItems.length,
        llmDurationMs,
        llmOk,
        llmFailed: collectionItems.length - llmOk,
        failures,
      },
    },
    alert: {
      alerts,
      upcoming,
      count: alerts.length,
      upcomingCount: upcoming.length,
      byNode,
    },
    reports,
    review,
    stats: {
      taskTime: taskStartedAt,
      durationMs: Date.now() - startedAtMs,
      reportDate,
      total: collectionItems.length,
      remindCount: remindItems.length,
      alertCount: alerts.length,
      upcomingCount: upcoming.length,
      byType,
      byNode,
      llmDurationMs,
      llmOk,
      llmFailed: collectionItems.length - llmOk,
      keywordStats: crawl.keywordStats,
      query: crawl.query,
    },
  }
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href
if (isMain) {
  // CLI：node case56-pipeline.mjs [--keywords 冰箱,保鲜] [--types gb,hb,db,plan] [--date 2026-08-14] [--maxItems 20] [--review]
  // 默认检索最近一天；加 --date YYYY-MM-DD 可补采指定历史日期；加 --review 开启 LLM 审查（--no-review 保留兼容，等同默认）
  const args = process.argv.slice(2)
  const getArg = (name, fallback = null) => {
    const index = args.indexOf(name)
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback
  }
  const keywords = (getArg('--keywords', '冰箱,保鲜,食品保鲜,制冷,家用电器,家电') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const types = (getArg('--types', 'gb,hb,db,plan') || '').split(',').map((s) => s.trim()).filter(Boolean)
  const maxItems = Number(getArg('--maxItems', '60')) || 60
  const reportDate = normalizeReportDate(getArg('--date', null))
  const withReview = args.includes('--review')
  const llmConfig = (() => {
    try {
      const parsed = JSON.parse(readFileSync(new URL('./ds配置.json', import.meta.url), 'utf8'))
      return {
        baseUrl: parsed?.provider?.deepseek?.options?.baseURL || process.env.STD_LLM_BASE_URL || '',
        model: process.env.STD_LLM_MODEL || 'deepseek-v4-flash',
        apiKey: parsed?.provider?.deepseek?.options?.apiKey || process.env.STD_LLM_API_KEY || '',
      }
    } catch {
      return { baseUrl: process.env.STD_LLM_BASE_URL || '', model: process.env.STD_LLM_MODEL || '', apiKey: process.env.STD_LLM_API_KEY || '' }
    }
  })()
  const result = await runCase56({
    keywords,
    types,
    maxItems,
    reportDate,
    llmConfig,
    withReview,
    onLog: (entry) => console.log(`[${entry.stage}] ${entry.message}`),
  })
  console.log(JSON.stringify({
    reportDate: result.reportDate,
    total: result.stats.total,
    remindCount: result.stats.remindCount,
    alertCount: result.stats.alertCount,
    upcomingCount: result.stats.upcomingCount,
    review: result.review,
    reportTitles: Object.fromEntries(Object.entries(result.reports).map(([key, value]) => [key, value?.title])),
  }, null, 2))
}
