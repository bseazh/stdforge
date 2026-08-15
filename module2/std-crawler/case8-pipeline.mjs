// 兼容转发 shim：案例8 命名仅保留给旧脚本/旧调用（D8），逻辑统一在 analysis-pipeline.mjs
// 运行：旧入口 runCase8Analysis = runAnalysis，行为与改造前一致
export { runAnalysis as runCase8Analysis } from './analysis-pipeline.mjs'
export * from './analysis-pipeline.mjs'
