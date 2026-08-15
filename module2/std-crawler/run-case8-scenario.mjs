// 案例8实际场景测试：冰箱保鲜领域竞争对手标准布局分析（真实数据）
// 流程：高级检索(关键词×类型×近5年) → 家电制冷领域过滤 → 并行详情补抓(显式键值)
//       → hbba 起草单位补抓 → LLM 结构化提取 → 集团/领域/趋势聚合 → Markdown 报告
// 运行：node run-case8-scenario.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  crawlSamrStandards,
  enrichHbbaDraftUnits,
  extractStandardsWithLlm,
  hydrateSamrStandardDetails,
} from './crawl-samr.mjs'
import { isApplianceFreshness } from './analysis-pipeline.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------- 检索条件配置（case8-config.json：修改保存后，下次运行自动加载） ----------
const QUERY_CONFIG_PATH = join(__dirname, 'case8-config.json')
const LLM_CONFIG_PATH = join(__dirname, 'ds配置.json')
const OUTPUT_DIR = join(__dirname, 'output')
const RAW_PATH = join(OUTPUT_DIR, 'case8-scenario-raw.json')
const REPORT_PATH = join(OUTPUT_DIR, 'case8-scenario-report.md')
const DATA_PATH = join(OUTPUT_DIR, 'case8-scenario-data.json')
const DEFAULT_QUERY_CONFIG = {
  keywords: ['冰箱', '保鲜', '食品保鲜', '制冷', '家用电器', '家电'],
  types: ['gb', 'hb', 'db', 'plan'],
  startDate: '2021-01-01',
  endDate: '2026-08-15',
  maxPages: 1,
  pageSize: 20,
  maxItems: 24,
  searchConcurrency: 3,
  llmConcurrency: 5,
  groups: [
    { group: '海信系', keywords: ['海信'], region: '广东省' },
    { group: '美的', keywords: ['美的'], region: '广东省' },
    { group: '海尔', keywords: ['海尔'], region: '山东省' },
    { group: '格力', keywords: ['格力'], region: '广东省' },
    { group: '美菱', keywords: ['美菱', '华凌'], region: '安徽省' },
  ],
}

const loadQueryConfig = () => {
  try {
    const parsed = JSON.parse(readFileSync(QUERY_CONFIG_PATH, 'utf8'))
    return {
      keywords: Array.isArray(parsed.keywords) && parsed.keywords.length > 0
        ? parsed.keywords.map((item) => String(item).trim()).filter(Boolean)
        : DEFAULT_QUERY_CONFIG.keywords,
      types: Array.isArray(parsed.types) && parsed.types.length > 0
        ? parsed.types.filter((type) => ['gb', 'hb', 'db', 'plan'].includes(type))
        : DEFAULT_QUERY_CONFIG.types,
      startDate: String(parsed.startDate || DEFAULT_QUERY_CONFIG.startDate),
      endDate: String(parsed.endDate || DEFAULT_QUERY_CONFIG.endDate),
      maxPages: Math.min(Math.max(Number(parsed.maxPages) || DEFAULT_QUERY_CONFIG.maxPages, 1), 5),
      pageSize: Math.min(Math.max(Number(parsed.pageSize) || DEFAULT_QUERY_CONFIG.pageSize, 1), 50),
      maxItems: Math.min(Math.max(Number(parsed.maxItems) || DEFAULT_QUERY_CONFIG.maxItems, 1), 60),
      searchConcurrency: Math.min(Math.max(Number(parsed.searchConcurrency) || DEFAULT_QUERY_CONFIG.searchConcurrency, 1), 6),
      llmConcurrency: Math.min(Math.max(Number(parsed.llmConcurrency) || DEFAULT_QUERY_CONFIG.llmConcurrency, 1), 8),
      groups: Array.isArray(parsed.groups) && parsed.groups.length > 0
        ? parsed.groups
          .map((group) => ({
            group: String(group?.group || '').trim(),
            keywords: Array.isArray(group?.keywords) ? group.keywords.map((item) => String(item).trim()).filter(Boolean) : [],
            region: String(group?.region || '').trim(),
          }))
          .filter((group) => group.group && group.keywords.length > 0)
        : DEFAULT_QUERY_CONFIG.groups,
    }
  } catch (error) {
    console.log(`[配置] 读取 ${QUERY_CONFIG_PATH} 失败（${error?.message || error}），使用代码默认值`)
    return { ...DEFAULT_QUERY_CONFIG, groups: [...DEFAULT_QUERY_CONFIG.groups] }
  }
}

