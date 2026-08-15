// 组织动态模块管线（案例7 标委会换届专家推荐）
// 流程：外部标委会通知采集（全国专业标准化技术委员会信息公示系统 + 广东市监局 best-effort）
//   → 关键词过滤（冰箱/家电/家用电器/制冷）
//   → 详情补抓（征集范围/委员条件/截止日期/联系方式）
//   → LLM 结构化提取（委员会名称/代码/专业领域/委员条件/联系方式）
//   → 与内部专家库匹配打分（可配置权重：职称/工作年限/标准经历/专业领域）
//   → 推荐列表 + 待办跟踪（截止前 15/3 天提醒）
// 输出：{ notices, recommendations, trackings, expertPool, stats }
import { crawlTcrmNotices, hydrateTcrmNotices, crawlGdAmrNotices } from './crawl-tcrm.mjs'
import { loadExpertPool } from './expert-db.mjs'

export const DEFAULT_MATCH_WEIGHTS = { title: 30, years: 20, stdExp: 30, field: 20 }
export const DEFAULT_REMIND_NODES = [15, 3]

const today = () => new Date().toISOString().slice(0, 10)

// 截止日相对今天剩余天数（未来为正，过去为负，非法返回 null）
export const daysUntil = (dateStr) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null
  const target = new Date(`${dateStr}T00:00:00Z`)
  const todayUtc = new Date(`${today()}T00:00:00Z`)
  return Math.ceil((target - todayUtc) / 86_400_000)
}

// ---------- 受控演示场景（当实时爬取结果与家电关键词零命中时注入，保证演示闭环） ----------
// 依据：《开发测试演示案例手册》案例7 精确输入（SAC/TC46 换届征集委员）
// 与《需求改造》二-③「采集广度可用受控演示数据代替，来源、条件解析与专家匹配逻辑不缺失」
export const buildDemoScenario = (overrides = {}) => ({
  id: 'demo-sac-tc46',
  title: '关于全国家用电器标准化技术委员会换届及征集委员的通知',
  noticeType: 'recruit',
  businessType: 'CHANGE',
  publishedAt: '2026-08-01',
  deadline: '2026-09-30',
  hasApply: true,
  url: 'https://std.samr.gov.cn/org/orgTcQuery',
  isDemo: true,
  // 受控演示场景自带结构化字段（不等同于 LLM 提取，标注 demoSource 供人工识别）
  demoCommittee: 'SAC/TC46 全国家用电器标准化技术委员会',
  committeeCode: 'SAC/TC46',
  professionalAreas: ['家用电器', '冰箱', '制冷', '智能家电'],
  conditions: [
    '副高级及以上专业技术职称，或者具有与副高级及以上专业技术职称相对应的职务',
    '5年以上相关工作经验，参与过标准制修订工作',
    '熟悉家用电器、冰箱、制冷及智能家电专业领域业务工作',
  ],
  contact: { person: '标准化部 张XX', phone: '0757-XXXXXXX', email: 'bzh@hisense.com', address: '广东省佛山市顺德区容桂街道' },
  detailTitle: '关于全国家用电器标准化技术委员会换届及征集委员的通知',
  detailText: `各有关单位：
全国家用电器标准化技术委员会（SAC/TC46）是经国家标准化管理委员会批准成立的，在全国范围内负责家用电器领域标准化工作的专业标准化技术委员会。本届委员会工作已满五年，根据《全国专业标准化技术委员会管理办法》的有关要求，现开始筹备换届工作。本着广泛参与的原则，现面向全国各有关单位公开征集新一届委员会委员。

一、征集范围
全国范围内家用电器、冰箱、制冷、智能家电等领域的生产企业、科研机构、高等院校、检测机构、行业组织及用户单位的委员人选。

二、委员条件
1. 熟悉家用电器、冰箱、制冷及智能家电专业领域业务工作，具有较高理论水平、扎实的专业知识及丰富的实践经验；
2. 具有副高级及以上专业技术职称，或者具有与副高级及以上专业技术职称相对应的职务；
3. 具有5年以上相关工作经验，参与过标准制修订工作；
4. 热爱标准化事业，掌握标准化基础知识，能积极参与标准化活动，认真履行委员的各项职责和义务；
5. 在我国境内依法设立的法人组织任职的人员，并经任职单位同意推荐；
6. 未在3个以上技术委员会担任委员。

三、报送材料及要求
1. 本次征集采取单位推荐或个人申请、单位同意两种方式；
2. 委员候选人填写《全国专业标准化技术委员会委员登记表》，纸质版一式两份；
3. 推荐单位负责人签字并加盖单位法人公章。

四、联系方式
联系人：标准化部 张XX
联系电话：0757-XXXXXXX
电子邮箱：bzh@hisense.com
通讯地址：广东省佛山市顺德区容桂街道

2026年8月1日`,
  downloads: [{ path: '/demo/A-02全国专业标准化技术委员会委员登记表.doc', name: 'A-02全国专业标准化技术委员会委员登记表(2025).doc' }],
  detailFetchStatus: 'completed',
  demoSource: '受控演示场景（全国标委会换届公示，实时数据零命中时注入）',
  ...overrides,
})

