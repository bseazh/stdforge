// 案例8 分析管线（共享模块）：可配置查询 → 爬取 → 领域过滤 → hbba 补抓 → 详情补抓 → LLM 提取 → 合并 → 聚合 → LLM 结论
// 供 run-case8-scenario.mjs（CLI/报告）与 serve-demo.mjs（演示页实时接口）复用
import {
  crawlSamrStandards,
  enrichHbbaDraftUnits,
  extractStandardsWithLlm,
  hydrateSamrStandardDetails,
} from './crawl-samr.mjs'

export const DEFAULT_GROUP_RULES = [
  { group: '海信系', keywords: ['海信'], region: '广东省' },
  { group: '美的', keywords: ['美的'], region: '广东省' },
  { group: '海尔', keywords: ['海尔'], region: '山东省' },
  { group: '格力', keywords: ['格力'], region: '广东省' },
  { group: '美菱', keywords: ['美菱', '华凌'], region: '安徽省' },
]

export const isApplianceFreshness = (standard) => {
  const title = standard.title || ''
  const ics = standard.ics || ''
  const ccs = standard.ccs || ''
  if (!/冰箱|冷藏|冷柜|制冷器具|保鲜/.test(title)) return false
  const icsHit = /^97\.(03|04)/.test(ics)
  const ccsHit = /^Y6/.test(ccs)
  return icsHit || ccsHit || /冰箱|冷柜/.test(title)
}

// 领域过滤原因（调试模式使用）
export const filterReason = (standard) => {
  const title = standard.title || ''
  const ics = standard.ics || ''
  const ccs = standard.ccs || ''
  if (!/冰箱|冷藏|冷柜|制冷器具|保鲜/.test(title)) return '标题不含领域词（冰箱/冷藏/冷柜/制冷器具/保鲜）'
  const icsHit = /^97\.(03|04)/.test(ics)
  const ccsHit = /^Y6/.test(ccs)
  if (!icsHit && !ccsHit && !/冰箱|冷柜/.test(title)) return 'ICS/CCS 不在家电白名单（ICS 97.03/97.04、CCS Y6）'
  return null
}

// 计划与已发布标准合并：同一标准号优先保留已发布版，计划版仅补充计划号/制修订信息
export const mergePlanAndPublished = (standards) => {
  const byNo = new Map()
  for (const standard of standards) {
    const key = standard.standardNo?.trim()
    if (!key) {
      byNo.set(`__id_${standard.id || Math.random()}`, standard)
      continue
    }
    const existing = byNo.get(key)
    if (!existing) {
      byNo.set(key, standard)
      continue
    }
    const existingIsPlan = existing.domain?.includes('计划')
    const incomingIsPlan = standard.domain?.includes('计划')
    if (existingIsPlan && !incomingIsPlan) {
      byNo.set(key, { ...standard, planCode: standard.planCode || existing.planCode, planForm: standard.planForm || existing.planForm })
    } else if (!existingIsPlan && !incomingIsPlan) {
      byNo.set(key, { ...existing, planCode: existing.planCode || standard.planCode, planForm: existing.planForm || standard.planForm })
    }
  }
  return [...byNo.values()]
}

const normalizeGroupRules = (groups) => {
  if (!Array.isArray(groups) || groups.length === 0) return DEFAULT_GROUP_RULES
  const rules = groups
    .map((rule) => ({
      group: String(rule.group || '').trim(),
      keywords: (Array.isArray(rule.keywords) ? rule.keywords : [])
        .map((item) => String(item).trim())
        .filter(Boolean),
      region: String(rule.region || '其他').trim(),
    }))
    .filter((rule) => rule.group && rule.keywords.length > 0)
  return rules.length > 0 ? rules : DEFAULT_GROUP_RULES
}

const isLeading = (units, rule, leadingRule) => {
  if (leadingRule === 'top3') {
    return units.slice(0, 3).some((unit) => rule.keywords.some((keyword) => unit.includes(keyword)))
  }
  return units[0] && rule.keywords.some((keyword) => units[0].includes(keyword))
}

