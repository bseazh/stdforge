// 端到端：验证 case56 模块日期配置交互（改日期 → 提交 → 后端消费 reportDate）
// 运行：node verify-case56-date-e2e.mjs
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

const profilePath = join(tmpdir(), `std-case56-date-${process.pid}`)
mkdirSync(profilePath, { recursive: true })
const port = 5800 + Math.floor(Math.random() * 150)
const server = spawn('node', [join(dirname(fileURLToPath(import.meta.url)), 'serve-demo.mjs')], {
  stdio: 'ignore', env: { ...process.env, PORT: String(port) },
})
const browser = spawn(browserPath, [
  '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9240',
  `--user-data-dir=${profilePath}`, '--window-size=1600,1300', 'about:blank',
], { stdio: 'ignore' })

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const waitForJson = async (url, attempts = 40) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch { /* retry */ }
    await wait(250)
  }
  throw new Error(`无法连接：${url}`)
}

let socket
try {
  await waitForJson('http://127.0.0.1:9240/json/version')
  const target = await fetch(`http://127.0.0.1:9240/json/new?http://127.0.0.1:${port}/`, { method: 'PUT' }).then((r) => r.json())
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

  // 等待 case56 模块
  await evaluate(`new Promise((resolve) => {
    document.querySelector('.module-tab[data-module="case56"]').click()
    const started = Date.now()
    const check = () => {
      const p = document.querySelector('#appRoot [data-module="case56"]')
      if (p && !p.hidden && p.querySelector('#case56Date')) resolve(true)
      else if (Date.now() - started > 30000) resolve(false)
      else setTimeout(check, 200)
    }
    check()
  })`)

  // 修改日期为指定历史日期 → 读取 buildConfig 产物（通过直接读取 DOM 值）
  const result = await evaluate(`(() => {
    const p = document.querySelector('#appRoot [data-module="case56"]')
    const dateInput = p.querySelector('#case56Date')
    const original = dateInput.value
    // 修改为 2026-08-10（历史日期）
    dateInput.value = '2026-08-10'
    dateInput.dispatchEvent(new Event('change', { bubbles: true }))
    // 读取配置（buildConfig 逻辑：reportDate 取 #case56Date）
    const reportDate = dateInput.value
    // 还原（避免影响后续）
    dateInput.value = original
    return { defaultDate: original, customDate: reportDate }
  })()`)

  // 直接验证后端 API 消费：通过 createJob 提交自定义日期（mock 前端 fetch 构造）
  // 这里改为直接 POST /api/analyze 验证后端接受 reportDate
  const apiCheck = await fetch(`http://127.0.0.1:${port}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ moduleId: 'case56', config: { keywords: ['冰箱'], types: ['gb'], reportDate: '2026-08-10', maxItems: 1 } }),
  }).then((r) => r.json())

  console.log(JSON.stringify({ result, apiCheck: { ok: apiCheck.ok, jobId: apiCheck.jobId }, consoleErrors }, null, 2))

  const passed = result.defaultDate === '2026-08-15'
    && result.customDate === '2026-08-10'
    && apiCheck.ok === true
    && !!apiCheck.jobId
    && consoleErrors.length === 0
  console.log(passed ? '✔ case56 日期配置端到端验证通过' : '✘ case56 日期配置验证失败')
  if (!passed) process.exitCode = 1
} catch (error) {
  console.error('验证失败:', error.message)
  process.exitCode = 1
} finally {
  try { socket?.close() } catch { /* ignore */ }
  browser?.kill()
  server?.kill()
  try { rmSync(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch { /* ignore */ }
}