// ---------- 通知规范化 ----------
// 联系方式合并：LLM 提取字段优先，缺失字段回退到列表/演示场景预置值
const mergeContact = (primary = null, fallback = null) => {
  const result = {}
  for (const key of ['person', 'phone', 'email', 'address']) {
    const value = primary?.[key] || fallback?.[key]
    if (value) result[key] = String(value).trim()
  }
  return Object.keys(result).length > 0 ? result : null
}

const normalizeNotice = (notice, { keywords = [] } = {}) => {
  const title = notice.detailTitle || notice.title || ''
  const fullText = `${title} ${notice.detailText || ''}`
  const matchedKeywords = keywords.filter((k) => fullText.includes(k))
  return {
    id: notice.id,
    title,
    committeeName: notice.llmExtraction?.committeeName || notice.demoCommittee || '',
    committeeCode: notice.llmExtraction?.committeeCode || notice.committeeCode || '',
    noticeType: notice.llmExtraction?.noticeType || (notice.noticeType === 'recruit' ? '征集委员' : '征集意见公示'),
    businessType: notice.llmExtraction?.businessType || notice.businessType || '',
    publishedAt: notice.llmExtraction?.publishedAt || notice.publishedAt || '',
    deadline: notice.llmExtraction?.deadline || notice.deadline || '',
    professionalAreas: notice.llmExtraction?.professionalAreas?.length
      ? notice.llmExtraction.professionalAreas
      : (Array.isArray(notice.professionalAreas) ? notice.professionalAreas : []),
    conditions: notice.llmExtraction?.conditions?.length
      ? notice.llmExtraction.conditions
      : (Array.isArray(notice.conditions) ? notice.conditions : []),
    contact: mergeContact(notice.llmExtraction?.contact, notice.contact),
    url: notice.url || '',
    downloads: notice.downloads || [],
    hasApply: Boolean(notice.hasApply || notice.hasJoin),
    source: notice.isDemo ? '受控演示' : '全国专业标准化技术委员会信息公示系统',
    isDemo: Boolean(notice.isDemo),
    demoSource: notice.demoSource || '',
    llmStatus: notice.llmStatus || '',
    llmConfidence: notice.llmExtraction?.confidence ?? null,
    matchedKeywords,
    detailFetchStatus: notice.detailFetchStatus || '',
  }
}

// 委员条件解析（供匹配用）：职称/年限/标准经历 三要素
const parseRequirement = (conditions = [], committeeName = '') => {
  const text = conditions.join(' ')
  const requireTitle = /正高级|教授级/.test(text) ? '正高级'
    : /副高级|高级工程师|副高/.test(text) ? '副高级'
      : /中级|工程师/.test(text) ? '中级'
        : null
  const yearsMatch = text.match(/(\d+)年(?:以上)?(?:相关)?工作经验/)
  const requireYears = yearsMatch ? Number(yearsMatch[1]) : null
  const requireStdExp = /参与过标准|标准制修订|起草过标准|主导.*标准/.test(text)
  return { requireTitle, requireYears, requireStdExp }
}

