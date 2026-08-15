import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const browserCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const browserPath = browserCandidates.find(existsSync)
if (!browserPath) throw new Error('未找到 Edge 或 Chrome')

const root = process.cwd()
const profilePath = join(root, '.edge-realtime-test')
const appUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:4175'
mkdirSync(profilePath, { recursive: true })

const browser = spawn(browserPath, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--remote-debugging-port=9225',
  `--user-data-dir=${profilePath}`,
  '--window-size=1440,1200',
  'about:blank',
], { stdio: 'ignore' })

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const waitForJson = async (url, attempts = 40) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch {}
    await wait(250)
  }
  throw new Error(`无法连接浏览器调试端口：${url}`)
}

let socket
try {
  await waitForJson('http://127.0.0.1:9225/json/version')
  const target = await fetch(`http://127.0.0.1:9225/json/new?${appUrl}`, { method: 'PUT' })
    .then((response) => response.json())
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (!message.id || !pending.has(message.id)) return
    const handler = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) handler.reject(new Error(message.error.message))
    else handler.resolve(message.result)
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    }
    return result.result.value
  }

  await command('Page.enable')
  await command('Runtime.enable')
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await evaluate(`document.querySelectorAll('input[type="date"]').length >= 2`)) break
    await wait(250)
  }
  const pageReady = await evaluate(`({
    title: document.title,
    dateInputs: document.querySelectorAll('input[type="date"]').length,
    realtimeCard: [...document.querySelectorAll('.choice-card')].some((button) => button.textContent.includes('实时更新'))
  })`)
  if (pageReady.dateInputs < 2 || !pageReady.realtimeCard) {
    throw new Error(`实时更新页面未准备好：${JSON.stringify(pageReady)}`)
  }
  await evaluate(`([...document.querySelectorAll('.choice-card')].find((button) => button.textContent.includes('实时更新')))?.click()`)
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const dates = document.querySelectorAll('input[type="date"]')
    setValue.call(dates[0], '2020-01-01')
    dates[0].dispatchEvent(new Event('input', { bubbles: true }))
    dates[0].dispatchEvent(new Event('change', { bubbles: true }))
    setValue.call(dates[1], '${new Date().toISOString().slice(0, 10)}')
    dates[1].dispatchEvent(new Event('input', { bubbles: true }))
    dates[1].dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(150)
  await evaluate(`document.querySelector('.start-button')?.click()`)

  let state
  for (let attempt = 0; attempt < 180; attempt += 1) {
    state = await evaluate(`({
      progress: document.querySelector('.progress-heading b')?.textContent,
      status: document.querySelector('.progress-heading span')?.textContent,
      resultCards: document.querySelectorAll('.policy-result-card').length,
      selectedMode: [...document.querySelectorAll('.choice-card.selected')].find((button) => button.textContent.includes('实时更新'))?.textContent,
      realtimeLog: [...document.querySelectorAll('.log-row')].some((row) => row.textContent.includes('实时更新') && row.textContent.includes('即时真实检查')),
      startButtonText: document.querySelector('.start-button')?.textContent?.trim(),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    })`)
    if (state.progress === '100%' || /失败/.test(state.status || '')) break
    await wait(500)
  }

  console.log(JSON.stringify(state, null, 2))
  const passed = state.progress === '100%'
    && /^实时检查完成/.test(state.status || '')
    && state.resultCards > 0
    && /实时更新/.test(state.selectedMode || '')
    && state.realtimeLog
    && state.startButtonText === '开始实时检查'
    && !state.horizontalOverflow
  if (!passed) throw new Error('实时更新 Demo 端到端验收失败')
} finally {
  socket?.close()
  browser.kill()
}
