import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const browserCandidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
]
const browserPath = browserCandidates.find(existsSync)
if (!browserPath) throw new Error('未找到 Edge 或 Chrome')

const root = process.cwd()
const profilePath = join(root, '.edge-ui-test')
const screenshotPath = join(root, 'ui-crawler-e2e.png')
const interpretationScreenshotPath = join(root, 'ui-interpretation-types.png')
mkdirSync(profilePath, { recursive: true })

const browser = spawn(browserPath, [
  '--headless',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-gpu-compositing',
  '--remote-debugging-port=9224',
  `--user-data-dir=${profilePath}`,
  '--window-size=1400,1200',
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
  await waitForJson('http://127.0.0.1:9224/json/version')
  const target = await fetch('http://127.0.0.1:9224/json/new?http://127.0.0.1:5173', { method: 'PUT' }).then((response) => response.json())
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id)
      pending.delete(message.id)
      if (message.error) reject(new Error(message.error.message))
      else resolve(message.result)
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

  await command('Page.enable')
  await command('Runtime.enable')
  await wait(1_000)
  const navigation = []
  for (const index of [1, 2, 3]) {
    await evaluate(`document.querySelectorAll('.task-switcher > button')[${index}].click()`)
    await wait(150)
    navigation.push(await evaluate(`document.querySelector('.task-workspace-copy h2')?.textContent`))
  }
  await evaluate(`document.querySelectorAll('.task-switcher > button')[2].click()`)
  await wait(180)
  const interpretationInitial = await evaluate(`({
    cards: document.querySelectorAll('.summary-choices .choice-card').length,
    skillIds: [...document.querySelectorAll('.summary-choices .choice-card')].map((card) => card.dataset.skillId),
    selectedSkill: document.querySelector('.summary-choices .choice-card.selected')?.dataset.skillId,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  })`)
  await evaluate(`document.querySelectorAll('.summary-choices .choice-card')[1]?.click()`)
  await wait(180)
  const interpretationSwitched = await evaluate(`({
    selectedSkill: document.querySelector('.summary-choices .choice-card.selected')?.dataset.skillId,
    selectedTitle: document.querySelector('.summary-choices .choice-card.selected .choice-copy strong')?.textContent
  })`)
  await evaluate(`(() => {
    const audience = document.querySelector('.interpretation-layout .select-wrap select')
    audience.value = '其他'
    audience.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(120)
  const audienceOptions = await evaluate(`({
    options: [...document.querySelectorAll('.interpretation-layout .select-wrap select option')].map((option) => option.textContent),
    selected: document.querySelector('.interpretation-layout .select-wrap select')?.value,
    customInputVisible: Boolean(document.querySelector('.custom-analysis-audience input'))
  })`)
  const interpretationScreenshot = await command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  writeFileSync(interpretationScreenshotPath, Buffer.from(interpretationScreenshot.data, 'base64'))
  await evaluate(`document.querySelectorAll('.task-switcher > button')[0].click()`)
  await wait(200)
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    const dates = document.querySelectorAll('input[type="date"]')
    setValue.call(dates[0], '2020-01-01')
    dates[0].dispatchEvent(new Event('input', { bubbles: true }))
    dates[0].dispatchEvent(new Event('change', { bubbles: true }))
    setValue.call(dates[1], '${new Date().toISOString().slice(0, 10)}')
    dates[1].dispatchEvent(new Event('input', { bubbles: true }))
    dates[1].dispatchEvent(new Event('change', { bubbles: true }))
    return dates.length
  })()`)
  await wait(350)
  await evaluate(`document.querySelector('.start-button').click()`)

  let state
  for (let attempt = 0; attempt < 120; attempt += 1) {
    state = await evaluate(`({
      progress: document.querySelector('.progress-heading b')?.textContent,
      status: document.querySelector('.progress-heading span')?.textContent,
      resultCards: document.querySelectorAll('.policy-result-card').length,
      resultCount: document.querySelector('.crawl-results-header b')?.textContent,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    })`)
    if (state.progress === '100%' || /失败/.test(state.status || '')) break
    await wait(500)
  }

  await evaluate(`(() => {
    const toggles = document.querySelectorAll('.policy-select-toggle')
    toggles[0]?.click()
    toggles[1]?.click()
  })()`)
  await wait(200)
  const selection = await evaluate(`({
    selectedCards: document.querySelectorAll('.policy-result-card.selected').length,
    selectedLabel: document.querySelector('.policy-selection-toolbar > div > span')?.textContent,
    confirmDisabled: document.querySelector('.confirm-selection-button')?.disabled
  })`)
  await evaluate(`document.querySelector('.confirm-selection-button').click()`)
  await wait(250)
  for (let attempt = 0; attempt < 480; attempt += 1) {
    const analysisState = await evaluate(`({
      rows: document.querySelectorAll('.classification-policy-row').length,
      disabledSelects: document.querySelectorAll('.classification-inline-field select:disabled').length
    })`)
    if (analysisState.rows === 2 && analysisState.disabledSelects === 0) break
    await wait(250)
  }
  const classification = await evaluate(`({
    activeTask: document.querySelector('.task-switcher > button.active strong')?.textContent,
    workspaceTitle: document.querySelector('.task-workspace-copy h2')?.textContent,
    policyRows: document.querySelectorAll('.classification-policy-row').length,
    detailTriggers: document.querySelectorAll('.classification-detail-trigger').length,
    interpretationTriggers: document.querySelectorAll('.policy-interpretation-trigger').length,
    filterControls: document.querySelectorAll('.classification-heading-tools select').length,
    editableSelects: [...document.querySelectorAll('.classification-inline-field select')].filter((select) => !select.disabled).length,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  })`)
  await evaluate(`(() => {
    const selects = document.querySelectorAll('.classification-policy-card:first-child .classification-inline-field select')
    selects[0].value = '省级'
    selects[0].dispatchEvent(new Event('change', { bubbles: true }))
    selects[1].value = '通用政策'
    selects[1].dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(150)
  await evaluate(`(() => {
    const filters = document.querySelectorAll('.classification-heading-tools select')
    filters[0].value = '省级'
    filters[0].dispatchEvent(new Event('change', { bubbles: true }))
    filters[1].value = '通用政策'
    filters[1].dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(150)
  const filtering = await evaluate(`({
    visibleRows: document.querySelectorAll('.classification-policy-row').length,
    resultCount: document.querySelector('.classification-heading-tools > b')?.textContent
  })`)
  await evaluate(`(() => {
    const filters = document.querySelectorAll('.classification-heading-tools select')
    filters[0].value = '全部层级'
    filters[0].dispatchEvent(new Event('change', { bubbles: true }))
    filters[1].value = '全部类型'
    filters[1].dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(150)
  await evaluate(`document.querySelector('.classification-policy-card:first-child .classification-detail-trigger')?.click()`)
  await wait(200)
  const manualAdjustment = await evaluate(`({
    status: document.querySelector('.classification-detail-drawer-heading > b')?.textContent,
    level: document.querySelector('.classification-policy-card:first-child .classification-inline-field:nth-of-type(1) select')?.value,
    category: document.querySelector('.classification-policy-card:first-child .classification-inline-field:nth-of-type(2) select')?.value,
    drawerVisible: Boolean(document.querySelector('.classification-policy-card:first-child .classification-detail-drawer')),
    reasoningVisible: Boolean(document.querySelector('.classification-policy-card:first-child .model-classification-reasoning')),
    structuredJsonCount: document.querySelectorAll('.classification-policy-card:first-child .structured-json-details').length,
    drawerInsideCard: (() => {
      const card = document.querySelector('.classification-policy-card:first-child')?.getBoundingClientRect()
      const drawer = document.querySelector('.classification-policy-card:first-child .classification-detail-drawer')?.getBoundingClientRect()
      return Boolean(card && drawer && Math.abs(card.bottom - drawer.bottom) < 2)
    })()
  })`)

  const screenshot = await command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  const summaryPresentation = await evaluate(`(() => {
    const summary = document.querySelector('.classification-policy-card:first-child .classification-policy-summary > p')
    const tooltip = document.querySelector('.classification-policy-card:first-child .classification-summary-tooltip span')
    return {
      text: summary?.textContent,
      startsCleanly: !/^[\\s，,。；;：:、…·-]/.test(summary?.textContent || ''),
      usesEllipsis: summary ? getComputedStyle(summary).textOverflow === 'ellipsis' : false,
      tooltipMatches: summary?.textContent === tooltip?.textContent
    }
  })()`)
  await evaluate(`document.querySelector('.classification-policy-card:first-child .policy-interpretation-trigger')?.click()`)
  await wait(220)
  const moduleLinkage = await evaluate(`({
    activeTask: document.querySelector('.task-switcher > button.active strong')?.textContent,
    workspaceTitle: document.querySelector('.task-workspace-copy h2')?.textContent,
    selectedPolicyTitle: document.querySelector('.interpretation-policy-card > a')?.textContent?.trim(),
    analysisCards: document.querySelectorAll('.summary-choices .choice-card').length,
    selectedSkill: document.querySelector('.summary-choices .choice-card.selected')?.dataset.skillId,
    audienceOption: document.querySelector('.interpretation-layout .select-wrap select')?.value,
    customInputVisible: Boolean(document.querySelector('.custom-analysis-audience input')),
    runButtonDisabled: document.querySelector('.interpretation-run-bar > button')?.disabled,
    resultPlaceholder: Boolean(document.querySelector('.interpretation-result-placeholder')),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
  })`)
  await evaluate(`(() => {
    const input = document.querySelector('.custom-analysis-audience input')
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setValue.call(input, '供应链管理组')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await wait(140)
  const customAudience = await evaluate(`({
    value: document.querySelector('.custom-analysis-audience input')?.value,
    runButtonDisabled: document.querySelector('.interpretation-run-bar > button')?.disabled,
    configuration: document.querySelector('.interpretation-run-bar strong')?.textContent
  })`)
  await evaluate(`document.querySelector('.interpretation-run-bar > button')?.click()`)
  for (let attempt = 0; attempt < 720; attempt += 1) {
    const reportState = await evaluate(`({
      completed: Boolean(document.querySelector('.interpretation-result-completed')),
      error: document.querySelector('.interpretation-result-error')?.textContent
    })`)
    if (reportState.completed || reportState.error) break
    await wait(250)
  }
  const renderedReport = await evaluate(`(() => {
    const report = document.querySelector('.interpretation-markdown-report')
    return {
      visible: Boolean(report),
      headingCount: report?.querySelectorAll('h1, h2, h3').length || 0,
      tableCount: report?.querySelectorAll('table').length || 0,
      listCount: report?.querySelectorAll('ul, ol').length || 0,
      rawHeadingHidden: !/^\\s*#/.test(report?.textContent || ''),
      copyButton: [...document.querySelectorAll('.interpretation-result-toolbar button')].some((button) => button.textContent.includes('复制报告原文')),
      copyButtonPrimary: document.querySelector('.interpretation-result-toolbar button')?.classList.contains('primary'),
      toolbarButtonCount: document.querySelectorAll('.interpretation-result-toolbar button').length,
      saveButton: [...document.querySelectorAll('.interpretation-result-toolbar button')].some((button) => button.textContent.includes('保存为 Markdown')),
      audienceLabel: document.querySelector('.interpretation-result-toolbar span')?.textContent,
      error: document.querySelector('.interpretation-result-error')?.textContent
    }
  })()`)
  const linkedInterpretationScreenshot = await command('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
  })
  writeFileSync(interpretationScreenshotPath, Buffer.from(linkedInterpretationScreenshot.data, 'base64'))
  console.log(JSON.stringify({
    navigation,
    interpretationInitial,
    interpretationSwitched,
    audienceOptions,
    crawl: state,
    selection,
    classification,
    filtering,
    manualAdjustment,
    summaryPresentation,
    moduleLinkage,
    customAudience,
    renderedReport,
    screenshotPath,
    interpretationScreenshotPath,
  }, null, 2))

  const navigationPassed = navigation.join('|') === '政策分类标注|政策分析与解读|邮件定向推送'
  const interpretationPassed = interpretationInitial.cards === 2
    && interpretationInitial.skillIds.join('|') === 'policy-expert-interpretation|policy-clause-analysis'
    && interpretationInitial.selectedSkill === 'policy-expert-interpretation'
    && !interpretationInitial.horizontalOverflow
    && interpretationSwitched.selectedSkill === 'policy-clause-analysis'
    && interpretationSwitched.selectedTitle === '条款拆解型'
    && audienceOptions.options.join('|') === '标准化管理组|政策研究组|法务与合规组|研发/产品设计组|质量管理组|高层管理/决策层|其他'
    && audienceOptions.selected === '其他'
    && audienceOptions.customInputVisible
  const handoffPassed = selection.selectedCards === 2
    && !selection.confirmDisabled
    && classification.activeTask === '政策分类标注'
    && classification.policyRows === 2
    && classification.detailTriggers === 2
    && classification.interpretationTriggers === 2
    && classification.filterControls === 2
    && classification.editableSelects === 4
    && !classification.horizontalOverflow
    && filtering.visibleRows === 1
    && filtering.resultCount === '1 条'
    && manualAdjustment.status === '人工已调整'
    && manualAdjustment.level === '省级'
    && manualAdjustment.category === '通用政策'
    && manualAdjustment.drawerVisible
    && manualAdjustment.reasoningVisible
    && manualAdjustment.structuredJsonCount === 1
    && manualAdjustment.drawerInsideCard
    && summaryPresentation.startsCleanly
    && summaryPresentation.usesEllipsis
    && summaryPresentation.tooltipMatches
    && moduleLinkage.activeTask === '政策分析与解读'
    && moduleLinkage.workspaceTitle === '政策分析与解读'
    && Boolean(moduleLinkage.selectedPolicyTitle)
    && moduleLinkage.analysisCards === 2
    && moduleLinkage.selectedSkill === 'policy-clause-analysis'
    && moduleLinkage.audienceOption === '其他'
    && moduleLinkage.customInputVisible
    && moduleLinkage.runButtonDisabled === true
    && moduleLinkage.resultPlaceholder
    && !moduleLinkage.horizontalOverflow
    && customAudience.value === '供应链管理组'
    && customAudience.runButtonDisabled === false
    && customAudience.configuration.includes('供应链管理组')
    && renderedReport.visible
    && renderedReport.headingCount > 0
    && renderedReport.tableCount > 0
    && renderedReport.listCount > 0
    && renderedReport.rawHeadingHidden
    && renderedReport.copyButton
    && renderedReport.copyButtonPrimary
    && renderedReport.toolbarButtonCount === 1
    && !renderedReport.saveButton
    && renderedReport.audienceLabel.includes('供应链管理组')
    && !renderedReport.error
  if (!navigationPassed || !interpretationPassed || state.progress !== '100%' || state.resultCards < 1 || state.horizontalOverflow || !handoffPassed) {
    process.exitCode = 1
  }
} finally {
  socket?.close()
  browser.kill()
}
