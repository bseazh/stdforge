// 专项 UI 重设计验证：验证新设计元素（区段头/胶囊多选/日期预设/SVG 图标/配置历史面板/权重总和）
// 运行：node verify-ui-redesign.mjs
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

const profilePath = join(tmpdir(), `std-ui-redesign-check-${process.pid}`)
mkdirSync(profilePath, { recursive: true })

const port = 5600 + Math.floor(Math.random() * 200)
const serverScript = join(dirname(fileURLToPath(import.meta.url)), 'serve-demo.mjs')
const server = spawn('node', [serverScript], { stdio: 'ignore', env: { ...process.env, PORT: String(port) } })
const browser = spawn(browserPath, [
  '--headless', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9230',
  `--user-data-dir=${profilePath}`, '--window-size=1600,1300', 'about:blank',
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
  await waitForJson('http://127.0.0.1:9230/json/version')
  const target = await fetch(`http://127.0.0.1:9230/json/new?http://127.0.0.1:${port}/`, { method: 'PUT' }).then((r) => r.json())
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

  // 等待 analysis 模块加载
  await evaluate(`new Promise((resolve) => {
    const started = Date.now()
    const check = () => {
      if (document.querySelector('#appRoot [data-module="analysis"]')?.querySelector('#cfgKeywords')) resolve(true)
      else if (Date.now() - started > 30000) resolve(false)
      else setTimeout(check, 200)
    }
    check()
  })`)

  // ---------- 通用设计系统检查 ----------
  const shell = await evaluate(`(() => {
    const rootStyle = getComputedStyle(document.documentElement)
    const bodyBg = getComputedStyle(document.body).backgroundColor
    const hero = document.querySelector('.shell-header')
    const heroBg = hero ? getComputedStyle(hero).backgroundImage : ''
    const tabSvgs = document.querySelectorAll('.module-tab svg').length
    const hasEmojiTabs = [...document.querySelectorAll('.module-tab')].some((b) => /[\\u{1F300}-\\u{1FAFF}]/u.test(b.textContent))
    return {
      hasNavyVar: rootStyle.getPropertyValue('--navy-900').trim() === '#2c4055',
      hasTealVar: rootStyle.getPropertyValue('--teal-600').trim() === '#0d9488',
      bodyBg,
      heroBg: heroBg.slice(0, 40),
      tabSvgs,
      hasEmojiTabs,
      tabCount: document.querySelectorAll('.module-tab').length,
      tabCopy: Boolean(document.querySelector('.module-tab-copy')),
    }
  })()`)

  // ---------- analysis 模块新交互检查 ----------
  const analysis = await evaluate(`(() => {
    const p = document.querySelector('#appRoot [data-module="analysis"]')
    const sections = [...p.querySelectorAll('.config-section')].map((s) => ({
      header: s.querySelector('.section-header h2')?.textContent || '',
      badge: s.querySelector('.section-header-copy span')?.textContent || '',
      hasIcon: Boolean(s.querySelector('.section-header .section-icon svg')),
    }))
    const pills = p.querySelectorAll('#cfgTypes .pill-option').length
    const pillChecked = p.querySelectorAll('#cfgTypes input:checked').length
    const presets = [...p.querySelectorAll('#cfgTypes .pill-option')].map((x) => x.textContent.trim())
    const presetBtns = [...p.querySelectorAll('.date-preset-btn')].map((b) => b.textContent.trim())
    const historyPanel = Boolean(p.querySelector('.config-history-panel'))
    const btnSpinner = Boolean(p.querySelector('#btnAnalyze .loading-spinner'))
    const emojiInConfig = /[\\u{1F300}-\\u{1FAFF}]/u.test(p.querySelector('.query-config, .config-section')?.innerHTML || '')
    return { sections, pills, pillChecked, pills, presetBtns, historyPanel, btnSpinner, emojiInConfig }
  })()`)

  // ---------- 切到 collection 检查 ----------
  const collection = await evaluate(`(async () => {
    document.querySelector('.module-tab[data-module="collection"]').click()
    const p = document.querySelector('#appRoot [data-module="collection"]')
    const started = Date.now()
    while ((!p || p.hidden || p.innerHTML.length < 100) && Date.now() - started < 15000) {
      await new Promise((r) => setTimeout(r, 100))
    }
    const pillOpts = p.querySelectorAll('#collectionTypes .pill-option').length
    const pillChecked = p.querySelectorAll('#collectionTypes input:checked').length
    const historyPanel = Boolean(p.querySelector('.config-history-panel'))
    const sectionCount = p.querySelectorAll('.config-section').length
    return { pillOpts, pillChecked, historyPanel, sectionCount }
  })()`)

  // ---------- 切到 case56（每日采集预警）检查改名与日期配置 ----------
  const case56 = await evaluate(`(async () => {
    document.querySelector('.module-tab[data-module="case56"]').click()
    const p = document.querySelector('#appRoot [data-module="case56"]')
    const started = Date.now()
    while ((!p || p.hidden || p.innerHTML.length < 100) && Date.now() - started < 15000) {
      await new Promise((r) => setTimeout(r, 100))
    }
    const headerTitle = p.querySelector('.section-header h2')?.textContent || ''
    const dateInput = p.querySelector('#case56Date')
    const dateValue = dateInput?.value || ''
    const dateTag = p.querySelector('#case56ReportDate')?.textContent || ''
    const hasOldBadge = Boolean(p.querySelector('.case56-date-note'))
    const hasReportDateInConfig = Boolean(p.querySelector('#case56Date'))
    const pillChecked = p.querySelectorAll('#case56Types input:checked').length
    // 日期标签应清晰显示日期值（默认最近一天），非低调占位
    const dateTagVisible = dateTag.includes('2026-08-15') || /^\d{4}-\d{2}-\d{2}$/.test(dateTag.trim())
    return {
      headerTitle,
      dateValue,
      dateTag,
      dateTagVisible,
      hasOldBadge,
      hasReportDateInConfig,
      pillChecked,
      sectionCount: p.querySelectorAll('.config-section').length,
      tabName: document.querySelector('.module-tab[data-module="case56"] .module-tab-name')?.textContent || '',
    }
  })()`)

  // ---------- 切到 organization 检查权重总和提示 ----------
  const organization = await evaluate(`(async () => {
    document.querySelector('.module-tab[data-module="organization"]').click()
    const p = document.querySelector('#appRoot [data-module="organization"]')
    const started = Date.now()
    while ((!p || p.hidden || p.innerHTML.length < 100) && Date.now() - started < 15000) {
      await new Promise((r) => setTimeout(r, 100))
    }
    const weightSum = p.querySelector('#orgWeightSum')?.textContent || ''
    const weightInputs = p.querySelectorAll('#orgWeights input[data-weight]').length
    const sections = p.querySelectorAll('.config-section').length
    return { weightSum, weightInputs, sections }
  })()`)

  console.log(JSON.stringify({ shell, analysis, collection, case56, organization, consoleErrors }, null, 2))

  // 判定：case56 改名 + 日期配置默认最近一天 + 旧徽标移除 + 日期低调标签
  const yesterdayStr = (() => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(Date.now() - 86_400_000))
    const map = {}
    for (const part of parts) map[part.type] = part.value
    return `${map.year}-${map.month}-${map.day}`
  })()
  const case56Ok = case56.headerTitle.includes('每日采集预警')
    && case56.tabName === '每日采集预警'
    && case56.dateValue === yesterdayStr
    && case56.hasReportDateInConfig
    && case56.dateTagVisible
    && !case56.hasOldBadge
    && case56.pillChecked >= 4
    && case56.sectionCount >= 3
  const passed = shell.hasNavyVar && shell.hasTealVar
    && shell.tabSvgs >= 5 && !shell.hasEmojiTabs && shell.tabCopy
    && analysis.sections.length >= 3
    && analysis.pills >= 4 && analysis.pillChecked >= 4
    && analysis.presetBtns.length >= 4
    && analysis.historyPanel && analysis.btnSpinner && !analysis.emojiInConfig
    && collection.pillOpts >= 4 && collection.pillChecked >= 4 && collection.sectionCount >= 3
    && organization.weightInputs === 4 && organization.sections >= 3
    && case56Ok
    && consoleErrors.length === 0
  console.log(passed ? '✔ 专项 UI 重设计验证通过（含每日采集预警改名与日期配置）' : '✘ 专项 UI 验证失败')
  if (!passed) process.exitCode = 1
} catch (error) {
  console.error('验证失败:', error.message)
  process.exitCode = 1
} finally {
  try { socket?.close() } catch { /* 忽略 */ }
  browser?.kill()
  server?.kill()
  try { rmSync(profilePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch { /* 临时目录清理失败可忽略 */ }
}