const queryConfig = loadQueryConfig()
console.log(`[配置] 已加载 ${QUERY_CONFIG_PATH}：关键词=${queryConfig.keywords.join('、')} 类型=${queryConfig.types.join(',')} 窗口=${queryConfig.startDate}~${queryConfig.endDate} 并发=检索${queryConfig.searchConcurrency}/LLM${queryConfig.llmConcurrency}`)

// ---------- 可配置业务词典（对应案例8“自定义企业集团关联关系”，来自配置文件） ----------
const GROUP_RULES = queryConfig.groups

const matchGroup = (unit) => GROUP_RULES.find((rule) => rule.keywords.some((keyword) => unit.includes(keyword)))

// ---------- 场景范围：家电制冷保鲜领域（复用 analysis-pipeline 领域过滤，口径来自 domain-config.mjs） ----------

// 计划与已发布标准合并：同一标准号优先保留已发布版（gb/hb/db），计划版仅补充计划号/制修订信息
const mergePlanAndPublished = (standards) => {
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

// ---------- 读取模型配置（ds配置.json，避免密钥出现在命令行/日志） ----------
const readLlmConfig = () => {
  try {
    const parsed = JSON.parse(readFileSync(LLM_CONFIG_PATH, 'utf8'))
    return {
      baseUrl: parsed?.provider?.deepseek?.options?.baseURL || process.env.STD_LLM_BASE_URL || '',
      model: process.env.STD_LLM_MODEL || 'deepseek-v4-flash',
      apiKey: parsed?.provider?.deepseek?.options?.apiKey || process.env.STD_LLM_API_KEY || '',
    }
  } catch {
    return {
      baseUrl: process.env.STD_LLM_BASE_URL || '',
      model: process.env.STD_LLM_MODEL || '',
      apiKey: process.env.STD_LLM_API_KEY || '',
    }
  }
}

const startDate = queryConfig.startDate
const endDate = queryConfig.endDate
const keywords = queryConfig.keywords
const types = queryConfig.types
const maxItems = queryConfig.maxItems
const maxPages = queryConfig.maxPages
const pageSize = queryConfig.pageSize
const argValue = (name, fallback) => process.argv.includes(name) ? Number(process.argv[process.argv.indexOf(name) + 1]) : fallback
const searchConcurrency = Math.min(Math.max(argValue('--search-concurrency', queryConfig.searchConcurrency) || 1, 1), 6)
const llmConcurrency = Math.min(Math.max(argValue('--llm-concurrency', queryConfig.llmConcurrency) || 1, 1), 8)

const reuse = process.argv.includes('--reuse')
const reuseArg = reuse ? process.argv[process.argv.indexOf('--reuse') + 1] : ''
const reusePath = reuseArg && !reuseArg.startsWith('--')
  ? reuseArg
  : RAW_PATH

// 只打印当前生效的检索条件，不执行工作流：node run-case8-scenario.mjs --show-config
if (process.argv.includes('--show-config')) {
  console.log(JSON.stringify({
    configPath: QUERY_CONFIG_PATH,
    keywords,
    types,
    startDate,
    endDate,
    maxPages,
    pageSize,
    maxItems,
    searchConcurrency,
    llmConcurrency,
    groups: GROUP_RULES,
    reusePath,
  }, null, 2))
  process.exit(0)
}

let standards = []
let crawl = { keywordStats: [] }
let hydratedCount = 0
let llmOk = 0

if (reuse) {
  console.log(`[复用] 从 ${reusePath} 载入已提取数据，跳过爬取/详情/LLM`)
  standards = JSON.parse(readFileSync(reusePath, 'utf8'))
  console.log(`      载入 ${standards.length} 条`)
} else {
  console.log(`[1/6] 高级检索（并发 ${searchConcurrency}）：关键词=${keywords.join('、')} 类型=${types.join(',')} 窗口=${startDate}~${endDate}`)
  crawl = await crawlSamrStandards({
    keywords, startDate, endDate, types, maxPages, pageSize, searchConcurrency,
  })
  console.log(`      去重后 ${crawl.standards.length} 条，命中统计：`)
  for (const stat of crawl.keywordStats) {
    console.log(`      ${stat.label}“${stat.keyword}”命中 ${stat.totalHits}（读取 ${stat.fetched}）`)
  }

  console.log(`[2/6] 过滤家电制冷保鲜领域`)
  standards = crawl.standards.filter(isApplianceFreshness)
  console.log(`      领域过滤后 ${standards.length} 条`)

  console.log(`[3/6] hbba 行业标准起草单位补抓`)
  standards = await enrichHbbaDraftUnits(standards)

  console.log(`[4/6] 并行详情补抓（并发 8，上限 ${maxItems} 条，按发布日期倒序）`)
  standards = standards.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, maxItems)
  standards = await hydrateSamrStandardDetails(standards, { concurrency: 8 })
  hydratedCount = standards.filter((item) => item.detailFetchStatus === 'completed').length
  console.log(`      详情补抓完成 ${hydratedCount}/${standards.length}`)

  console.log(`[5/6] LLM 结构化提取（并发 ${llmConcurrency}）`)
  const llmConfig = readLlmConfig()
  if (!llmConfig.baseUrl || !llmConfig.apiKey) {
    console.log('      未配置模型，仅使用显式键值结果（可在 ds配置.json 配置后重跑）')
  }
  standards = await extractStandardsWithLlm(standards, { config: llmConfig, concurrency: llmConcurrency, maxItems })
  llmOk = standards.filter((item) => item.llmStatus === 'completed').length
  console.log(`      LLM 提取成功 ${llmOk}/${standards.length}`)
  writeFileSync(RAW_PATH, JSON.stringify(standards, null, 2), 'utf8')
}

