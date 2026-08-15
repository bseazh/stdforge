// 业务模块注册表：模块 ID → 管线 + 默认配置（统一分派入口，服务端与前端 health 共用）
import { runCollection } from './collection-pipeline.mjs'
import { runAlert } from './alert-pipeline.mjs'
import { runAnalysis } from './analysis-pipeline.mjs'
import { runOrganization } from './organization-pipeline.mjs'
import { runCase56, yesterdayInShanghai } from './case56-pipeline.mjs'
import { getDomain, DEFAULT_DOMAIN } from './domain-config.mjs'

const today = () => new Date().toISOString().slice(0, 10)
// 默认领域配置（关键词/类型/白名单/阈值），自定义通过 domain-config.json
const defaultDomain = getDomain(DEFAULT_DOMAIN)
const defaultDomainKeywords = defaultDomain.keywords
const defaultDomainTypes = defaultDomain.types
const defaultDomainThreshold = defaultDomain.relevanceThreshold

export const CAPABILITY_REGISTRY = [
  {
    id: 'case56',
    name: '每日采集预警',
    status: 'ready',
    run: runCase56,
    defaultConfig: {
      domain: DEFAULT_DOMAIN,
      keywords: defaultDomainKeywords,
      types: defaultDomainTypes,
      reportDate: yesterdayInShanghai(), // 默认检索最近一天；前端可配置调整（补采历史日期）
      relevanceThreshold: defaultDomainThreshold,
      alertNodes: [90, 30, 7],
      maxItems: 60,
      searchConcurrency: 3,
      llmConcurrency: 5,
      withLlm: true,
      withReview: false, // 只生成报告；需要质量审查时显式开启 withReview: true
    },
  },
  {
    id: 'collection',
    name: '标准采集',
    status: 'ready',
    run: runCollection,
    defaultConfig: {
      domain: DEFAULT_DOMAIN,
      keywords: defaultDomainKeywords,
      types: defaultDomainTypes,
      startDate: '2021-01-01',
      endDate: today(),
      maxPages: 1,
      pageSize: 20,
      maxItems: 24,
      searchConcurrency: 3,
      llmConcurrency: 5,
      relevanceThreshold: defaultDomainThreshold,
      icsWhitelist: null,
      ccsWhitelist: null,
      withLlm: true,
    },
  },
  {
    id: 'alert',
    name: '标准预警',
    status: 'ready',
    run: runAlert,
    defaultConfig: {
      domain: DEFAULT_DOMAIN,
      keywords: ['冰箱', '保鲜'],
      types: ['gb', 'plan'],
      startDate: '2021-01-01',
      endDate: today(),
      maxPages: 1,
      pageSize: 20,
      maxItems: 24,
      searchConcurrency: 3,
      llmConcurrency: 5,
      alertNodes: [90, 30, 7],
      newDays: 30,
      withLlm: true,
    },
  },
  {
    id: 'analysis',
    name: '竞争分析',
    status: 'ready',
    run: runAnalysis,
    // 与改造前 case8-config.json 合并逻辑保持一致：请求 > 文件 > 注册表默认
    defaultConfig: {
      domain: DEFAULT_DOMAIN,
      keywords: defaultDomainKeywords,
      types: defaultDomainTypes,
      startDate: '2021-01-01',
      endDate: today(),
      maxPages: 1,
      pageSize: 20,
      maxItems: 24,
      concurrency: 8,
      searchConcurrency: 3,
      llmConcurrency: 5,
      groups: null,
      leadingRule: 'first',
      withHbba: true,
      withHydrate: true,
      withLlm: true,
      withConclusions: true,
      debug: false,
    },
  },
  {
    id: 'organization',
    name: '组织动态',
    status: 'ready',
    run: runOrganization,
    defaultConfig: {
      domain: DEFAULT_DOMAIN,
      keywords: ['冰箱', '家电', '家用电器', '制冷'],
      noticeTypes: ['recruit', 'suggest'],
      maxPages: 1,
      pageSize: 100,
      maxItems: 40,
      hydrateConcurrency: 4,
      llmConcurrency: 5,
      matchWeights: { title: 30, years: 20, stdExp: 30, field: 20 },
      remindNodes: [15, 3],
      withLlm: true,
      withDemo: true,
    },
  },
]

export const findModule = (moduleId) => CAPABILITY_REGISTRY.find((module) => module.id === moduleId) || null

export const getModuleInfo = (moduleId) => {
  const module = findModule(moduleId)
  return module ? { id: module.id, name: module.name, status: module.status || (typeof module.run === 'function' ? 'ready' : 'not-implemented') } : null
}

export const listModules = () => CAPABILITY_REGISTRY.map((module) => getModuleInfo(module.id))
