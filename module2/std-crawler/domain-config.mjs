// 领域主题配置中枢：内置默认 + 用户自定义（domain-config.json），统一各管线相关度评分/领域过滤口径
// 一个「领域」= 关键词(召回) + 类型 + ICS/CCS 白名单(加权) + 相关度阈值 + 标题领域词(硬过滤)
//
// 用法：
//   node domain-config.mjs list                                    # 列出所有领域（内置+自定义）
//   node domain-config.mjs show <名称>                             # 查看某领域完整配置
//   node domain-config.mjs add <名称> --keywords 冰箱,保鲜 --ics "^97\.(03|04)" --ccs "^Y6" --threshold 80 --types gb,hb,db,plan
//   node domain-config.mjs remove <名称>                           # 删除自定义领域（内置领域只能覆盖不能删除）
//   node domain-config.mjs reset                                   # 清空全部自定义配置
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const DEFAULT_DOMAIN = '家电制冷保鲜'
export const USER_CONFIG_FILE = join(__dirname, 'domain-config.json')

// 内置默认领域：家电制冷保鲜（与既有硬编码口径一致；白名单用字符串正则，JSON 可序列化）
const BUILTIN_DOMAINS = {
  [DEFAULT_DOMAIN]: {
    keywords: ['冰箱', '保鲜', '食品保鲜', '制冷', '家用电器', '家电'],
    types: ['gb', 'hb', 'db', 'plan'],
    icsWhitelist: ['^97\\.(03|04)'],
    ccsWhitelist: ['^Y6'],
    relevanceThreshold: 80,
    titlePattern: '冰箱|冷藏|冷柜|制冷器具|保鲜',
    titleFallback: '冰箱|冷柜',
  },
}

// ---------- 白名单工具（collection-pipeline 原实现迁移至此，供全模块共享） ----------
export const matchWhitelist = (value, patterns) => (Array.isArray(patterns) ? patterns : []).some((pattern) => {
  if (pattern instanceof RegExp) return pattern.test(String(value || ''))
  return String(value || '').startsWith(String(pattern))
})

const toRegExp = (pattern) => (pattern instanceof RegExp ? pattern : new RegExp(pattern))

// 字符串正则数组 → RegExp 数组（用户配置来自 JSON，运行时统一转 RegExp）
const normalizeWhitelist = (patterns) => (Array.isArray(patterns) ? patterns : []).map(toRegExp)

