// 每日采集预警模块（采集+预警 合并快捷实现）：默认检索最近一天（Asia/Shanghai）标准信息
//   → 采集 + 预警 → LLM 生成两份报告（默认只生成报告，不审查、不推送）
// 报告日期默认最近一天，可在配置区调整（补采指定历史日期）
// 契约：POST /api/analyze { moduleId: 'case56', config } → result = { reportDate, collection, alert, reports, review, stats }
import { fieldHint, ChipInput } from '../core/ui.js'
import { wirePushBar } from '../core/mail.js'

export const moduleInfo = { id: 'case56', name: '每日采集预警', status: 'ready' }

const DEFAULT_SOURCES = [
  { value: 'gb', label: '国家标准' },
  { value: 'hb', label: '行业标准' },
  { value: 'db', label: '地方标准' },
  { value: 'plan', label: '国家标准计划' },
]

// lucide 风格内联 SVG 图标（对齐 Policyanalysize / analysis.js：stroke="currentColor" fill="none"，禁止 emoji）
const svgIcon = (inner, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

const ICON_PATHS = {
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  folderTree: '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  bellRing: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/>',
}

// 安全 Markdown 渲染（先转义 HTML 再做轻量转换，禁止注入脚本）
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const renderMarkdown = (markdown = '') => {
  let html = escapeHtml(markdown)
    .replace(/^# (.*)$/gm, '<h3 class="md-h1">$1</h3>')
    .replace(/^## (.*)$/gm, '<h4 class="md-h2">$1</h4>')
    .replace(/^### (.*)$/gm, '<h5 class="md-h3">$1</h5>')
    .replace(/^&gt; (.*)$/gm, '<blockquote class="md-quote">$1</blockquote>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="md-link">$1</a>')
  const tablePattern = /((?:\|[^\n]*\|(?:\n|$))+)/g
  html = html.replace(tablePattern, (block) => {
    const lines = block.trim().split('\n').filter(Boolean)
    if (lines.length < 2) return block
    const cells = (line) => line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim())
    const header = cells(lines[0])
    const isSeparator = cells(lines[1]).every((cell) => /^:?-{2,}:?$/.test(cell))
    const body = isSeparator ? lines.slice(2) : lines.slice(1)
    return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join('')}</tr></thead><tbody>${body.map((line) => `<tr>${cells(line).map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
  })
  html = html.replace(/^\s*•\s+(.*)$/gm, '<li class="md-li">$1</li>')
  html = html.replace(/(<li class="md-li">[\s\S]*?<\/li>)/g, '<ul class="md-ul">$1</ul>')
  html = html.replace(/<\/ul>\s*<ul class="md-ul">/g, '')
  html = html.replace(/\n{2,}/g, '<br/>')
  return html
}

const renderTemplate = () => `
  <!-- 01 · 报告范围 -->
  <div class="config-section">
    <div class="section-header">
      <div class="section-icon">${svgIcon(ICON_PATHS.fileText, 20)}</div>
      <div class="section-header-copy">
        <span>01 · 报告范围</span>
        <h2>每日采集预警</h2>
        <p>采集与预警合并快捷执行</p>
      </div>
    </div>
    <div class="section-body">
      <div class="config-grid" style="padding:0">
        <div class="config-field">
          <label class="field-label">关注关键词<small>　逐条输入，按回车或「＋ 添加」即可，不用再写逗号</small></label>
          <div id="case56Keywords"></div>
        </div>
        <div class="config-field">
          <label class="field-label">标准类型</label>
          <div class="pill-group" id="case56Types" role="group" aria-label="标准类型">
            ${DEFAULT_SOURCES.map((source) => `<label class="pill-option selected"><input type="checkbox" value="${source.value}" checked style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>${source.label}</span></label>`).join('')}
          </div>
        </div>
        <div class="config-field">
          <label class="field-label">报告日期${fieldHint('默认检索最近一天（Asia/Shanghai）；如需补采指定历史日期，可在此调整为任意日期。')}</label>
          <input type="date" id="case56Date" class="config-date-input" />
          <div class="field-hint-inline">默认最近一天 · 可调整补采历史</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 02 · 报告条件 -->
  <div class="config-section">
    <div class="section-header">
      <div class="section-icon">${svgIcon(ICON_PATHS.settings, 20)}</div>
      <div class="section-header-copy">
        <span>02 · 报告条件</span>
        <h2>提醒线与预警节点</h2>
        <p>采集提醒门槛 · 预警节点</p>
      </div>
    </div>
    <div class="section-body">
      <div class="config-grid" style="padding:0">
        <div class="config-field">
          <label class="field-label">相关度阈值${fieldHint('采集报告中标记「提醒」的相关度门槛：得分 ≥ 该值的记录进入待办提醒（0-100，默认 80）。')}</label>
          <div class="input-with-suffix">
            <input type="number" id="case56Threshold" value="80" min="0" max="100" />
            <span class="input-suffix">分</span>
          </div>
          <div class="field-hint-inline">范围 0-100，默认 80（采集提醒线）</div>
        </div>
        <div class="config-field">
          <label class="field-label">预警节点${fieldHint('距实施日期 ≤ 节点天数时触发预警标记。示例：填 90 表示提前 90 天提醒。')}</label>
          <div class="input-with-suffix">
            <input type="number" id="case56Nodes" value="90" min="1" max="365" step="1" />
            <span class="input-suffix">天</span>
          </div>
          <div class="field-hint-inline">只填一个数，例如 90 表示提前 90 天提醒（预警）</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 03 · 执行 -->
  <div class="config-section">
    <div class="section-header">
      <div class="section-icon">${svgIcon(ICON_PATHS.play, 20)}</div>
      <div class="section-header-copy">
        <span>03 · 执行</span>
        <h2>生成报告</h2>
        <p>指定日期检索 → LLM 提取 → 双报告</p>
      </div>
    </div>
    <div class="section-body">
      <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
        <button type="button" class="btn btn-primary" id="case56Start" style="min-height:46px;padding:11px 26px;font-size:14px">
          <span class="loading-spinner" style="display:none" aria-hidden="true"></span>
          ${svgIcon(ICON_PATHS.play, 16)}<span class="btn-text">生成报告</span>
        </button>
        <span class="server-status" id="case56ServerStatus">检测服务连接…</span>
      </div>
    </div>
  </div>

  <div id="case56Progress"></div>

  <div class="analysis-section">
    <h3 class="analysis-title">${svgIcon(ICON_PATHS.fileText, 16)} 报告预览 <span class="report-date-tag" id="case56ReportDate">${svgIcon(ICON_PATHS.calendar, 14)} 未生成</span></h3>
    <div id="case56Reports">
      <div class="empty-tip">尚未生成报告。点击「生成报告」后，将按采集/预警两部分分别生成报告。</div>
    </div>
  </div>

  <div class="analysis-section">
    <h3 class="analysis-title">${svgIcon(ICON_PATHS.send, 16)} 审批后推送邮箱</h3>
    <div class="push-bar">
      <button type="button" class="btn btn-primary" id="case56PushBtn" disabled>${svgIcon(ICON_PATHS.checkCircle, 15)} 审批通过并推送邮箱</button>
      <a href="/mail-test" class="mail-link">${svgIcon(ICON_PATHS.mail, 13)} 收件人管理</a>
      <span class="server-status" id="case56PushStatus"></span>
    </div>
    <div id="case56PushInfo" class="push-info">
      尚未生成结果：运行模块后将在此展示推送摘要，审批通过后方可推送邮箱。
    </div>
  </div>`

const buildConfig = (container) => ({
  keywords: String(container._chipInputs?.case56Keywords?.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
  types: [...container.querySelectorAll('#case56Types input:checked')].map((input) => input.value),
  relevanceThreshold: Number(container.querySelector('#case56Threshold').value) || 80,
  alertNodes: [Number(container.querySelector('#case56Nodes').value) || 90],
  reportDate: String(container.querySelector('#case56Date')?.value || '') || null, // 空 → 后端默认最近一天
  maxItems: 60,
  llmConcurrency: 5,
  withLlm: true,
  withReview: false, // 只生成报告，默认不做 LLM 审查
})

const renderReports = (container, result) => {
  const el = container.querySelector('#case56Reports')
  const reports = result?.reports || {}
  const entries = [
    { key: 'collection', label: '标准采集报告', icon: svgIcon(ICON_PATHS.folderTree, 15) },
    { key: 'alert', label: '新国标预警推送报告', icon: svgIcon(ICON_PATHS.bellRing, 15) },
  ]
  if (!reports.collection && !reports.alert) {
    el.innerHTML = '<div class="empty-tip">未生成报告</div>'
    return
  }
  el.innerHTML = entries.map(({ key, label, icon }) => {
    const report = reports[key]
    if (!report) return ''
    return `
      <div class="report-card">
        <div class="report-head">
          <div>
            <div class="report-title">${icon} ${label}</div>
            <div class="report-subtitle">${report.title || ''}</div>
          </div>
          ${report.error ? `<span class="report-error">${svgIcon(ICON_PATHS.warn, 14)} ${report.error}</span>` : `<span class="report-model">${report.model ? `模型 ${report.model}` : ''}</span>`}
        </div>
        ${report.summary ? `<div class="report-summary">${report.summary}</div>` : ''}
        <div class="md-body">${renderMarkdown(report.markdown || '（报告内容为空）')}</div>
      </div>`
  }).join('')
}

const renderStats = (container, result) => {
  const stats = result?.stats || {}
  const el = container.querySelector('#case56ServerStatus')
  el.textContent = `${result?.reportDate || '—'}：采集 ${stats.total ?? 0} 条 · 高相关 ${stats.remindCount ?? 0} 条 · 预警 ${stats.alertCount ?? 0} 条 · 即将实施 ${stats.upcomingCount ?? 0} 条`
}

export function initModule(container, ctx) {
  const { api, ui } = ctx
  container.innerHTML = renderTemplate()

  // 关键词：单值输入 + 标签（不用逗号）
  const keywordInput = document.createElement('input')
  keywordInput.type = 'text'
  keywordInput.placeholder = '输入一个关键词后回车或点「＋ 添加」'
  container.querySelector('#case56Keywords').appendChild(keywordInput)
  const keywordChip = new ChipInput(container.querySelector('#case56Keywords'), keywordInput)
  keywordChip.setValues(['冰箱', '保鲜', '食品保鲜', '制冷', '家用电器', '家电'])
  container._chipInputs = { ...(container._chipInputs || {}), case56Keywords: keywordChip }

  const pushBar = wirePushBar({
    container,
    moduleId: 'case56',
    button: '#case56PushBtn',
    status: '#case56PushStatus',
    info: '#case56PushInfo',
    ui,
  })

  // 胶囊多选视觉同步：checkbox 隐藏但保留 value / checked（buildConfig 的 input:checked 查询继续工作）
  function syncPillState() {
    ;[...container.querySelectorAll('#case56Types .pill-option')].forEach((pill) => {
      const input = pill.querySelector('input')
      pill.classList.toggle('selected', !!input?.checked)
    })
  }

  // 主按钮运行中状态：loading-spinner + 禁用 + 文案
  function setRunning(running) {
    const btn = container.querySelector('#case56Start')
    btn.disabled = running
    const spinner = btn.querySelector('.loading-spinner')
    const label = btn.querySelector('.btn-text')
    if (spinner) spinner.style.display = running ? 'inline-block' : 'none'
    if (label) label.textContent = running ? '生成报告中…' : '生成报告'
  }

  // 上海时区「最近一天」：YYYY-MM-DD（与后端 yesterdayInShanghai 一致）
  const shanghaiDate = (date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
    const map = {}
    for (const part of parts) map[part.type] = part.value
    return `${map.year}-${map.month}-${map.day}`
  }
  const yesterdayInShanghai = () => {
    const now = new Date()
    const todayStr = shanghaiDate(now)
    const today = new Date(`${todayStr}T00:00:00+08:00`)
    return shanghaiDate(new Date(today.getTime() - 86_400_000))
  }

  // 报告日期：默认最近一天（可调整补采历史日期）
  const dateInput = container.querySelector('#case56Date')
  dateInput.value = yesterdayInShanghai()
  const syncDateTag = (reportDate) => {
    const tag = container.querySelector('#case56ReportDate')
    const value = reportDate || yesterdayInShanghai()
    tag.innerHTML = `${svgIcon(ICON_PATHS.calendar, 14)} ${value}`
    if (reportDate) dateInput.value = reportDate
  }

  const loadLatest = async () => {
    try {
      const response = await fetch('/api/case56/latest', { cache: 'no-store' })
      if (response.ok) {
        const data = await response.json()
        const result = data.result
        syncDateTag(result.reportDate)
        renderReports(container, result)
        renderStats(container, result)
        if (pushBar) pushBar.refresh()
      } else {
        syncDateTag(yesterdayInShanghai())
      }
    } catch {
      const tag = container.querySelector('#case56ReportDate')
      tag.innerHTML = `${svgIcon(ICON_PATHS.calendar, 14)} ${yesterdayInShanghai()}`
    }
  }

  container.querySelector('#case56Start').addEventListener('click', async () => {
    const config = buildConfig(container)
    if (!config.keywords.length) return ui.showToast('请至少填写一个关键词', 'error')
    if (!config.types.length) return ui.showToast('请至少选择一种标准类型', 'error')

    const effectiveDate = config.reportDate || yesterdayInShanghai()
    const progress = new ui.ProgressPanel(container.querySelector('#case56Progress'), { title: `执行中（${effectiveDate} → LLM 提取 → 双报告）` })
    progress.show()
    progress.clearLogs()
    progress.setProgress(2)
    progress.appendLog({ time: new Date().toISOString(), stage: '任务创建', message: `检索日期 ${effectiveDate} · 关键词「${config.keywords.join(' / ')}」类型「${config.types.join(' / ')}」` })

    setRunning(true)
    try {
      const { jobId } = await api.createJob('case56', config)
      const result = await api.pollJob(jobId, {
        onLog: (entry) => {
          progress.appendLog(entry)
          if (entry.stage === 'LLM 报告') progress.setProgress(85)
          else if (entry.stage === 'LLM 审查') progress.setProgress(95)
          else if (entry.stage === '处理') progress.setProgress(65)
          else if (entry.stage === 'LLM 提取') progress.setProgress(50)
          else progress.setProgress(25)
        },
      })
      progress.setTitle('报告生成完成')
      progress.setProgress(100)
      setRunning(false)

      syncDateTag(result.reportDate)
      renderReports(container, result)
      renderStats(container, result)
      if (pushBar) pushBar.refresh()
      ui.showToast(`报告生成完成：采集 ${result.stats.total} 条 · 预警 ${result.stats.alertCount} 条`, 'success')
    } catch (error) {
      setRunning(false)
      progress.setTitle('执行失败')
      progress.appendLog({ time: new Date().toISOString(), stage: '错误', message: error.message })
      ui.showToast('执行失败：' + error.message, 'error')
    }
  })

  // 胶囊多选视觉同步（checkbox 仍真实存在，change 由 label 包裹触发）
  container.querySelector('#case56Types').addEventListener('change', syncPillState)

  loadLatest()
  syncPillState()
  container.querySelector('#case56ServerStatus').textContent = '每日采集预警模块已就绪（默认检索最近一天）'

  return {
    destroy() {
      container.innerHTML = ''
    },
  }
}
