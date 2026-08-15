import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const BILINGUAL_MODES = ['parallel', 'english-only']
export const BILINGUAL_LANGUAGES = ['zh', 'en']

const INITIAL_GLOSSARY = [
  ['蒸发器', 'evaporator'],
  ['化霜', 'defrost'],
  ['隔热', 'thermal insulation'],
  ['制冷剂', 'refrigerant'],
  ['冷凝器', 'condenser'],
  ['压缩机', 'compressor'],
  ['冷藏室', 'refrigerator compartment'],
  ['冷冻室', 'freezer compartment'],
  ['能效等级', 'energy efficiency class'],
  ['额定功率', 'rated power'],
]

const compact = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
const now = () => new Date().toISOString()
const hash = (value) => createHash('sha256').update(String(value)).digest('hex')

const createInitialState = () => ({
  glossary: INITIAL_GLOSSARY.map(([source, target]) => ({
    id: `term-${hash(source).slice(0, 12)}`,
    source,
    target,
    domain: 'refrigeration',
    notes: '',
    createdAt: now(),
    updatedAt: now(),
  })),
  translations: [],
})

const clone = (value) => JSON.parse(JSON.stringify(value))

const normalizeGlossaryEntry = (input, existing = {}) => {
  const source = compact(input?.source)
  const target = compact(input?.target)
  if (!source || !target) throw new Error('术语必须同时填写中文和英文译法')
  return {
    id: existing.id || input?.id || `term-${randomUUID()}`,
    source,
    target,
    domain: compact(input?.domain || existing.domain || 'general'),
    notes: compact(input?.notes || existing.notes || ''),
    createdAt: existing.createdAt || now(),
    updatedAt: now(),
  }
}

