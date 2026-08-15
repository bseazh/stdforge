// 服务端冒烟测试：启动服务 → 确定性单元断言 → health/模块 → 静态托管
//   → 组织动态 501 / 未知模块 400 → 采集/预警冒烟（真实爬取 + LLM）→ 竞争分析默认兼容（旧调用格式）
// 运行：node test-demo-server.mjs [analysisMaxItems]
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeAlertFlags } from './alert-pipeline.mjs'
import { scoreRelevance } from './collection-pipeline.mjs'

const analysisMaxItems = Number(process.argv[2] || 3)
const port = 5300 + Math.floor(Math.random() * 200)
const serverScript = join(dirname(fileURLToPath(import.meta.url)), 'serve-demo.mjs')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fetchJson = async (url, options) => {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* 非 JSON */ }
  return { status: response.status, body, text }
}
const postJson = (url, payload) => fetchJson(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
})
const pollJob = async (jobId, { label = '', maxAttempts = 120, intervalMs = 3000 } = {}) => {
  let job
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    job = await fetchJson(`http://127.0.0.1:${port}/api/analyze/${jobId}`)
    if (job.body?.status === 'done' || job.body?.status === 'error') break
    if (attempt % 10 === 0) {
      const lastLog = job.body?.logs?.slice(-1)[0]
      console.log(`  [${label}] 进度:`, job.body?.status, lastLog ? `${lastLog.stage}: ${lastLog.message}` : '')
    }
    await wait(intervalMs)
  }
  if (!job || job.body?.status !== 'done') {
    throw new Error(`[${label}] 任务未完成: ${job?.body?.status} ${job?.body?.error || ''}`)
  }
  return job.body
}

// ---------- 确定性单元断言（不依赖真实数据的时间分布） ----------
const runUnitChecks = () => {
  const futureDate = (days) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10)

  const a10 = computeAlertFlags({ status: '即将实施', effectiveAt: futureDate(10) })
  if (!a10.alert || a10.daysToEffective !== 10 || a10.alertNode !== 30 || a10.urgent) {
    throw new Error(`computeAlertFlags 10 天节点断言失败: ${JSON.stringify(a10)}`)
  }
  const a3 = computeAlertFlags({ status: '即将实施', effectiveAt: futureDate(3) })
  if (!a3.alert || a3.daysToEffective !== 3 || a3.alertNode !== 7 || !a3.urgent) {
    throw new Error(`computeAlertFlags 3 天节点断言失败: ${JSON.stringify(a3)}`)
  }
  const aPast = computeAlertFlags({ status: '现行', effectiveAt: futureDate(-30) })
  if (aPast.alert || aPast.alertNode !== null) {
    throw new Error(`computeAlertFlags 已实施不应预警: ${JSON.stringify(aPast)}`)
  }

  const high = scoreRelevance({ title: '家用电冰箱 保鲜性能测试方法', ics: '97.040.30' }, { keywords: ['冰箱', '保鲜'] })
  if (high.score !== 100 || !high.remind) {
    throw new Error(`scoreRelevance 高相关断言失败: ${JSON.stringify(high)}`)
  }
  const low = scoreRelevance({ title: '家用电器 通用要求', ics: '97.030' }, { keywords: ['冰箱', '保鲜'], icsWhitelist: [] })
  if (low.score !== 0 || low.remind) {
    throw new Error(`scoreRelevance 低相关断言失败: ${JSON.stringify(low)}`)
  }
  console.log('确定性单元断言通过：computeAlertFlags（90/30/7 节点）、scoreRelevance（0-100/阈值提醒）')
}

const server = spawn('node', [serverScript], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port) },
})