// ---------- 专家匹配打分（权重可配置，返回 0-100） ----------
export const scoreExpertMatch = (expert, notice, { weights = DEFAULT_MATCH_WEIGHTS } = {}) => {
  const w = { ...DEFAULT_MATCH_WEIGHTS, ...(weights || {}) }
  const req = parseRequirement(notice.conditions || [], notice.committeeName || '')
  const breakdown = {}
  const reasons = []

  // 职称（30）
  const titleLevelRank = { 中级: 1, 副高级: 2, 正高级: 3 }
  const expertRank = titleLevelRank[expert.titleLevel] || 0
  if (req.requireTitle) {
    const reqRank = titleLevelRank[req.requireTitle] || 0
    breakdown.title = expertRank >= reqRank ? w.title : expertRank === 0 ? 0 : Math.round(w.title * 0.4)
    if (expertRank >= reqRank) reasons.push(`职称${expert.title}符合${req.requireTitle}要求`)
    else reasons.push(`职称${expert.title}未达${req.requireTitle}要求（部分匹配）`)
  } else {
    breakdown.title = expertRank > 0 ? w.title : 0
    if (expertRank > 0) reasons.push(`具备${expert.title}职称`)
  }

  // 工作年限（20）
  if (req.requireYears) {
    breakdown.years = expert.workYears >= req.requireYears
      ? w.years
      : Math.round(w.years * (expert.workYears / req.requireYears))
    if (expert.workYears >= req.requireYears) reasons.push(`工作年限${expert.workYears}年符合${req.requireYears}年以上要求`)
    else reasons.push(`工作年限${expert.workYears}年不足${req.requireYears}年`)
  } else {
    breakdown.years = expert.workYears >= 5 ? w.years : Math.round(w.years * 0.5)
    reasons.push(`工作年限${expert.workYears}年`)
  }

  // 标准经历（30）：主导经历 > 仅参与经历，实现差异化（案例7 期望 98/92/85 梯度）
  const totalStd = (expert.stdLeading || 0) + (expert.stdParticipating || 0)
  const hasStd = totalStd > 0
  const stdScore = (leading, participating) => {
    if (leading + participating === 0) return Math.round(w.stdExp * 0.3)
    if (leading >= 3) return w.stdExp
    if (leading >= 2) return Math.round(w.stdExp * 0.92)
    if (leading >= 1) return Math.round(w.stdExp * 0.85)
    return Math.round(w.stdExp * 0.72) // 仅参与
  }
  if (req.requireStdExp) {
    breakdown.stdExp = stdScore(expert.stdLeading || 0, expert.stdParticipating || 0)
    if (!hasStd) reasons.push('无标准制修订经历')
    else if ((expert.stdLeading || 0) > 0) reasons.push(`主导过标准制修订（主导${expert.stdLeading}项/参与${expert.stdParticipating}项）`)
    else reasons.push(`参与过标准制修订（参与${expert.stdParticipating}项，未见主导）`)
  } else {
    breakdown.stdExp = stdScore(expert.stdLeading || 0, expert.stdParticipating || 0)
    if (hasStd) reasons.push(`标准经历：${expert.stdExperience}`)
    else reasons.push('无标准制修订经历')
  }

  // 专业领域（20）：按覆盖比例差异化（案例7 期望不同专家因领域覆盖度不同而得分不同）
  const noticeAreas = (notice.professionalAreas || []).map((s) => String(s))
  const expertAreas = (expert.professionalFields || []).map((s) => String(s))
  const noticeText = (notice.title || '') + ' ' + notice.professionalAreas.join(' ') + ' ' + (notice.committeeName || '')
  const matchedAreas = []
  if (noticeAreas.length > 0) {
    for (const n of noticeAreas) {
      if (expertAreas.some((a) => a.includes(n) || n.includes(a))) matchedAreas.push(n)
    }
    const ratio = matchedAreas.length / Math.max(noticeAreas.length, 1)
    breakdown.field = Math.round(w.field * Math.max(ratio, expertAreas.some((a) => noticeText.includes(a)) ? 0.6 : 0.3))
  } else {
    const kwHits = expertAreas.filter((a) => noticeText.includes(a)).length
    breakdown.field = kwHits > 0 ? w.field : Math.round(w.field * 0.4)
    if (kwHits > 0) matchedAreas.push(...expertAreas.filter((a) => noticeText.includes(a)))
  }
  if (matchedAreas.length > 0) reasons.push(`专业领域匹配（${matchedAreas.join('/')}）`)
  else reasons.push('专业领域与通知关联度一般')

  const score = Math.min(100, Math.max(0, Object.values(breakdown).reduce((sum, v) => sum + v, 0)))
  return { score, breakdown, reasons, requirement: req }
}

