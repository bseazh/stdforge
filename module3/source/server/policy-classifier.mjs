const ADMINISTRATIVE_LEVELS = ['国家级', '省级', '市级', '区县级', '其他']
const POLICY_CATEGORIES = ['通用政策', '产业政策']
const CENTRAL_AUTHORITY_PATTERN = /国务院|工业和信息化部|国家发展改革委|国家市场监督管理总局|财政部|生态环境部|国家能源局/
const LOCATION_PATTERN = /(北京市|天津市|上海市|重庆市|[^，。、；\s]{2,8}(?:省|自治区|自治州|市|区|县))/

const compactText = (value = '') => String(value)
  .replace(/\s+/g, ' ')
  .trim()

const splitSentences = (content) => compactText(content)
  .split(/(?<=[。！？；])/)
  .map((sentence) => sentence.trim())
  .filter((sentence) => sentence.length >= 12)

const extractTitleKeywords = (title, theme) => [...new Set([
  ...compactText(title).split(/[\s，。、；：（）()《》]+/),
  ...compactText(theme).split(/[\s，、/]+/),
].filter((word) => word.length >= 2 && word.length <= 12))].slice(0, 12)

const createExtractiveSummary = (content, title, theme) => {
  const sentences = splitSentences(content)
  const keywords = extractTitleKeywords(title, theme)
  const scored = sentences.map((sentence, index) => {
    const keywordScore = keywords.reduce((score, keyword) => score + (sentence.includes(keyword) ? 2 : 0), 0)
    const policyCueScore = /适用|要求|鼓励|支持|禁止|应当|不得|实施|申报|推荐|标准|监督|管理/.test(sentence) ? 2 : 0
    const positionScore = index < 5 ? 3 - index * 0.4 : 0
    return { sentence, index, score: keywordScore + policyCueScore + positionScore }
  })
  const selected = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence)
  const summary = selected.join('') || compactText(content).slice(0, 600)
  return summary.slice(0, 900)
}

const extractKeyPoints = (content) => {
  const matches = [...String(content).matchAll(/(?:^|\n)\s*([一二三四五六七八九十]+、[^\n。]{2,40}|（[一二三四五六七八九十]+）[^\n。]{2,40})/g)]
    .map((match) => compactText(match[1]))
  if (matches.length > 0) return [...new Set(matches)].slice(0, 8)
  return splitSentences(content).filter((sentence) => /要求|范围|目标|任务|措施|程序|标准/.test(sentence)).slice(0, 6)
}

const deriveIssuingLocation = ({ title, publisher, source }) => {
  const combined = `${title} ${publisher} ${source}`
  const location = combined.match(LOCATION_PATTERN)?.[1]
  if (location) return location
  if (CENTRAL_AUTHORITY_PATTERN.test(combined)) return '中央部门'
  return '待模型识别'
}

const deriveDocumentName = (title) => {
  const normalized = compactText(title)
  const aboutIndex = normalized.indexOf('关于')
  return aboutIndex >= 0 ? normalized.slice(aboutIndex + 2) : normalized
}

export const preprocessPolicy = (policy) => {
  const content = compactText(policy.content || policy.contentPreview || '')
  const titleJson = {
    originalTitle: compactText(policy.title),
    issuingAuthority: compactText(policy.publisher) || '待识别',
    issuingLocation: deriveIssuingLocation(policy),
    documentName: deriveDocumentName(policy.title),
    documentNumber: compactText(policy.documentNumber) || '未公开',
    documentType: compactText(policy.documentType) || '待识别',
  }
  const contentJson = {
    summary: createExtractiveSummary(content, policy.title, policy.theme),
    keyPoints: extractKeyPoints(policy.content || ''),
    topics: extractTitleKeywords(policy.title, policy.theme),
    sourceCharacterCount: content.length,
    sourceType: policy.contentSource || 'unknown',
    isFullText: policy.contentSource === 'official-detail-page',
    publishedAt: policy.publishedAt || '',
    sourceUrl: policy.url || '',
  }
  return {
    policyId: policy.id,
    title: titleJson,
    content: contentJson,
  }
}

const normalizeClassification = (value) => {
  const administrativeLevel = ADMINISTRATIVE_LEVELS.includes(value?.administrativeLevel)
    ? value.administrativeLevel
    : '其他'
  const policyCategory = POLICY_CATEGORIES.includes(value?.policyCategory)
    ? value.policyCategory
    : '通用政策'
  const confidence = Number(value?.confidence)
  return {
    administrativeLevel,
    policyCategory,
    confidence: Number.isFinite(confidence) ? Math.min(Math.max(confidence, 0), 1) : 0,
    reasoning: compactText(value?.reasoning || '模型未提供判断说明'),
    evidence: Array.isArray(value?.evidence)
      ? value.evidence.slice(0, 5).map((item) => compactText(item)).filter(Boolean)
      : [],
  }
}

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

const buildPrompt = (preprocessing) => `你是一名企业政策研究助手。请根据下面已经结构化的政策信息判断政策层级和适用类型。

判断要求：
1. administrativeLevel 只能是：国家级、省级、市级、区县级、其他。
2. policyCategory 只能是：通用政策、产业政策。
3. 产业政策指明确面向某个产业、行业、产品或技术领域的政策；通用政策指跨行业普遍适用的政策。
4. 模型结论仅供人工参考，reasoning 必须说明判断依据。
5. evidence 返回 1 至 5 条来自输入 JSON 的简短依据，不得编造原文。

只返回一个 JSON 对象，不要返回 Markdown：
{
  "administrativeLevel": "国家级",
  "policyCategory": "产业政策",
  "confidence": 0.85,
  "reasoning": "判断说明",
  "evidence": ["依据一", "依据二"]
}

政策 JSON：
${JSON.stringify(preprocessing)}`

const resolveChatCompletionsUrl = (baseUrl) => {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

const callModel = async (preprocessing, config, signal) => {
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
        { role: 'system', content: '你负责对中国政策文件做审慎分类，只能依据输入材料输出 JSON。' },
        { role: 'user', content: buildPrompt(preprocessing) },
      ],
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || `模型接口返回 HTTP ${response.status}`)
  }
  const content = body?.choices?.[0]?.message?.content
  return normalizeClassification(parseModelJson(content))
}

export const analyzePolicies = async (policies, { config = {}, signal } = {}) => {
  const safePolicies = Array.isArray(policies) ? policies.slice(0, 20) : []
  const configured = Boolean(config.baseUrl && config.model && config.apiKey)
  const results = []

  for (const policy of safePolicies) {
    const preprocessing = preprocessPolicy(policy)
    if (!configured) {
      results.push({
        policyId: policy.id,
        status: 'model_unconfigured',
        preprocessing,
        classification: null,
      })
      continue
    }
    try {
      const classification = await callModel(preprocessing, config, signal)
      results.push({ policyId: policy.id, status: 'completed', preprocessing, classification })
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') throw error
      results.push({
        policyId: policy.id,
        status: 'error',
        preprocessing,
        classification: null,
        error: error instanceof Error ? error.message : '模型分析失败',
      })
    }
  }

  return {
    configured,
    model: configured ? config.model : null,
    results,
    analyzedAt: new Date().toISOString(),
  }
}
