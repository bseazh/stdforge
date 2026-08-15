import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const SKILL_FILES = {
  'policy-expert-interpretation': {
    name: '专家解读型',
    skill: fileURLToPath(new URL('../skills/policy-expert-interpretation/SKILL.md', import.meta.url)),
    framework: fileURLToPath(new URL('../skills/policy-expert-interpretation/references/framework.md', import.meta.url)),
  },
  'policy-clause-analysis': {
    name: '条款拆解型',
    skill: fileURLToPath(new URL('../skills/policy-clause-analysis/SKILL.md', import.meta.url)),
    framework: fileURLToPath(new URL('../skills/policy-clause-analysis/references/framework.md', import.meta.url)),
  },
}

const instructionCache = new Map()

const compactText = (value = '') => String(value).replace(/\s+/g, ' ').trim()

const resolveChatCompletionsUrl = (baseUrl) => {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

const loadSkillInstructions = async (skillId) => {
  if (instructionCache.has(skillId)) return instructionCache.get(skillId)
  const definition = SKILL_FILES[skillId]
  if (!definition) throw new Error('不支持的政策分析类型')
  const [skill, framework] = await Promise.all([
    readFile(definition.skill, 'utf8'),
    readFile(definition.framework, 'utf8'),
  ])
  const instructions = `# Skill 主说明\n${skill}\n\n# 详细输出框架\n${framework}`
  instructionCache.set(skillId, instructions)
  return instructions
}

const extractModelContent = (content) => Array.isArray(content)
  ? content.map((item) => item?.text || '').join('\n').trim()
  : String(content || '').trim()

const buildAnalysisPrompt = ({ policy, audience, skillName, instructions }) => {
  const analysisDate = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return `请严格按照下面的 Skill 指令和框架，对指定政策生成一份完整 Markdown 报告。

本次分析配置：
- 分析类型：${skillName}
- 分析主体：${audience}
- 本次解读日期：${analysisDate}
- 要求：报告应面向“${audience}”组织重点、责任和行动建议；不得编造政策原文未提供的事实。
- 证据边界：结论必须以政策标题、元数据和正文为依据；无法确认的信息必须明确标记为待核实。
- 日期约束：政策发布日期只能原样使用下面元数据中的 publishedAt；不得从标题、文号或上下文推断其他发布日期。解读日期只能使用上面的本次解读日期。
- 模板边界：Skill 框架中的示例、占位符和示例日期只用于说明格式，绝不能作为本政策事实写入报告。
- 输出要求：只输出 Markdown 报告正文，不要使用代码围栏，不要解释生成过程。

政策元数据：
${JSON.stringify({
  title: compactText(policy.title),
  publisher: compactText(policy.publisher),
  publishedAt: policy.publishedAt || '',
  documentNumber: compactText(policy.documentNumber),
  documentType: compactText(policy.documentType),
  theme: compactText(policy.theme),
  source: compactText(policy.source),
  sourceUrl: policy.url || '',
}, null, 2)}

政策完整正文：
${String(policy.content || policy.contentPreview || '').trim()}

Skill 指令与框架：
${instructions}`
}

export const interpretPolicy = async ({ policy, skillId, audience }, { config = {}, signal } = {}) => {
  if (!policy?.id || !policy?.title) throw new Error('缺少需要分析的政策文件')
  if (!SKILL_FILES[skillId]) throw new Error('请选择有效的政策分析类型')
  if (!compactText(audience)) throw new Error('请选择分析主体')
  if (!config.baseUrl || !config.model || !config.apiKey) throw new Error('政策分析模型尚未配置')

  const instructions = await loadSkillInstructions(skillId)
  const definition = SKILL_FILES[skillId]
  const response = await fetch(resolveChatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.15,
      max_tokens: 6000,
      thinking: { type: 'disabled' },
      messages: [
        {
          role: 'system',
          content: '你是一名严谨的中国政策研究与企业合规分析助手。必须遵循给定 Skill，不得编造政策事实，只输出 Markdown 报告。',
        },
        {
          role: 'user',
          content: buildAnalysisPrompt({ policy, audience: compactText(audience), skillName: definition.name, instructions }),
        },
      ],
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  })

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || `模型接口返回 HTTP ${response.status}`)
  }
  const choice = body?.choices?.[0]
  const report = extractModelContent(choice?.message?.content)
  if (!report) {
    const finishReason = choice?.finish_reason ? `，结束原因：${choice.finish_reason}` : ''
    throw new Error(`模型未返回政策分析报告${finishReason}`)
  }

  return {
    policyId: policy.id,
    skillId,
    audience: compactText(audience),
    model: config.model,
    report,
    generatedAt: new Date().toISOString(),
  }
}