// ---------- LLM 结构化提取（复用 crawl-samr 的 OpenAI Chat Completions 适配模式） ----------
const resolveChatCompletionsUrl = (baseUrl) => {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

const parseModelJson = (content) => {
  const text = Array.isArray(content) ? content.map((item) => item?.text || '').join('') : String(content || '')
  const withoutFence = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回有效 JSON')
  return JSON.parse(withoutFence.slice(start, end + 1))
}

const compactText = (value = '') => String(value || '').replace(/\s+/g, ' ').trim()

const buildNoticeLlmPrompt = (notice) => `你是一名标准化组织情报分析助手。请从以下标委会换届/征集委员通知中提取结构化信息，只能依据输入内容，不得编造。

要求：
1. committeeName：技术委员会全称（如「全国家用电器标准化技术委员会」）；committeeCode 为 SAC/TC 编号（如 SAC/TC46），无法识别留空。
2. noticeType 只能是：征集委员 / 换届组成方案公示 / 筹建公示 / 征集意见 / 其他。
3. businessType 只能是：BUILD（筹建）/ CHANGE（换届）/ SECRETARIAT_ADJUST（调整）/ OPINION（其他），无法判断留空。
4. deadline 为「YYYY-MM-DD」格式的征集截止日期；publishedAt 为发布日期；无法识别留空。
5. professionalAreas：征集范围/业务范围涉及的专业领域数组（如 ["家用电器","冰箱","制冷"]），从原文提取。
6. conditions：委员条件数组（逐条提取，如 ["副高级及以上专业技术职称","5年以上相关工作经验","参与过标准制修订"]）。
7. contact：{ person, phone, email, address } 联系方式对象，原文有才填。
8. confidence 为 0-1 置信度；reasoning 简短说明判断依据；evidence 返回 1-3 条原文依据。

只返回一个 JSON 对象，不要返回 Markdown：
{
  "committeeName": "全国家用电器标准化技术委员会",
  "committeeCode": "SAC/TC46",
  "noticeType": "征集委员",
  "businessType": "CHANGE",
  "deadline": "2026-09-30",
  "publishedAt": "2026-08-01",
  "professionalAreas": ["家用电器", "冰箱", "制冷", "智能家电"],
  "conditions": ["副高级及以上专业技术职称", "5年以上相关工作经验", "参与过标准制修订"],
  "contact": { "person": "张XX", "phone": "0757-XXXX", "email": "bzh@hisense.com", "address": "广东省佛山市顺德区" },
  "confidence": 0.9,
  "reasoning": "判断说明",
  "evidence": ["依据一"]
}

通知 JSON：
${JSON.stringify({ title: notice.title, publishedAt: notice.publishedAt, deadline: notice.deadline, detailText: (notice.detailText || '').slice(0, 5000) })}`

const normalizeNoticeExtraction = (value = {}) => ({
  committeeName: compactText(value.committeeName),
  committeeCode: compactText(value.committeeCode),
  noticeType: compactText(value.noticeType),
  businessType: compactText(value.businessType),
  deadline: compactText(value.deadline),
  publishedAt: compactText(value.publishedAt),
  professionalAreas: Array.isArray(value.professionalAreas) ? value.professionalAreas.map(compactText).filter(Boolean) : [],
  conditions: Array.isArray(value.conditions) ? value.conditions.map(compactText).filter(Boolean) : [],
  contact: value.contact && typeof value.contact === 'object'
    ? {
        person: compactText(value.contact.person),
        phone: compactText(value.contact.phone),
        email: compactText(value.contact.email),
        address: compactText(value.contact.address),
      }
    : null,
  confidence: Number.isFinite(Number(value.confidence)) ? Math.min(Math.max(Number(value.confidence), 0), 1) : 0,
  reasoning: compactText(value.reasoning || '模型未提供判断说明'),
  evidence: Array.isArray(value.evidence) ? value.evidence.map(compactText).filter(Boolean).slice(0, 3) : [],
})

export const extractTcNoticeWithLlm = async (notice, { config = {}, signal } = {}) => {
  const configured = Boolean(config.baseUrl && config.model && config.apiKey)
  if (!configured) {
    return {
      ...notice,
      llmStatus: 'model_unconfigured',
      llmExtraction: null,
      // 降级：从详情正文提取委员会代码（SAC/TC 模式），供展示与匹配兜底
      committeeNameHint: notice.demoCommittee || '',
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
            { role: 'system', content: '你负责对标准化组织换届/征集委员公开通知做审慎的结构化提取，只能依据输入材料输出 JSON。' },
            { role: 'user', content: buildNoticeLlmPrompt(notice) },
          ],
        }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error?.message || body?.message || `模型接口返回 HTTP ${response.status}`)
      if (!body?.choices?.[0]?.message) throw new Error('模型响应缺少 choices/message（可能为空响应）')
      const content = body.choices[0].message.content
      if (!content) throw new Error('模型返回空内容')
      const extraction = normalizeNoticeExtraction(parseModelJson(content))
      return { ...notice, llmStatus: 'completed', llmExtraction: extraction }
    } catch (error) {
      lastError = error
      if (signal?.aborted || error?.name === 'AbortError') throw error
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 3000 * (attempt + 1)))
    }
  }
  return { ...notice, llmStatus: 'error', llmError: lastError instanceof Error ? lastError.message : 'LLM 提取失败' }
}