// 聚合：企业参与/主导、技术领域、年度趋势、归口TC、省份地图
export const computeDashboard = (standards, groupRules = DEFAULT_GROUP_RULES, leadingRule = 'first') => {
  const rules = normalizeGroupRules(groupRules)
  const groupStats = Object.fromEntries(rules.map((rule) => [
    rule.group,
    { region: rule.region, leading: 0, participating: 0, standards: [] },
  ]))
  const techAreas = {}
  const yearTrend = {}
  const tcCount = {}

  for (const standard of standards) {
    const units = standard.draftUnits || []
    const year = (standard.publishedAt || standard.year || '').toString().slice(0, 4)
    if (year) yearTrend[year] = (yearTrend[year] || 0) + 1
    if (standard.tc) tcCount[standard.tc] = (tcCount[standard.tc] || 0) + 1
    for (const area of (standard.llmExtraction?.techAreas || standard.techAreas || [])) {
      techAreas[area] = (techAreas[area] || 0) + 1
    }
    for (const rule of rules) {
      const hit = units.filter((unit) => rule.keywords.some((keyword) => unit.includes(keyword)))
      if (hit.length === 0) continue
      const stat = groupStats[rule.group]
      stat.participating += 1
      stat.standards.push(standard.standardNo)
      if (isLeading(units, rule, leadingRule)) stat.leading += 1
    }
  }

  // 省份地图：省内任一集团参与的标准去重计数
  const regionData = [...new Set(rules.map((rule) => rule.region))].map((region) => {
    const regionRules = rules.filter((rule) => rule.region === region)
    const involved = new Set()
    for (const standard of standards) {
      const units = standard.draftUnits || []
      if (regionRules.some((rule) => units.some((unit) => rule.keywords.some((k) => unit.includes(k))))) {
        involved.add(standard.standardNo || standard.title)
      }
    }
    return {
      name: region,
      value: involved.size,
      companies: regionRules.map((rule) => rule.group),
    }
  })

  const rows = standards.map((standard) => ({
    standardNo: standard.standardNo,
    title: standard.title,
    domain: standard.domain,
    planForm: standard.planForm || '',
    status: standard.status,
    publishedAt: standard.publishedAt || '',
    year: (standard.publishedAt || '').slice(0, 4),
    draftUnits: standard.draftUnits || [],
    draftCount: (standard.draftUnits || []).length,
    groups: rules.filter((rule) => (standard.draftUnits || []).some((unit) => rule.keywords.some((k) => unit.includes(k)))).map((rule) => rule.group),
    leadingGroup: rules.find((rule) => isLeading(standard.draftUnits || [], rule, leadingRule))?.group || '',
    techAreas: standard.llmExtraction?.techAreas || standard.techAreas || [],
    scope: standard.llmExtraction?.scope || standard.scope || '',
    tc: standard.tc || '',
    llmStatus: standard.llmStatus || '',
    url: standard.url || '',
  }))

  return { groupStats, techAreas, yearTrend, tcCount, regionData, rows, groupRules: rules, leadingRule }
}

// ---------- LLM 分析结论生成 ----------
const parseModelJson = (content) => {
  const text = Array.isArray(content) ? content.map((item) => item?.text || '').join('') : String(content || '')
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

const buildConclusionsPrompt = (context) => `你是一名冰箱行业标准竞争情报分析专家。请仅依据下面给出的真实统计与标准明细，生成 3 条分析结论（竞争格局 / 趋势洞察 / 机会识别），每条结论必须引用具体标准号或统计数字，不得编造未提供的数据。

统计输入：
${JSON.stringify(context, null, 2)}

只返回一个 JSON 对象，不要返回 Markdown：
{
  "reportTitle": "不超过20字的报告标题（依据关键词与数据特征生成，如“冰箱保鲜领域标准竞争分析报告”）",
  "conclusions": [
    { "title": "竞争格局", "text": "结论文本（80字以内，引用标准号或数字）" },
    { "title": "趋势洞察", "text": "结论文本" },
    { "title": "机会识别", "text": "结论文本" }
  ],
  "confidence": 0.85,
  "reasoning": "依据说明",
  "evidence": ["依据一", "依据二"]
}`

export const generateAnalysisConclusions = async ({ dashboard, query }, { config = {}, signal } = {}) => {
  const configured = Boolean(config.baseUrl && config.model && config.apiKey)
  if (!configured) return { status: 'model_unconfigured', conclusions: [], model: null }

  const context = {
    query,
    groupStats: dashboard.groupStats,
    techAreas: dashboard.techAreas,
    yearTrend: dashboard.yearTrend,
    totalStandards: dashboard.rows.length,
    topStandards: dashboard.rows.slice(0, 12).map((row) => ({
      standardNo: row.standardNo,
      title: row.title,
      domain: row.domain,
      year: row.year,
      techAreas: row.techAreas,
      leadingGroup: row.leadingGroup,
      groups: row.groups,
    })),
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
          temperature: 0.2,
          messages: [
            { role: 'system', content: '你只依据输入的真实统计生成结论，禁止编造数据。' },
            { role: 'user', content: buildConclusionsPrompt(context) },
          ],
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `模型接口返回 HTTP ${response.status}`)
      const content = body?.choices?.[0]?.message?.content
      if (!content) throw new Error('模型返回空内容')
      const parsed = parseModelJson(content)
      const conclusions = (Array.isArray(parsed.conclusions) ? parsed.conclusions : [])
        .map((item) => ({ title: String(item?.title || ''), text: String(item?.text || '') }))
        .filter((item) => item.title && item.text)
        .slice(0, 3)
      return {
        status: 'completed',
        model: config.model,
        reportTitle: String(parsed.reportTitle || '').trim(),
        conclusions,
        confidence: Number(parsed.confidence) || 0,
        reasoning: String(parsed.reasoning || ''),
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
      }
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)))
    }
  }
  return { status: 'error', error: lastError instanceof Error ? lastError.message : '结论生成失败', conclusions: [] }
}