console.log(`[5.5/6] 计划↔发布合并（按标准号去重，优先已发布版）`)
const beforeMerge = standards.length
standards = mergePlanAndPublished(standards)
console.log(`      合并后 ${standards.length} 条（原 ${beforeMerge} 条）`)

// ---------- 聚合：企业/技术领域/时间/归口 ----------
console.log(`[6/6] 聚合与报告生成`)
const groupStats = Object.fromEntries(GROUP_RULES.map((rule) => [
  rule.group,
  { region: rule.region, leading: 0, participating: 0, standards: [] },
]))
const techAreas = {}
const yearTrend = {}
const tcCount = {}

for (const standard of standards) {
  const units = standard.draftUnits || []
  const year = (standard.publishedAt || '').slice(0, 4)
  if (year) yearTrend[year] = (yearTrend[year] || 0) + 1
  if (standard.tc) tcCount[standard.tc] = (tcCount[standard.tc] || 0) + 1
  for (const area of (standard.llmExtraction?.techAreas || standard.techAreas || [])) {
    techAreas[area] = (techAreas[area] || 0) + 1
  }
  for (const rule of GROUP_RULES) {
    const hit = units.filter((unit) => rule.keywords.some((keyword) => unit.includes(keyword)))
    if (hit.length === 0) continue
    const stat = groupStats[rule.group]
    stat.participating += 1
    stat.standards.push(standard.standardNo)
    if (units[0] && rule.keywords.some((keyword) => units[0].includes(keyword))) stat.leading += 1
  }
}

const rows = standards.map((standard) => ({
  standardNo: standard.standardNo,
  title: standard.title,
  domain: standard.domain,
  planForm: standard.planForm || '',
  status: standard.status,
  publishedAt: standard.publishedAt || '',
  draftUnits: standard.draftUnits || [],
  draftCount: (standard.draftUnits || []).length,
  groups: GROUP_RULES.filter((rule) => (standard.draftUnits || []).some((unit) => rule.keywords.some((k) => unit.includes(k)))).map((rule) => rule.group),
  leadingGroup: GROUP_RULES.find((rule) => rule.keywords.some((k) => (standard.draftUnits || [])[0]?.includes(k)))?.group || '',
  techAreas: standard.llmExtraction?.techAreas || standard.techAreas || [],
  scope: standard.llmExtraction?.scope || standard.scope || '',
  tc: standard.tc || '',
  llmStatus: standard.llmStatus || '',
  url: standard.url,
}))

