// 演示服务冒烟测试：启动服务 → health/页面/脚本 → 创建实时分析任务 → 轮询到完成 → 校验结果
// 运行：node test-demo-server.mjs [maxItems]
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const maxItems = Number(process.argv[2] || 3)
const port = 5300 + Math.floor(Math.random() * 200)
const serverScript = join(dirname(fileURLToPath(import.meta.url)), 'serve-demo.mjs')
const server = spawn('node', [serverScript], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port) },
})

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fetchJson = async (url, options) => {
  const response = await fetch(url, options)
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* 非 JSON */ }
  return { status: response.status, body, text }
}

try {
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

  const html = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text())
  console.log('html 长度:', html.length, '| 引用 demo-app.js:', html.includes('std-crawler/demo-app.js'))

  const js = await fetch(`http://127.0.0.1:${port}/std-crawler/demo-app.js`).then((r) => r.text())
  console.log('demo-app.js 长度:', js.length, '| 含配置面板逻辑:', js.includes('cfgKeywords') || js.includes('query-config'))

  console.log(`创建实时分析任务（maxItems=${maxItems}，含 LLM，预计 1-4 分钟）…`)
  const created = await fetchJson(`http://127.0.0.1:${port}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      keywords: ['冰箱', '保鲜'],
      types: ['gb', 'hb', 'plan'],
      startDate: '2023-01-01',
      endDate: '2026-08-15',
      maxItems,
      concurrency: 4,
      leadingRule: 'first',
      debug: true,
    }),
  })
  console.log('创建任务:', created.status, created.body?.jobId)
  if (created.status !== 202 || !created.body?.jobId) throw new Error('任务创建失败')

  const jobId = created.body.jobId
  let job
  for (let attempt = 0; attempt < 120; attempt += 1) {
    job = await fetchJson(`http://127.0.0.1:${port}/api/analyze/${jobId}`)
    if (job.body?.status === 'done' || job.body?.status === 'error') break
    if (attempt % 10 === 0) {
      const lastLog = job.body?.logs?.slice(-1)[0]
      console.log('  进度:', job.body?.status, lastLog ? `${lastLog.stage}: ${lastLog.message}` : '')
    }
    await wait(3000)
  }
  if (!job || job.body?.status !== 'done') {
    throw new Error(`任务未完成: ${job?.body?.status} ${job?.body?.error || ''}`)
  }

  const result = job.body.result
  console.log('任务完成:', JSON.stringify({
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
    logsCount: job.body.logs?.length,
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