// ---------- 加载：内置默认 < 用户自定义（domain-config.json 同名覆盖） ----------
export const loadUserDomains = () => {
  try {
    if (!existsSync(USER_CONFIG_FILE)) return {}
    const parsed = JSON.parse(readFileSync(USER_CONFIG_FILE, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    console.warn(`[domain-config] 读取 ${USER_CONFIG_FILE} 失败（${error?.message || error}），仅使用内置默认`)
    return {}
  }
}

// 获取某领域运行时配置：用户配置的字段缺失时回退内置默认；显式写 [] 表示关闭该白名单
// 注意：titlePattern/titleFallback（标题领域词）仅内置默认领域回退内置值；
//       自定义领域缺省为 ''（不做标题词硬过滤，纯靠 ICS/CCS 白名单 + 关键词）
export const getDomain = (name = DEFAULT_DOMAIN) => {
  const key = String(name || '').trim() || DEFAULT_DOMAIN
  const userDomains = loadUserDomains()
  const raw = userDomains[key] || {}
  const base = BUILTIN_DOMAINS[DEFAULT_DOMAIN] || {}
  const isBuiltin = key === DEFAULT_DOMAIN
  return {
    name: key,
    keywords: Array.isArray(raw.keywords) && raw.keywords.length > 0
      ? raw.keywords.map((item) => String(item).trim()).filter(Boolean)
      : [...(base.keywords || [])],
    types: Array.isArray(raw.types) && raw.types.length > 0
      ? raw.types.filter((type) => ['gb', 'hb', 'db', 'plan'].includes(type))
      : [...(base.types || [])],
    icsWhitelist: normalizeWhitelist(Array.isArray(raw.icsWhitelist) ? raw.icsWhitelist : base.icsWhitelist),
    ccsWhitelist: normalizeWhitelist(Array.isArray(raw.ccsWhitelist) ? raw.ccsWhitelist : base.ccsWhitelist),
    relevanceThreshold: raw.relevanceThreshold != null
      ? Math.min(Math.max(Number(raw.relevanceThreshold) || 0, 0), 100)
      : (base.relevanceThreshold ?? 80),
    titlePattern: String(raw.titlePattern != null ? raw.titlePattern : (isBuiltin ? base.titlePattern || '' : '')),
    titleFallback: String(raw.titleFallback != null ? raw.titleFallback : (isBuiltin ? base.titleFallback || '' : '')),
  }
}

export const getDefaultDomain = () => getDomain(DEFAULT_DOMAIN)

// ---------- 保存：写回 domain-config.json（仅存自定义内容，内置默认不落盘） ----------
export const saveUserDomains = (domains) => {
  const normalized = {}
  for (const [name, domain] of Object.entries(domains || {})) {
    if (!name || !domain || typeof domain !== 'object') continue
    const entry = {}
    if (Array.isArray(domain.keywords)) entry.keywords = domain.keywords.map((item) => String(item).trim()).filter(Boolean)
    if (Array.isArray(domain.types)) entry.types = domain.types.filter((type) => ['gb', 'hb', 'db', 'plan'].includes(type))
    if (Array.isArray(domain.icsWhitelist)) entry.icsWhitelist = domain.icsWhitelist.map(String)
    if (Array.isArray(domain.ccsWhitelist)) entry.ccsWhitelist = domain.ccsWhitelist.map(String)
    if (domain.relevanceThreshold != null) entry.relevanceThreshold = Math.min(Math.max(Number(domain.relevanceThreshold) || 0, 0), 100)
    if (domain.titlePattern != null) entry.titlePattern = String(domain.titlePattern)
    if (domain.titleFallback != null) entry.titleFallback = String(domain.titleFallback)
    normalized[name] = entry
  }
  writeFileSync(USER_CONFIG_FILE, JSON.stringify(normalized, null, 2) + '\n', 'utf8')
  return normalized
}

// ---------- CLI ----------
const isMainModule = (() => {
  try {
    return Boolean(process.argv[1]) && pathToFileURL(process.argv[1]).href === import.meta.url
  } catch {
    return false
  }
})()

const parseArgs = (argv) => {
  const result = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq > -1) {
        result[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        result[arg.slice(2)] = argv[++i]
      } else {
        result[arg.slice(2)] = true
      }
    } else {
      result._.push(arg)
    }
  }
  return result
}

const splitList = (value) => (Array.isArray(value) ? value : String(value || '').split(','))
  .map((item) => String(item).trim()).filter(Boolean)