// 完整管线：可配置查询 → 检索 → 领域过滤 → hbba → 详情 → LLM → 合并 → 聚合 → 结论
export const runCase8Analysis = async ({
  keywords = ['冰箱', '保鲜', '食品保鲜', '制冷', '家用电器', '家电'],
  types = ['gb', 'hb', 'db', 'plan'],
  startDate = '2021-01-01',
  endDate = new Date().toISOString().slice(0, 10),
  maxPages = 1,
  pageSize = 20,
  maxItems = 24,
  concurrency = 8,
  searchConcurrency = 3,
  llmConcurrency = 3,
  llmConfig = null,
  groups = null,
  leadingRule = 'first',
  withHbba = true,
  withHydrate = true,
  withLlm = true,
  withConclusions = true,
  onLog = null,
  debug = false,
} = {}) => {
  const log = (stage, message) => {
    if (typeof onLog === 'function') onLog({ stage, message, time: new Date().toISOString() })
  }
  const timings = {}
  const timeStep = async (name, fn) => {
    const start = Date.now()
    const value = await fn()
    timings[name] = Date.now() - start
    return value
  }
  const debugInfo = debug ? {
    enabled: true,
    search: [],
    filter: { total: 0, kept: 0, dropped: [] },
    hbba: [],
    hydrate: [],
    llm: [],
    merge: { before: 0, after: 0 },
    timings,
    warnings: [],
  } : null
  const ruleSet = normalizeGroupRules(groups)
  const safeKeywords = (Array.isArray(keywords) ? keywords : []).map((item) => String(item).trim()).filter(Boolean)
  const safeTypes = (Array.isArray(types) ? types : []).filter((type) => ['gb', 'hb', 'db', 'plan'].includes(type))

  log('检索', `关键词「${safeKeywords.join(' / ')}」× 类型「${safeTypes.join(' / ')}」窗口 ${startDate} ~ ${endDate}`)
  const crawl = await timeStep('search', () => crawlSamrStandards({ keywords: safeKeywords, startDate, endDate, types: safeTypes, maxPages, pageSize, searchConcurrency }))
  log('检索', `共命中去重 ${crawl.standards.length} 条（${crawl.keywordStats.map((s) => `${s.label}「${s.keyword}」${s.totalHits}`).join('；')}）`)
  if (debugInfo) {
    debugInfo.search = crawl.keywordStats
    debugInfo.filter.total = crawl.standards.length
  }

  let standards = await timeStep('filter', async () => {
    if (!debugInfo) return crawl.standards.filter(isApplianceFreshness)
    const kept = []
    for (const standard of crawl.standards) {
      const reason = filterReason(standard)
      if (reason) {
        debugInfo.filter.dropped.push({ standardNo: standard.standardNo, title: standard.title, ics: standard.ics, ccs: standard.ccs, reason })
      } else {
        kept.push(standard)
      }
    }
    debugInfo.filter.kept = kept.length
    return kept
  })
  log('领域过滤', `家电制冷保鲜领域 ${standards.length} 条`)

  if (withHbba) {
    standards = await timeStep('hbba', () => enrichHbbaDraftUnits(standards))
    log('起草单位补抓', '行业标准起草单位 hbba best-effort 补抓完成')
    if (debugInfo) {
      debugInfo.hbba = standards
        .filter((item) => item.rawType === 'hb')
        .map((item) => ({ standardNo: item.standardNo, status: item.hbbaStatus || 'skipped', draftUnits: (item.draftUnits || []).length }))
      const emptyHbba = debugInfo.hbba.filter((item) => item.status === 'empty')
      if (emptyHbba.length) debugInfo.warnings.push(`行业标准起草单位未公开：${emptyHbba.map((item) => item.standardNo).join('、')}`)
    }
  }

  standards = standards.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, maxItems)
  let hydratedCount = 0
  let llmOk = 0
  if (withHydrate) {
    standards = await timeStep('hydrate', () => hydrateSamrStandardDetails(standards, {
      concurrency,
      onProgress: ({ done, total }) => {
        if (done % 4 === 0 || done === total) log('详情补抓', `已抓取详情页 ${done}/${total}`)
      },
    }))
    hydratedCount = standards.filter((item) => item.detailFetchStatus === 'completed').length
    log('详情补抓', `完成 ${hydratedCount}/${standards.length}`)
    if (debugInfo) {
      debugInfo.hydrate = standards.map((item) => ({
        standardNo: item.standardNo,
        status: item.detailFetchStatus,
        error: item.detailFetchError || null,
        keyValueCount: item.detailKeyValues ? Object.keys(item.detailKeyValues).length : 0,
        draftUnits: (item.draftUnits || []).length,
      }))
      const failed = debugInfo.hydrate.filter((item) => item.status === 'error')
      if (failed.length) debugInfo.warnings.push(`详情页补抓失败：${failed.map((item) => `${item.standardNo}（${item.error}）`).join('；')}`)
    }
  }
  if (withLlm) {
    const safeLlmConcurrency = Math.min(Math.max(Number(llmConcurrency) || 1, 1), 8)
    standards = await timeStep('llm', () => extractStandardsWithLlm(standards, {
      config: llmConfig || {},
      concurrency: safeLlmConcurrency,
      maxItems,
      onProgress: ({ done, total }) => {
        if (done % 4 === 0 || done === total) log('LLM 提取', `已结构化提取 ${done}/${total}`)
      },
    }))
    llmOk = standards.filter((item) => item.llmStatus === 'completed').length
    log('LLM 提取', `成功 ${llmOk}/${standards.length}`)
    if (debugInfo) {
      debugInfo.llm = standards.map((item) => ({
        standardNo: item.standardNo,
        status: item.llmStatus,
        error: item.llmError || null,
        techAreas: item.llmExtraction?.techAreas || item.techAreas || [],
        confidence: item.llmExtraction?.confidence ?? null,
      }))
      const failed = debugInfo.llm.filter((item) => item.status === 'error')
      if (failed.length) debugInfo.warnings.push(`LLM 提取失败：${failed.map((item) => `${item.standardNo}（${item.error}）`).join('；')}`)
    }
  }

  const merged = await timeStep('merge', () => mergePlanAndPublished(standards))
  log('合并', `计划↔发布合并后 ${merged.length} 条（原 ${standards.length} 条）`)
  if (debugInfo) {
    debugInfo.merge.before = standards.length
    debugInfo.merge.after = merged.length
  }
  const dashboard = await timeStep('aggregate', () => computeDashboard(merged, ruleSet, leadingRule))

  let conclusionsResult = { status: 'skipped', conclusions: [] }
  if (withConclusions && llmConfig?.baseUrl && llmConfig?.apiKey) {
    log('分析结论', 'LLM 正在基于统计与明细生成竞争分析结论…')
    conclusionsResult = await timeStep('conclusions', () => generateAnalysisConclusions({ dashboard, query: { keywords: safeKeywords, types: safeTypes, startDate, endDate, leadingRule } }, { config: llmConfig }))
    log('分析结论', conclusionsResult.status === 'completed' ? `已生成 ${conclusionsResult.conclusions.length} 条结论` : '结论生成失败（保留统计结果）')
    if (debugInfo && conclusionsResult.status === 'error') {
      debugInfo.warnings.push(`结论生成失败：${conclusionsResult.error || '未知原因'}`)
    }
  }

  const fallbackTitle = `${safeKeywords.slice(0, 2).join('、')}领域标准竞争分析报告`

  return {
    ...dashboard,
    groupRules: ruleSet,
    leadingRule,
    keywordStats: crawl.keywordStats,
    reportTitle: conclusionsResult.reportTitle || fallbackTitle,
    conclusions: conclusionsResult.conclusions || [],
    conclusionsStatus: conclusionsResult.status,
    conclusionsModel: conclusionsResult.model || null,
    hydratedCount,
    llmOk,
    rawCount: crawl.standards.length,
    filteredCount: crawl.standards.filter(isApplianceFreshness).length,
    mergedCount: merged.length,
    collectedAt: new Date().toISOString(),
    debug: debugInfo,
  }
}