try {
  runUnitChecks()

  let ready = false
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const health = await fetchJson(`http://127.0.0.1:${port}/api/health`)
      if (health.status === 200) { ready = true; break }
    } catch { /* 服务未就绪 */ }
    await wait(500)
  }
  if (!ready) throw new Error('服务未在 10 秒内就绪')

  const health = await fetchJson(`http://127.0.0.1:${port}/api/health`)
  console.log('health:', health.status, JSON.stringify(health.body))
  if (health.status !== 200 || !health.body.ok) throw new Error('health 异常')
  const moduleIds = (health.body.modules || []).map((item) => item.id)
  for (const id of ['collection', 'alert', 'analysis', 'organization']) {
    if (!moduleIds.includes(id)) throw new Error(`health 缺少模块 ${id}`)
  }
  const orgInfo = (health.body.modules || []).find((item) => item.id === 'organization')
  if (orgInfo?.status !== 'ready') throw new Error('organization 状态应为 ready')

  const html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())
  console.log('html 长度:', html.length, '| 引用 frontend/app.js:', html.includes('std-crawler/frontend/app.js'), '| 引用 demo-app.js:', html.includes('std-crawler/demo-app.js'))
  if (!html.includes('std-crawler/frontend/app.js')) throw new Error('平台壳应引用 frontend/app.js')
  if (html.includes('std-crawler/demo-app.js')) throw new Error('平台壳不应再引用已删除的 demo-app.js')

  // 静态托管：/std-crawler/frontend/**（ES Modules）
  for (const path of ['/std-crawler/frontend/app.js', '/std-crawler/frontend/core/api.js', '/std-crawler/frontend/modules/alert.js']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`)
    const text = await response.text()
    const contentType = response.headers.get('content-type') || ''
    const cacheControl = response.headers.get('cache-control') || ''
    if (response.status !== 200 || !contentType.includes('application/javascript') || !cacheControl.includes('no-store') || !text.trim()) {
      throw new Error(`静态资源 ${path} 异常: ${response.status} ${contentType} ${cacheControl}`)
    }
    console.log(`静态托管 ${path}: ${response.status} ${contentType} (${text.length}B)`)
  }
  const missingAsset = await fetch(`http://127.0.0.1:${port}/std-crawler/frontend/not-exists.js`)
  if (missingAsset.status !== 404) throw new Error('不存在的静态资源应返回 404')

  // 组织动态（案例7 标委会换届专家推荐）/ 未知模块 400 / 缺关键词 400
  const orgResp = await postJson(`http://127.0.0.1:${port}/api/analyze`, { moduleId: 'organization', config: { keywords: ['冰箱'] } })
  console.log('organization:', orgResp.status, JSON.stringify(orgResp.body))
  if (orgResp.status !== 202 || !orgResp.body.jobId || orgResp.body.moduleId !== 'organization') {
    throw new Error('organization 应返回 202（案例7 标委会换届专家推荐）')
  }
  const unknownResp = await postJson(`http://127.0.0.1:${port}/api/analyze`, { moduleId: 'nope', config: { keywords: ['冰箱'] } })
  console.log('未知模块:', unknownResp.status, JSON.stringify(unknownResp.body))
  if (unknownResp.status !== 400 || unknownResp.body.ok !== false) throw new Error('未知模块应返回 400')
  const noKeywordResp = await postJson(`http://127.0.0.1:${port}/api/analyze`, { moduleId: 'collection', config: { types: ['gb'] } })
  console.log('缺关键词:', noKeywordResp.status, JSON.stringify(noKeywordResp.body))
  if (noKeywordResp.status !== 400 || noKeywordResp.body.ok !== false) throw new Error('缺关键词应返回 400')

  // 采集模块冒烟（真实爬取 + LLM，小规模）
  console.log('创建采集模块冒烟任务（maxItems=2）…')
  const createdCollection = await postJson(`http://127.0.0.1:${port}/api/analyze`, {
    moduleId: 'collection',
    config: {
      keywords: ['冰箱', '保鲜'],
      types: ['gb', 'plan'],
      startDate: '2021-01-01',
      endDate: '2026-08-15',
      maxItems: 2,
      maxPages: 1,
      pageSize: 5,
      searchConcurrency: 2,
      llmConcurrency: 1,
    },
  })
  console.log('创建采集任务:', createdCollection.status, createdCollection.body?.jobId, createdCollection.body?.moduleId)
  if (createdCollection.status !== 202 || !createdCollection.body?.jobId || createdCollection.body?.moduleId !== 'collection') {
    throw new Error('采集任务创建失败')
  }
  const collectionJob = await pollJob(createdCollection.body.jobId, { label: 'collection' })
  const collection = collectionJob.result
  console.log('采集完成:', JSON.stringify({
    items: collection?.items?.length,
    remind: collection?.stats?.remindCount,
    llmDurationMs: collection?.log?.llmDurationMs,
    byType: collection?.stats?.byType,
  }, null, 2))
  if (!collection?.items?.length) throw new Error('采集结果缺少 items')
  for (const key of ['standardNo', 'title', 'issueAnnouncementNo', 'issuer', 'publishedAt', 'effectiveAt', 'url', 'scope', 'tags', 'relevance']) {
    if (!(key in collection.items[0])) throw new Error(`采集 items[0] 缺少字段 ${key}`)
  }
  const relevance = collection.items[0].relevance
  if (!Number.isFinite(relevance.score) || relevance.score < 0 || relevance.score > 100 || typeof relevance.remind !== 'boolean') {
    throw new Error('采集相关度字段异常')
  }
  if (!collection.log?.taskTime || typeof collection.log?.llmDurationMs !== 'number') {
    throw new Error('采集日志缺少任务时间/LLM 耗时')
  }
  if (collection.stats?.total !== collection.items.length) throw new Error('采集 stats.total 与 items 不一致')

  // 预警模块冒烟（真实爬取 + LLM，小规模）
  console.log('创建预警模块冒烟任务（maxItems=2）…')
  const createdAlert = await postJson(`http://127.0.0.1:${port}/api/analyze`, {
    moduleId: 'alert',
    config: {
      keywords: ['冰箱', '保鲜'],
      types: ['gb', 'plan'],
      startDate: '2025-01-01',
      endDate: '2026-08-15',
      maxItems: 2,
      maxPages: 1,
      pageSize: 5,
      searchConcurrency: 2,
      llmConcurrency: 1,
    },
  })
  console.log('创建预警任务:', createdAlert.status, createdAlert.body?.jobId, createdAlert.body?.moduleId)
  if (createdAlert.status !== 202 || !createdAlert.body?.jobId || createdAlert.body?.moduleId !== 'alert') {
    throw new Error('预警任务创建失败')
  }
  const alertJob = await pollJob(createdAlert.body.jobId, { label: 'alert' })
  const alertResult = alertJob.result
  console.log('预警完成:', JSON.stringify({
    alerts: alertResult?.alerts?.length,
    upcoming: alertResult?.upcoming?.length,
    byNode: alertResult?.stats?.byNode,
  }, null, 2))
  if (!Array.isArray(alertResult?.alerts) || !Array.isArray(alertResult?.upcoming) || !alertResult?.stats) {
    throw new Error('预警结果缺少 alerts/upcoming/stats')
  }
  for (const item of alertResult.alerts) {
    if (!('daysToEffective' in item) || !('alertNode' in item) || !('upcomingNodes' in item) || !('urgent' in item)) {
      throw new Error('预警条目缺少距实施天数/节点标记')
    }
    if (item.alertNode !== null && ![7, 30, 90].includes(item.alertNode)) {
      throw new Error(`预警节点标记异常: ${item.alertNode}`)
    }
  }

  // 组织动态模块冒烟（案例7：标委会换届专家推荐，真实爬取 + 专家匹配，小规模）
  console.log('创建组织动态冒烟任务（maxItems=2，真实爬取标委会通知）…')
  const createdOrg = await postJson(`http://127.0.0.1:${port}/api/analyze`, {
    moduleId: 'organization',
    config: {
      keywords: ['冰箱', '家电', '家用电器', '制冷'],
      noticeTypes: ['recruit', 'suggest'],
      maxItems: 2,
      maxPages: 1,
      pageSize: 50,
      hydrateConcurrency: 2,
      llmConcurrency: 1,
      withLlm: false,
      withDemo: true,
    },
  })
  console.log('创建组织动态任务:', createdOrg.status, createdOrg.body?.jobId, createdOrg.body?.moduleId)
  if (createdOrg.status !== 202 || !createdOrg.body?.jobId || createdOrg.body?.moduleId !== 'organization') {
    throw new Error('组织动态任务创建失败')
  }
  const orgJob = await pollJob(createdOrg.body.jobId, { label: 'organization' })
  const orgResult = orgJob.result
  console.log('组织动态完成:', JSON.stringify({
    notices: orgResult?.notices?.length,
    demoUsed: orgResult?.stats?.demoUsed,
    recommendations: orgResult?.recommendations?.length,
    trackings: orgResult?.trackings?.length,
    totalExperts: orgResult?.stats?.totalExperts,
  }, null, 2))
  if (!Array.isArray(orgResult?.notices) || !orgResult?.notices.length) throw new Error('组织动态结果缺少通知')
  if (!Array.isArray(orgResult?.recommendations) || !orgResult?.recommendations.length) throw new Error('组织动态结果缺少专家推荐')
  if (!Array.isArray(orgResult?.trackings)) throw new Error('组织动态结果缺少待办跟踪')
  const firstRec = orgResult.recommendations[0]
  if (!Array.isArray(firstRec?.matches) || !firstRec.matches.length) throw new Error('专家推荐缺少匹配列表')
  const firstMatch = firstRec.matches[0]
  if (!Number.isFinite(firstMatch.score) || firstMatch.score < 0 || firstMatch.score > 100) throw new Error('专家匹配度异常')
  if (!Array.isArray(firstMatch.reasons) || !firstMatch.reasons.length) throw new Error('专家匹配缺少匹配原因')
  if (!orgResult.stats?.demoUsed) throw new Error('实时数据零命中时应有受控演示场景（demoUsed=true）')

  // 竞争分析默认兼容：缺省 moduleId + 旧调用格式（body 直接为 config）
  console.log(`创建竞争分析任务（缺省 moduleId，旧调用格式，maxItems=${analysisMaxItems}，含 LLM，预计 1-4 分钟）…`)
  const createdAnalysis = await postJson(`http://127.0.0.1:${port}/api/analyze`, {
    keywords: ['冰箱', '保鲜'],
    types: ['gb', 'hb', 'plan'],
    startDate: '2023-01-01',
    endDate: '2026-08-15',
    maxItems: analysisMaxItems,
    concurrency: 4,
    leadingRule: 'first',
    debug: true,
  })
  console.log('创建分析任务:', createdAnalysis.status, createdAnalysis.body?.jobId, createdAnalysis.body?.moduleId)
  if (createdAnalysis.status !== 202 || !createdAnalysis.body?.jobId || createdAnalysis.body?.moduleId !== 'analysis') {
    throw new Error('分析任务创建失败（缺省 moduleId 应分派到 analysis）')
  }
  const analysisJob = await pollJob(createdAnalysis.body.jobId, { label: 'analysis' })
  const result = analysisJob.result
  console.log('分析完成:', JSON.stringify({
    rows: result?.rows?.length,
    mergedCount: result?.mergedCount,
    hydratedCount: result?.hydratedCount,
    llmOk: result?.llmOk,
    leadingRule: result?.leadingRule,
    reportTitle: result?.reportTitle,
    debugEnabled: result?.debug?.enabled,
    debugKeys: Object.keys(result?.debug || {}),
    conclusionsStatus: result?.conclusionsStatus,
    conclusions: result?.conclusions?.map((c) => `${c.title}: ${c.text.slice(0, 40)}…`),
    groupStats: Object.fromEntries(Object.entries(result?.groupStats || {}).map(([k, v]) => [k, `${v.participating}参/${v.leading}主`])),
    regionData: result?.regionData,
    logsCount: analysisJob.logs?.length,
  }, null, 2))

  if (!result?.rows?.length) throw new Error('结果缺少标准明细')
  if (!result?.groupStats || !result?.regionData) throw new Error('结果缺少聚合统计')
  if (!result?.reportTitle) throw new Error('缺少报告标题')
  if (!result?.debug?.enabled) throw new Error('调试信息未返回（debug 链路异常）')
  if (!health.body.llmConfigured) {
    console.log('警告：LLM 未配置，结论跳过（当前为显式键值降级）')
  } else if (result.conclusionsStatus !== 'completed' || !result.conclusions?.length) {
    throw new Error('LLM 结论未生成')
  }
  console.log('全部断言通过')
} catch (error) {
  console.error('测试失败:', error.message)
  process.exitCode = 1
} finally {
  server.kill()
}