const runCli = async () => {
  const [command, name, ...rest] = process.argv.slice(2)
  const args = parseArgs(rest)
  const userDomains = loadUserDomains()

  switch (command) {
    case 'list': {
      const all = { ...BUILTIN_DOMAINS, ...userDomains }
      console.log(`领域配置（${Object.keys(all).length} 个）：`)
      for (const key of Object.keys(all)) {
        const builtin = key in BUILTIN_DOMAINS
        const custom = key in userDomains
        const mark = builtin && custom ? '(内置+自定义覆盖)' : builtin ? '(内置)' : '(自定义)'
        console.log(`  - ${key} ${mark}`)
        console.log(`      关键词: ${all[key].keywords?.join('、') || '（未配置）'}`)
        console.log(`      ICS 白名单: ${(all[key].icsWhitelist || []).join(' | ') || '（未配置）'}`)
        console.log(`      CCS 白名单: ${(all[key].ccsWhitelist || []).join(' | ') || '（未配置）'}`)
        console.log(`      阈值: ${all[key].relevanceThreshold ?? '（未配置）'} | 类型: ${(all[key].types || []).join(',') || '（未配置）'}`)
      }
      console.log(`\n自定义配置保存在 ${USER_CONFIG_FILE}`)
      return
    }
    case 'show': {
      const domain = getDomain(name)
      console.log(`领域「${domain.name}」：`)
      console.log(`  关键词: ${domain.keywords.join('、')}`)
      console.log(`  类型: ${domain.types.join(',')}`)
      console.log(`  ICS 白名单: ${domain.icsWhitelist.map((p) => p.toString()).join(' | ') || '（关闭）'}`)
      console.log(`  CCS 白名单: ${domain.ccsWhitelist.map((p) => p.toString()).join(' | ') || '（关闭）'}`)
      console.log(`  相关度阈值: ${domain.relevanceThreshold}`)
      console.log(`  标题领域词: ${domain.titlePattern || '（无）'}`)
      console.log(`  标题兜底词: ${domain.titleFallback || '（无）'}`)
      return
    }
    case 'add': {
      if (!name) {
        console.error('用法：node domain-config.mjs add <名称> [--keywords a,b] [--types gb,hb] [--ics "regex"] [--ccs "regex"] [--threshold 80] [--titlePattern "regex"] [--titleFallback "regex"]')
        process.exit(1)
      }
      const current = userDomains[name] || {}
      const updated = {
        keywords: args.keywords ? splitList(args.keywords) : current.keywords,
        types: args.types ? splitList(args.types) : current.types,
        icsWhitelist: args.ics ? splitList(args.ics) : current.icsWhitelist,
        ccsWhitelist: args.ccs ? splitList(args.ccs) : current.ccsWhitelist,
        relevanceThreshold: args.threshold != null ? Number(args.threshold) : current.relevanceThreshold,
        titlePattern: args.titlePattern != null ? String(args.titlePattern) : current.titlePattern,
        titleFallback: args.titleFallback != null ? String(args.titleFallback) : current.titleFallback,
      }
      const saved = saveUserDomains({ ...userDomains, [name]: updated })
      const isOverride = name in BUILTIN_DOMAINS
      console.log(`已保存领域「${name}」${isOverride ? '（覆盖内置默认）' : '（新增自定义）'} → ${USER_CONFIG_FILE}`)
      getDomain(name)
      console.log('生效配置：')
      console.log(`  关键词: ${getDomain(name).keywords.join('、')}`)
      console.log(`  ICS 白名单: ${getDomain(name).icsWhitelist.map((p) => p.toString()).join(' | ')}`)
      console.log(`  CCS 白名单: ${getDomain(name).ccsWhitelist.map((p) => p.toString()).join(' | ')}`)
      console.log(`  阈值: ${getDomain(name).relevanceThreshold}`)
      console.log(`已保存 ${Object.keys(saved).length} 个自定义领域`)
      return
    }
    case 'remove': {
      if (!name) {
        console.error('用法：node domain-config.mjs remove <名称>')
        process.exit(1)
      }
      if (!(name in userDomains)) {
        console.log(`领域「${name}」没有自定义配置${name in BUILTIN_DOMAINS ? '（内置领域不可删除，可用 add 覆盖）' : ''}`)
        return
      }
      const { [name]: _removed, ...restDomains } = userDomains
      saveUserDomains(restDomains)
      console.log(`已删除自定义领域「${name}」`)
      return
    }
    case 'reset': {
      if (existsSync(USER_CONFIG_FILE)) {
        writeFileSync(USER_CONFIG_FILE, '{}\n', 'utf8')
        console.log(`已清空全部自定义配置（${USER_CONFIG_FILE}），恢复内置默认`)
      } else {
        console.log('无自定义配置文件')
      }
      return
    }
    default:
      console.log(`用法：node domain-config.mjs <list|show|add|remove|reset>
  list                     列出所有领域
  show <名称>              查看某领域配置
  add <名称> [--keywords a,b] [--types gb,hb] [--ics "regex"] [--ccs "regex"] [--threshold 80] [--titlePattern "regex"] [--titleFallback "regex"]
  remove <名称>            删除自定义领域（内置只能覆盖）
  reset                    清空全部自定义配置`)
      return
  }
}

if (isMainModule) {
  runCli().catch((error) => {
    console.error(`[domain-config] CLI 执行失败：${error?.stack || error}`)
    process.exit(1)
  })
}