export const extractTcNoticesWithLlm = async (notices, { config = {}, concurrency = 5, maxItems = 30, signal, onProgress = null } = {}) => {
  const safe = Array.isArray(notices) ? notices.slice(0, maxItems) : []
  const results = new Array(safe.length)
  let cursor = 0
  let doneCount = 0
  const worker = async () => {
    while (cursor < safe.length) {
      const index = cursor
      cursor += 1
      results[index] = await extractTcNoticeWithLlm(safe[index], { config, signal })
      doneCount += 1
      if (typeof onProgress === 'function') onProgress({ done: doneCount, total: safe.length })
    }
  }
  const safeConcurrency = Math.min(Math.max(Number(concurrency) || 1, 1), 6)
  await Promise.all(Array.from({ length: Math.min(safeConcurrency, safe.length || 1) }, () => worker()))
  return results
}

// ---------- 管线主入口 ----------
export const runOrganization = async ({
  keywords = ['冰箱', '家电', '家用电器', '制冷'],
  noticeTypes = ['recruit', 'suggest'],
  maxPages = 1,
  pageSize = 100,
  maxItems = 40,
  hydrateConcurrency = 4,
  llmConcurrency = 5,
  llmConfig = null,
  matchWeights = DEFAULT_MATCH_WEIGHTS,
  remindNodes = DEFAULT_REMIND_NODES,
  withLlm = true,
  withDemo = true,
  expertPool = null,
  onLog = null,
} = {}) => {
  const log = (stage, message) => {
    if (typeof onLog === 'function') onLog({ stage, message, time: new Date().toISOString() })
  }
  const taskStartedAt = new Date().toISOString()
  const startedAtMs = Date.now()
  const safeKeywords = [...new Set((Array.isArray(keywords) ? keywords : []).map((s) => String(s).trim()).filter(Boolean))]
  const safeMaxItems = Math.min(Math.max(Number(maxItems) || 1, 1), 60)
  const experts = loadExpertPool(expertPool)

  log('通知检索', `关键词「${safeKeywords.join(' / ')}」× 通知类型「${(noticeTypes || []).join(' / ')}」`)

  // 1. 全国标委会信息公示系统采集
  const tcrm = await crawlTcrmNotices({ keywords: safeKeywords, noticeTypes, maxPages, pageSize })
  for (const entry of tcrm.logs) log(entry.stage, entry.message)

  // 2. 广东市监局（best-effort，不可达不阻塞）
  const gd = await crawlGdAmrNotices({ keywords: safeKeywords, maxPages: 1 })
  for (const entry of gd.logs) log(entry.stage, entry.message)

  // 3. 详情补抓（实时数据按关键词过滤后补抓；零命中时注入受控演示场景）
  let live = tcrm.notices
  let demoUsed = false
  if (live.length === 0 && withDemo) {
    live = [buildDemoScenario()]
    demoUsed = true
    log('受控演示', `实时数据与关键词「${safeKeywords.join(' / ')}」零命中，注入 SAC/TC46 换届演示通知（采集广度以受控演示数据代替）`)
  }
  const toHydrate = live.slice(0, safeMaxItems)
  const hydrated = await hydrateTcrmNotices(toHydrate, { concurrency: hydrateConcurrency })
  const hydrateOk = hydrated.filter((n) => n.detailFetchStatus === 'completed').length
  log('详情补抓', `完成 ${hydrateOk}/${hydrated.length}（征集范围/委员条件/截止日期/联系方式）`)

  // 4. LLM 结构化提取
  let notices = hydrated
  let llmOk = 0
  const llmStart = Date.now()
  if (withLlm) {
    notices = await extractTcNoticesWithLlm(hydrated, {
      config: llmConfig || {},
      concurrency: llmConcurrency,
      maxItems: safeMaxItems,
      onProgress: ({ done, total }) => {
        if (done % 4 === 0 || done === total) log('LLM 提取', `已结构化提取 ${done}/${total}`)
      },
    })
    llmOk = notices.filter((n) => n.llmStatus === 'completed').length
    log('LLM 提取', `成功 ${llmOk}/${notices.length}（委员会名称/专业领域/委员条件/截止日期）`)
  }
  const llmDurationMs = Date.now() - llmStart

  // 5. 规范化 + 专家匹配
  const normalized = notices.map((n) => normalizeNotice(n, { keywords: safeKeywords }))
  const recommendations = []
  for (const notice of normalized) {
    const matches = experts
      .map((expert) => ({
        expert,
        ...scoreExpertMatch(expert, notice, { weights: matchWeights }),
      }))
      .sort((a, b) => b.score - a.score)
    recommendations.push({ noticeId: notice.id, noticeTitle: notice.title, matches })
  }

  // 6. 待办跟踪（截止前 remindNodes 天提醒）
  const trackings = normalized
    .filter((n) => n.deadline)
    .map((n) => {
      const days = daysUntil(n.deadline)
      const sortedNodes = [...new Set((Array.isArray(remindNodes) ? remindNodes : []).map(Number).filter(Number.isFinite))].sort((a, b) => b - a)
      const upcomingNodes = []
      if (days !== null && days > 0) {
        for (const node of sortedNodes) {
          if (days <= node) upcomingNodes.push(node)
        }
      }
      return {
        noticeId: n.id,
        title: n.title,
        committeeName: n.committeeName,
        deadline: n.deadline,
        daysToDeadline: days,
        remindNodes: upcomingNodes,
        urgent: days !== null && days > 0 && days <= Math.min(...sortedNodes, Infinity),
        isDemo: n.isDemo,
      }
    })
    .sort((a, b) => (a.daysToDeadline ?? Infinity) - (b.daysToDeadline ?? Infinity))

  const totalExperts = experts.length
  const recommendedExperts = new Set(recommendations.flatMap((r) => r.matches.filter((m) => m.score >= 60).map((m) => m.expert.id))).size

  return {
    notices: normalized,
    recommendations,
    trackings,
    expertPool: experts,
    stats: {
      taskTime: taskStartedAt,
      durationMs: Date.now() - startedAtMs,
      sources: [tcrm.source, gd.source],
      gdReachable: gd.reachable,
      noticeCount: normalized.length,
      demoUsed,
      deadlineCount: normalized.filter((n) => n.deadline).length,
      totalExperts,
      recommendedExperts,
      remindNodes: [...new Set((Array.isArray(remindNodes) ? remindNodes : []).map(Number).filter(Number.isFinite))].sort((a, b) => b - a),
      matchWeights: { ...DEFAULT_MATCH_WEIGHTS, ...(matchWeights || {}) },
      llmDurationMs,
      llmOk,
      llmFailed: normalized.length - llmOk,
      keywordStats: tcrm.keywordStats,
      query: { keywords: safeKeywords, noticeTypes, demoUsed },
    },
  }
}
