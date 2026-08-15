// 前端渲染冒烟测试：无头浏览器打开演示页，检查配置面板/图表/无运行时错误
// 运行：node test-page-render.mjs
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const browserCandidates = [
  process.env.EDGE_PATH,
  process.env.CHROME_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)
const browserPath = browserCandidates.find(existsSync)
if (!browserPath) throw new Error('未找到 Edge 或 Chrome')

const profilePath = join(tmpdir(), `case8-edge-render-test-${process.pid}`)
mkdirSync(profilePath, { recursive: true })

const port = 5400 + Math.floor(Math.random() * 200)
const serverScript = join(dirname(fileURLToPath(import.meta.url)), 'serve-demo.mjs')
const server = spawn('node', [serverScript], {
  stdio: 'ignore',
  env: { ...process.env, PORT: String(port) },
})
const browser = spawn(browserPath, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-port=9225',
  `--user-data-dir=${profilePath}`,
  '--window-size=1500,1200',
  'about:blank',
], { stdio: 'ignore' })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitForJson = async (url, attempts = 40) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch { /* 重试 */ }
    await wait(250)
  }
  throw new Error(`无法连接：${url}`)
}

let socket
try {
  await waitForJson('http://127.0.0.1:9225/json/version')
  await waitForJson(`http://127.0.0.1:${port}/api/health`)
  // 小规模真实分析：maxItems=2，验证“点击开始分析 → 结果渲染 → 本地时间日志 → 无报错”
  const target = await fetch(`http://127.0.0.1:9225/json/new?http://127.0.0.1:${port}/?maxItems=2&concurrency=2`, { method: 'PUT' }).then((r) => r.json())
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  const consoleErrors = []
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(message.params.exceptionDetails?.text || 'exception')
    }
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push((message.params.args || []).map((a) => a.value || a.description || '').join(' '))
    }
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
    return result.result.value
  }

  await command('Runtime.enable')
  await command('Page.enable')
  await wait(8000)

  const state = await evaluate(`({
    title: document.title,
    groupRows: document.querySelectorAll('#groupTableBody tr').length,
    hasConfig: Boolean(document.getElementById('cfgKeywords')),
    hasCharts: ['barChart','pieChart','lineChart','mapChart'].every((id) => Boolean(document.getElementById(id))),
    statTotal: document.getElementById('statTotal').textContent,
    serverStatus: document.getElementById('serverStatus').textContent,
    drillRows: document.querySelectorAll('#standardsTableBody tr').length,
    startAnalysisFn: typeof window.startAnalysis === 'function',
    historyFns: ['saveConfig','loadConfig','deleteConfig'].every((fn) => typeof window[fn] === 'function'),
    echartsLoaded: typeof window.echarts !== 'undefined',
    printTitle: document.getElementById('printTitle').textContent,
    conclusionCount: document.querySelectorAll('#conclusionList li').length,
    placeholderVisible: !document.getElementById('resultsPlaceholder').classList.contains('hidden'),
    historyOptions: document.getElementById('cfgHistory').options.length
  })`)

  const passed = state.groupRows === 5
    && state.hasConfig
    && state.hasCharts
    && state.statTotal === '—'
    && state.drillRows === 0
    && state.startAnalysisFn
    && state.historyFns
    && state.echartsLoaded
    && state.printTitle === '标准竞争分析报告'
    && state.conclusionCount === 0
    && state.placeholderVisible
    && state.historyOptions >= 1
    && consoleErrors.length === 0

  console.log(JSON.stringify({ ...state, consoleErrors }, null, 2))
  console.log(passed ? '初始空状态检查通过' : '初始空状态检查失败')
  if (!passed) process.exitCode = 1

  // 第二阶段：真实点击“开始实时分析”（调试模式）并等待完成
  console.log('开始真实分析（小规模 maxItems=2，调试模式）…')
  await evaluate(`document.getElementById('cfgDebug').checked = true`)
  await evaluate(`startAnalysis()`)
  let finalState = null
  for (let attempt = 0; attempt < 90; attempt += 1) {
    await wait(4000)
    finalState = await evaluate(`({
        progressTitle: document.getElementById('progressTitle').textContent,
        statTotal: document.getElementById('statTotal').textContent,
        conclusionCount: document.querySelectorAll('#conclusionList li').length,
        printTitle: document.getElementById('printTitle').textContent,
        logTime: document.querySelector('#progressLogs div .log-time')?.textContent || '',
        logCount: document.querySelectorAll('#progressLogs div').length,
        debugPanelVisible: document.getElementById('debugPanel').style.display === 'block',
        debugSections: document.querySelectorAll('#debugContent .debug-section').length
    })`)
    if (finalState.progressTitle === '分析完成' || consoleErrors.length > 0) break
  }
  const analysisPassed = finalState.progressTitle === '分析完成'
    && Number(finalState.statTotal) > 0
    && finalState.conclusionCount === 3
    && finalState.printTitle.includes('竞争分析报告')
    && /^\d{2}:\d{2}:\d{2}$/.test(finalState.logTime)
    && finalState.logCount >= 6
    && finalState.debugPanelVisible
    && finalState.debugSections >= 7
    && consoleErrors.length === 0
  console.log(JSON.stringify({ ...finalState, consoleErrors }, null, 2))
  console.log(analysisPassed ? '端到端分析渲染检查通过（含本地时间日志）' : '端到端分析渲染检查失败')
  if (!analysisPassed) process.exitCode = 1
} catch (error) {
  console.error('测试失败:', error.message)
  process.exitCode = 1
} finally {
  socket?.close()
  browser.kill()
  server.kill()
  try { rmSync(profilePath, { recursive: true, force: true }) } catch { /* 忽略清理异常 */ }
}
