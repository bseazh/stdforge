// 前端渲染冒烟测试：平台壳功能切换 + 四业务面板渲染 + 组织动态占位 + 竞争分析全链路 + 状态保留
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

const profilePath = join(tmpdir(), `std-frontend-render-test-${process.pid}`)
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
  const health = await waitForJson(`http://127.0.0.1:${port}/api/health`)
  const healthModuleIds = (health.modules || []).map((item) => item.id)
  console.log('health 模块:', healthModuleIds.join('、'))
  if (!['case56', 'collection', 'alert', 'analysis', 'organization'].every((id) => healthModuleIds.includes(id))) {
    throw new Error('health 缺少业务模块')
  }

  // 小规模真实分析：maxItems=2，验证“开始分析 → 结果渲染 → 本地时间日志 → 无报错”
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

  // 等待平台壳与 analysis 模块懒加载完成（健康检查 → 默认切换 analysis；带超时防挂起）
  await evaluate(`new Promise((resolve) => {
    const started = Date.now()
    const check = () => {
      const tabs = document.querySelectorAll('.module-tab').length
      const analysisPanel = document.querySelector('#appRoot [data-module="analysis"]')
      if (tabs >= 4 && analysisPanel && !analysisPanel.hidden && analysisPanel.querySelector('#cfgKeywords')) resolve(true)
      else if (Date.now() - started > 30000) resolve(false)
      else setTimeout(check, 200)
    }
    check()
  })`)

  // ---------- 第一阶段：平台壳 + 初始空状态 ----------
  const initial = await evaluate(`({
    title: document.title,
    tabCount: document.querySelectorAll('.module-tab').length,
    tabIds: [...document.querySelectorAll('.module-tab')].map((b) => b.dataset.module),
    activeTab: document.querySelector('.module-tab.active')?.dataset.module || '',
    hasAppRoot: Boolean(document.getElementById('appRoot')),
    analysisPanelVisible: !document.querySelector('[data-module="analysis"]').hidden,
    groupRows: document.querySelectorAll('#groupTableBody tr').length,
    hasConfig: Boolean(document.getElementById('cfgKeywords')),
    hasCharts: ['barChart','pieChart','lineChart','mapChart'].every((id) => Boolean(document.getElementById(id))),
    statTotal: document.getElementById('statTotal').textContent,
    drillRows: document.querySelectorAll('#standardsTableBody tr').length,
    echartsLoaded: typeof window.echarts !== 'undefined',
    printTitle: document.getElementById('printTitle').textContent,
    conclusionCount: document.querySelectorAll('#conclusionList li').length,
    placeholderVisible: !document.getElementById('resultsPlaceholder').classList.contains('hidden'),
    historyOptions: document.getElementById('cfgHistory').options.length,
    noInlineOnclickInShell: ![...document.querySelectorAll('.module-tabs button')].some((b) => b.hasAttribute('onclick')),
    staticNoticeHidden: document.getElementById('staticNotice').style.display === 'none',
    serverStatus: document.getElementById('serverStatus').textContent,
  })`)
  const initialPassed = initial.tabCount === 5
    && initial.tabIds.join(',') === 'case56,collection,alert,analysis,organization'
    && initial.activeTab === 'analysis'
    && initial.analysisPanelVisible
    && initial.groupRows === 5
    && initial.hasConfig
    && initial.hasCharts
    && initial.statTotal === '—'
    && initial.drillRows === 0
    && initial.echartsLoaded
    && initial.printTitle === '标准竞争分析报告'
    && initial.conclusionCount === 0
    && initial.placeholderVisible
    && initial.historyOptions >= 1
    && initial.noInlineOnclickInShell
    && initial.staticNoticeHidden
    && initial.serverStatus.includes('服务已连接')
    && consoleErrors.length === 0
  console.log(JSON.stringify({ ...initial, consoleErrors }, null, 2))
  console.log(initialPassed ? '平台壳与初始空状态检查通过' : '平台壳与初始空状态检查失败')
  if (!initialPassed) process.exitCode = 1

  // ---------- 第二阶段：功能切换 + 四面板独立渲染 ----------
  const switchState = await evaluate(`(async () => {
    const click = (id) => document.querySelector('.module-tab[data-module="' + id + '"]').click()
    const panel = (id) => document.querySelector('#appRoot [data-module="' + id + '"]')
    const waitPanel = (id) => new Promise((resolve) => {
      const started = Date.now()
      const check = () => {
        const p = panel(id)
        if (p && !p.hidden && p.innerHTML.length > 100) resolve(true)
        else if (Date.now() - started > 15000) resolve(false)
        else setTimeout(check, 100)
      }
      check()
    })

    click('collection')
    await waitPanel('collection')
    const collection = {
      visible: !panel('collection').hidden && panel('collection').offsetParent !== null,
      keywords: Boolean(panel('collection').querySelector('#collectionKeywords .chip-input input')),
      types: panel('collection').querySelectorAll('#collectionTypes input').length,
      threshold: Boolean(panel('collection').querySelector('#collectionThreshold')),
      startBtn: Boolean(panel('collection').querySelector('#collectionStart')),
      table: Boolean(panel('collection').querySelector('#collectionTableBody')),
      log: Boolean(panel('collection').querySelector('#collectionLog')),
      history: panel('collection').querySelector('#collectionHistory')?.options.length >= 1,
    }

    click('alert')
    await waitPanel('alert')
    const alert = {
      visible: !panel('alert').hidden && panel('alert').offsetParent !== null,
      keywords: Boolean(panel('alert').querySelector('#alertKeywords .chip-input input')),
      advanceDays: Boolean(panel('alert').querySelector('#alertAdvanceDays')),
      startBtn: Boolean(panel('alert').querySelector('#alertStart')),
      alertList: Boolean(panel('alert').querySelector('#alertList')),
      upcoming: Boolean(panel('alert').querySelector('#upcomingList')),
    }

    click('organization')
    await waitPanel('organization')
    const organization = {
      visible: !panel('organization').hidden && panel('organization').offsetParent !== null,
      keywords: Boolean(panel('organization').querySelector('#orgKeywords .chip-input input')),
      startBtn: Boolean(panel('organization').querySelector('#orgStart')),
      noticeList: Boolean(panel('organization').querySelector('#orgNoticeList')),
      recommendList: Boolean(panel('organization').querySelector('#orgRecommendList')),
      trackList: Boolean(panel('organization').querySelector('#orgTrackList')),
    }

    click('analysis')
    await waitPanel('analysis')
    const backToAnalysis = {
      visible: !panel('analysis').hidden && panel('analysis').offsetParent !== null,
      chartsStillThere: ['barChart','pieChart','lineChart','mapChart'].every((id) => Boolean(panel('analysis').querySelector('#' + id))),
      activeTab: document.querySelector('.module-tab.active')?.dataset.module || '',
    }
    return { collection, alert, organization, backToAnalysis }
  })()`)
  const switchPassed = switchState.collection.visible
    && switchState.collection.keywords && switchState.collection.types === 4 && switchState.collection.threshold
    && switchState.collection.startBtn && switchState.collection.table && switchState.collection.log && switchState.collection.history
    && switchState.alert.visible && switchState.alert.keywords && switchState.alert.advanceDays
    && switchState.alert.startBtn && switchState.alert.alertList && switchState.alert.upcoming
    && switchState.organization.visible && switchState.organization.keywords && switchState.organization.startBtn
    && switchState.organization.noticeList && switchState.organization.recommendList && switchState.organization.trackList
    && switchState.backToAnalysis.visible && switchState.backToAnalysis.chartsStillThere && switchState.backToAnalysis.activeTab === 'analysis'
    && consoleErrors.length === 0
  console.log(JSON.stringify(switchState, null, 2))
  console.log(switchPassed ? '功能切换与四面板渲染检查通过' : '功能切换与四面板渲染检查失败')
  if (!switchPassed) process.exitCode = 1

  // ---------- 第三阶段：竞争分析全链路（真实分析，调试模式） ----------
  console.log('开始真实分析（小规模 maxItems=2，调试模式）…')
  await evaluate(`(() => {
    document.getElementById('cfgDebug').checked = true
    document.getElementById('btnAnalyze').click()
  })()`)
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
    && finalState.printTitle.trim().length > 0
    && /^\d{2}:\d{2}:\d{2}$/.test(finalState.logTime)
    && finalState.logCount >= 6
    && finalState.debugPanelVisible
    && finalState.debugSections >= 7
    && consoleErrors.length === 0
  console.log(JSON.stringify({ ...finalState, consoleErrors }, null, 2))
  console.log(analysisPassed ? '端到端分析渲染检查通过（含本地时间日志）' : '端到端分析渲染检查失败')
  if (!analysisPassed) process.exitCode = 1

  // ---------- 第四阶段：切换后状态保留（竞争分析图表/结果不丢） ----------
  const retention = await evaluate(`(() => {
    const statBefore = document.getElementById('statTotal').textContent
    document.querySelector('.module-tab[data-module="collection"]').click()
    document.querySelector('.module-tab[data-module="analysis"]').click()
    return {
      statBefore,
      statAfter: document.getElementById('statTotal').textContent,
      placeholderStillHidden: document.getElementById('resultsPlaceholder').classList.contains('hidden'),
      activeTab: document.querySelector('.module-tab.active')?.dataset.module || '',
    }
  })()`)
  const retentionPassed = retention.statAfter === retention.statBefore
    && Number(retention.statAfter) > 0
    && retention.placeholderStillHidden
    && retention.activeTab === 'analysis'
    && consoleErrors.length === 0
  console.log(JSON.stringify({ ...retention, consoleErrors }, null, 2))
  console.log(retentionPassed ? '切换状态保留检查通过' : '切换状态保留检查失败')
  if (!retentionPassed) process.exitCode = 1
} catch (error) {
  console.error('测试失败:', error.message)
  process.exitCode = 1
} finally {
  socket?.close()
  browser.kill()
  server.kill()
  try { rmSync(profilePath, { recursive: true, force: true }) } catch { /* 忽略清理异常 */ }
}