const splitSource = (content) => {
  const normalized = String(content ?? '').replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  return normalized
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .flatMap((text) => /^#{1,6}\s/.test(text) && text.includes('\n')
      ? text.split(/\n(?=#{1,6}\s)/).map((part) => part.trim()).filter(Boolean)
      : [text])
}

const resolveChatCompletionsUrl = (baseUrl) => {
  const normalized = String(baseUrl || '').replace(/\/+$/, '')
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`
}

const extractContent = (content) => Array.isArray(content)
  ? content.map((item) => item?.text || '').join('\n').trim()
  : String(content || '').trim()

const parseJsonArray = (content) => {
  const text = extractContent(content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) throw new Error('翻译模型未返回有效的段落数组')
  const parsed = JSON.parse(text.slice(start, end + 1))
  if (!Array.isArray(parsed)) throw new Error('翻译模型返回的段落不是数组')
  return parsed
}

const buildPrompt = (segments, glossary, mode) => `你是严谨的制冷与家电标准翻译专家。请将下面的中文标准文档按段落翻译成英文。

要求：
1. 只返回 JSON 数组，每项格式为 {"id":"原段落 id","text":"英文译文"}，不要 Markdown 代码围栏或解释。
2. 保留条款编号、标题层级、单位、数值、公式、引用编号和列表结构，不得增删事实。
3. 优先使用术语库译法；同一术语在全文中必须保持一致。
4. ${mode === 'english-only' ? '输出适合纯英文发布的自然、正式标准文本。' : '英文应与中文段落一一对应，便于左右对照。'}

术语库：
${JSON.stringify(glossary.map((term) => ({ source: term.source, target: term.target })), null, 2)}

中文段落：
${JSON.stringify(segments.map((segment) => ({ id: segment.id, text: segment.sourceZh })), null, 2)}`

const callTranslator = async ({ segments, glossary, mode, config, signal }) => {
  if (!config?.baseUrl || !config?.model || !config?.apiKey) {
    throw new Error('双语翻译模型尚未配置，请设置 POLICY_LLM_BASE_URL、POLICY_LLM_MODEL 和 POLICY_LLM_API_KEY')
  }
  const response = await fetch(resolveChatCompletionsUrl(config.baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.1,
      max_tokens: Math.min(12000, Math.max(2000, segments.length * 500)),
      thinking: { type: 'disabled' },
      messages: [
        { role: 'system', content: 'You translate Chinese refrigeration standards into precise technical English. Return only JSON.' },
        { role: 'user', content: buildPrompt(segments, glossary, mode) },
      ],
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error?.message || body?.message || `翻译模型返回 HTTP ${response.status}`)
  return parseJsonArray(body?.choices?.[0]?.message?.content)
}

const snapshot = (translation, language, author, reason) => ({
  version: (translation.versions?.[language]?.length || 0) + 1,
  language,
  author: compact(author) || 'system',
  reason: compact(reason) || '保存版本',
  createdAt: now(),
  segments: clone(translation.segments.map((segment) => ({
    id: segment.id,
    text: language === 'zh' ? segment.sourceZh : segment.targetEn,
  }))),
})

const makeDownloads = (translation) => {
  const title = translation.title || '双语标准文档'
  const zh = translation.segments.map((segment) => segment.sourceZh).join('\n\n')
  const en = translation.segments.map((segment) => segment.targetEn).join('\n\n')
  const parallel = [
    `# ${title}`,
    '',
    '| 中文 | English |',
    '| --- | --- |',
    ...translation.segments.map((segment) => `| ${segment.sourceZh.replace(/\|/g, '\\|').replace(/\n/g, '<br>')} | ${segment.targetEn.replace(/\|/g, '\\|').replace(/\n/g, '<br>')} |`),
    '',
  ].join('\n')
  return { zh, en, parallel }
}

export const createBilingualService = ({ storePath, config = {} } = {}) => {
  let state = null
  let writeQueue = Promise.resolve()

  const load = async () => {
    if (state) return state
    try {
      state = JSON.parse(await readFile(storePath, 'utf8'))
    } catch {
      state = createInitialState()
      await persist()
    }
    state.glossary ||= []
    state.translations ||= []
    return state
  }

  const persist = async () => {
    writeQueue = writeQueue.then(async () => {
      await mkdir(dirname(storePath), { recursive: true })
      await writeFile(storePath, JSON.stringify(state, null, 2), 'utf8')
    })
    return writeQueue
  }

  const listGlossary = async () => clone((await load()).glossary.sort((a, b) => a.source.localeCompare(b.source)))

  const createGlossaryTerm = async (input) => {
    const current = await load()
    const duplicate = current.glossary.find((term) => term.source === compact(input?.source))
    if (duplicate) throw new Error('中文术语已存在，请直接修改现有术语')
    const term = normalizeGlossaryEntry(input)
    current.glossary.push(term)
    await persist()
    return clone(term)
  }

  const updateGlossaryTerm = async (id, input) => {
    const current = await load()
    const index = current.glossary.findIndex((term) => term.id === id)
    if (index < 0) throw new Error('术语不存在')
    const duplicate = current.glossary.find((term) => term.source === compact(input?.source) && term.id !== id)
    if (duplicate) throw new Error('中文术语已存在，请直接修改现有术语')
    const term = normalizeGlossaryEntry(input, current.glossary[index])
    current.glossary[index] = term
    await persist()
    return clone(term)
  }

  const deleteGlossaryTerm = async (id) => {
    const current = await load()
    const index = current.glossary.findIndex((term) => term.id === id)
    if (index < 0) throw new Error('术语不存在')
    current.glossary.splice(index, 1)
    await persist()
  }

  const createTranslation = async ({ document, mode = 'parallel', author = 'system', signal } = {}) => {
    if (!document?.content || !compact(document.title)) throw new Error('缺少待翻译文档的标题或正文')
    if (!BILINGUAL_MODES.includes(mode)) throw new Error('mode 只能是 parallel 或 english-only')
    const current = await load()
    const sourceParts = splitSource(document.content)
    if (!sourceParts.length) throw new Error('待翻译文档没有可用段落')
    if (sourceParts.length > 200) throw new Error('单份文档最多支持 200 个对齐段落')
    const sourceSegments = sourceParts.map((sourceZh, index) => ({ id: `segment-${index + 1}`, order: index + 1, sourceZh }))
    const translated = await callTranslator({ segments: sourceSegments, glossary: current.glossary, mode, config, signal })
    const byId = new Map(translated.map((item) => [String(item?.id), compact(item?.text)]))
    const segments = sourceSegments.map((segment) => {
      const targetEn = byId.get(segment.id)
      if (!targetEn) throw new Error(`翻译模型缺少段落 ${segment.id}`)
      return { ...segment, targetEn, status: 'machine', updatedAt: now() }
    })
    const translation = {
      id: `translation-${randomUUID()}`,
      title: compact(document.title),
      sourceDocumentId: compact(document.id) || null,
      sourceHash: hash(document.content),
      mode,
      segments,
      glossaryVersion: now(),
      createdAt: now(),
      updatedAt: now(),
      versions: { zh: [], en: [] },
      metadata: { author: compact(author) || 'system', model: config.model || null },
    }
    translation.versions.zh.push(snapshot(translation, 'zh', author, '初始中文版本'))
    translation.versions.en.push(snapshot(translation, 'en', author, '机器翻译初稿'))
    current.translations.push(translation)
    await persist()
    return clone(translation)
  }

  const getTranslation = async (id) => {
    const translation = (await load()).translations.find((item) => item.id === id)
    if (!translation) throw new Error('双语文档不存在')
    return clone(translation)
  }

  const listTranslations = async () => clone((await load()).translations.map((item) => ({
    id: item.id, title: item.title, mode: item.mode, sourceDocumentId: item.sourceDocumentId,
    sourceHash: item.sourceHash, segmentCount: item.segments.length, createdAt: item.createdAt, updatedAt: item.updatedAt,
  })))

  const reviseTranslation = async (id, { language, segments, author, reason } = {}) => {
    if (!BILINGUAL_LANGUAGES.includes(language)) throw new Error('language 只能是 zh 或 en')
    if (!Array.isArray(segments) || !segments.length) throw new Error('segments 不能为空')
    const current = await load()
    const translation = current.translations.find((item) => item.id === id)
    if (!translation) throw new Error('双语文档不存在')
    const updates = new Map(segments.map((item) => [String(item?.id), compact(item?.text)]))
    let changed = 0
    translation.segments.forEach((segment) => {
      if (!updates.has(segment.id)) return
      const value = updates.get(segment.id)
      if (!value) throw new Error(`段落 ${segment.id} 内容不能为空`)
      if (language === 'zh') segment.sourceZh = value
      else segment.targetEn = value
      segment.status = language === 'en' ? 'reviewed' : segment.status
      segment.updatedAt = now()
      changed += 1
    })
    if (changed === 0) throw new Error('没有匹配的段落 ID')
    translation.updatedAt = now()
    translation.versions[language].push(snapshot(translation, language, author, reason))
    await persist()
    return clone(translation)
  }

  const getDownload = async (id, language = 'parallel') => {
    if (!['zh', 'en', 'parallel'].includes(language)) throw new Error('下载 language 只能是 zh、en 或 parallel')
    const translation = await getTranslation(id)
    const content = makeDownloads(translation)[language]
    return { translation, content, fileName: `${translation.title}-${language === 'zh' ? '中文' : language === 'en' ? 'English' : '中英对照'}.md` }
  }

  return { listGlossary, createGlossaryTerm, updateGlossaryTerm, deleteGlossaryTerm, createTranslation, getTranslation, listTranslations, reviseTranslation, getDownload }
}