const report = `# 案例8 实际场景测试报告：冰箱保鲜领域竞争对手标准布局分析

> 数据源：全国标准信息公共服务平台（std.samr.gov.cn）+ 行业标准信息服务平台（hbba.sacinfo.org.cn）
> 生成时间：${new Date().toISOString()}（北京时间 2026-08-15）
> 检索范围：关键词「${keywords.join(' / ')}」，类型「${types.join(' / ')}」，发布日期 ${startDate} ~ ${endDate}
> 说明：行业标准起草单位为公开数据 best-effort；演示子集上限 ${maxItems} 条，按发布日期倒序

## 一、检索命中统计

${crawl.keywordStats.length > 0
  ? `| 标准类型 | 关键词 | 命中总数 | 本次读取 |
| --- | --- | --- | --- |
${crawl.keywordStats.map((s) => `| ${s.label} | ${s.keyword} | ${s.totalHits} | ${s.fetched} |`).join('\n')}`
  : '（复用已提取数据，跳过检索）'}

演示子集 ${standards.length} 条（计划↔发布合并后，原始 ${beforeMerge} 条）${hydratedCount ? `，详情补抓 ${hydratedCount} 条` : ''}${llmOk ? `，LLM 提取成功 ${llmOk} 条` : ''}。

## 二、企业参与与主导统计（集团关联可配置）

| 集团 | 注册地(映射) | 参与标准数 | 主导(首位起草) | 涉及标准 |
| --- | --- | --- | --- | --- |
${GROUP_RULES.map((rule) => {
  const stat = groupStats[rule.group]
  return `| ${rule.group} | ${rule.region} | ${stat.participating} | ${stat.leading} | ${stat.standards.join('、') || '—'} |`
}).join('\n')}

## 三、技术领域标签分布（LLM 提取）

| 技术领域 | 标准数 |
| --- | --- |
${Object.entries(techAreas).sort((a, b) => b[1] - a[1]).map(([area, count]) => `| ${area} | ${count} |`).join('\n')}

## 四、发布时间年度趋势

| 年份 | 标准数 |
| --- | --- |
${Object.entries(yearTrend).sort((a, b) => a[0].localeCompare(b[0])).map(([year, count]) => `| ${year} | ${count} |`).join('\n')}

## 五、归口技术委员会 Top

${Object.entries(tcCount).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([tc, count]) => `- ${tc}：${count} 条`).join('\n')}

## 六、标准明细（可下钻数据）

| 标准号 | 标准名称 | 类型 | 状态 | 发布时间 | 起草单位数 | 企业集团 | 主导 | 技术领域 | LLM 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row.standardNo} | ${row.title} | ${row.domain}${row.planForm ? `(${row.planForm})` : ''} | ${row.status} | ${row.publishedAt} | ${row.draftCount} | ${row.groups.join('、') || '—'} | ${row.leadingGroup || '—'} | ${row.techAreas.join('、') || '—'} | ${row.llmStatus} |`).join('\n')}

## 七、原始数据与限制

- 明细 JSON：\`output/case8-scenario-data.json\`（含起草单位完整列表、scope、LLM 证据）；
- 限制：行业标准（如 QB/T 5510-2021）起草单位未公开时保留为空，不得臆造；计划与已发布标准（如 GB/T 44494-2024）存在重复记录，正式统计前需合并；
- 集团关联与注册地为可配置业务词典，可替换为企业实际口径。
`

writeFileSync(REPORT_PATH, report, 'utf8')
writeFileSync(DATA_PATH, JSON.stringify({
  query: { keywords, types, startDate, endDate },
  groupRules: GROUP_RULES,
  groupStats,
  techAreas,
  yearTrend,
  tcCount,
  standards: rows,
}, null, 2), 'utf8')

console.log('\n========== 汇总 ==========')
console.log(`子集：${standards.length} 条 | 详情补抓 ${hydratedCount} | LLM 成功 ${llmOk}`)
for (const rule of GROUP_RULES) {
  const stat = groupStats[rule.group]
  console.log(`${rule.group}（${rule.region}）：参与 ${stat.participating} 项，主导 ${stat.leading} 项`)
}
console.log(`技术领域：${Object.entries(techAreas).map(([a, c]) => `${a}×${c}`).join(' ')}`)
console.log(`报告已生成：${REPORT_PATH}`)
console.log(`数据已生成：${DATA_PATH}`)
