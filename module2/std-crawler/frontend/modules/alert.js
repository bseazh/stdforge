// 预警模块视图（标准预警）：监测配置 → 新国标预警列表（含距实施天数）+ 即将实施标准
// 契约：POST /api/analyze { moduleId: 'alert', config } → result = { alerts, upcoming, stats }
import { fieldHint, ChipInput } from '../core/ui.js'
import { wirePushBar } from '../core/mail.js'

export const moduleInfo = { id: 'alert', name: '标准预警', status: 'ready' }

// lucide 风格内联 SVG 图标（对齐 Policyanalysize / analysis.js：stroke="currentColor" fill="none"，禁止 emoji）
const svgIcon = (inner, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

const ICON_PATHS = {
  bellRing: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M22 8c0-2.3-.8-4.3-2-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  alertTriangle: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
}

function daysUntil(iso) {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return Math.ceil((date.getTime() - Date.now()) / 86400000)
}

function alertLevel(days) {
  if (days === null || days === undefined) return ''
  if (days <= 7) return '<span class="alert-node alert-node-7">≤7天</span>'
  if (days <= 30) return '<span class="alert-node alert-node-30">≤30天</span>'
  if (days <= 90) return '<span class="alert-node alert-node-90">≤90天</span>'
  return ''
}

function renderTemplate() {
  return `
    <!-- 01 · 监测范围 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.bellRing, 20)}</div>
        <div class="section-header-copy">
          <span>01 · 监测范围</span>
          <h2>关键词与标准类型</h2>
          <p>监测新发布 / 即将实施国标</p>
        </div>
      </div>
      <div class="section-body">
        <div class="config-grid" style="padding:0">
          <div class="config-field">
            <label class="field-label">关注关键词<small>　逐条输入，按回车或「＋ 添加」即可，不用再写逗号</small></label>
            <div id="alertKeywords"></div>
          </div>
          <div class="config-field">
            <label class="field-label">标准类型</label>
            <div class="pill-group" id="alertTypes" role="group" aria-label="标准类型">
              <label class="pill-option selected"><input type="checkbox" value="gb" checked style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>国家标准</span></label>
              <label class="pill-option selected"><input type="checkbox" value="plan" checked style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>国家标准计划</span></label>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 02 · 预警条件 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.clock, 20)}</div>
        <div class="section-header-copy">
          <span>02 · 预警条件</span>
          <h2>节点与识别窗口</h2>
          <p>距实施天数节点 · 新发布识别窗口</p>
        </div>
      </div>
      <div class="section-body">
        <div class="config-grid" style="padding:0">
          <div class="config-field">
            <label class="field-label">预警节点${fieldHint('距实施日期 ≤ 节点天数的标准触发对应预警级别。示例：填 90 表示提前 90 天提醒；需要多档提醒时分别运行即可。')}</label>
            <div class="input-with-suffix">
              <input type="number" id="alertNodes" value="90" min="1" max="365" step="1" />
              <span class="input-suffix">天</span>
            </div>
            <div class="field-hint-inline">只填一个数，例如 90 表示提前 90 天提醒</div>
          </div>
          <div class="config-field">
            <label class="field-label">新发布识别天数${fieldHint('发布日期距今天数 ≤ 该值的标准视为「新发布」。')}</label>
            <div class="input-with-suffix">
              <input type="number" id="alertAdvanceDays" value="30" min="1" max="365" step="1" />
              <span class="input-suffix">天</span>
            </div>
            <div class="field-hint-inline">发布日期距今 ≤ 该天数即视为新发布</div>
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
          <h2>运行监测</h2>
          <p>真实爬取 + 预警筛选</p>
        </div>
      </div>
      <div class="section-body">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="alertStart" style="min-height:46px;padding:11px 26px;font-size:14px">
            <span class="loading-spinner" style="display:none" aria-hidden="true"></span>
            ${svgIcon(ICON_PATHS.play, 16)}<span class="btn-text">开始监测</span>
          </button>
          <span class="server-status" id="alertServerStatus">检测服务连接…</span>
        </div>
      </div>
    </div>

    <div id="alertProgress"></div>

    <div id="alertDegraded" class="module-degraded" style="display:none">
      <strong>${svgIcon(ICON_PATHS.warn, 15)} 预警模块后端尚未就绪：</strong>当前服务未返回预警管线结果。请确认后端
      <code>capability-registry.mjs</code> + <code>alert-pipeline.mjs</code> 已就绪。
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.alertTriangle, 16)} 新国标预警列表</h3>
      <div class="filter-tags" style="margin-bottom:14px">
        <span class="filter-tag">预警节点 <b id="alertThresholdValue">90/30/7</b> 天</span>
        <span class="filter-tag">预警条数 <b id="alertCount">0</b></span>
      </div>
      <div id="alertList"></div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.calendar, 16)} 即将实施标准</h3>
      <div id="upcomingList"></div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.send, 16)} 审批后推送邮箱</h3>
      <div class="push-bar">
        <button type="button" class="btn btn-primary" id="alertPushBtn" disabled>${svgIcon(ICON_PATHS.checkCircle, 15)} 审批通过并推送邮箱</button>
        <a href="/mail-test" class="mail-link">${svgIcon(ICON_PATHS.mail, 13)} 收件人管理</a>
        <span class="server-status" id="alertPushStatus"></span>
      </div>
      <div id="alertPushInfo" class="push-info">
        尚未生成结果：运行监测后在此完成「审批 → 推送邮箱」（管理验证码会话 + 收件人白名单 + 发送限频）。
      </div>
    </div>`
}

function renderAlertCards(container, alerts) {
  const listEl = container.querySelector('#alertList')
  if (!alerts || alerts.length === 0) {
    listEl.innerHTML = '<div class="empty-tip">暂无预警</div>'
    return
  }
  listEl.innerHTML = alerts.map((alert) => {
    const days = alert.daysToEffective ?? daysUntil(alert.effectiveAt || alert.implementationDate || alert.effectiveDate || alert.implementDate)
    const noLink = alert.url
      ? `<a href="${alert.url}" target="_blank" rel="noopener">${alert.standardNo || '—'}</a>`
      : (alert.standardNo || '—')
    const titleLink = alert.url
      ? `<a href="${alert.url}" target="_blank" rel="noopener">${alert.title || '—'}</a>`
      : (alert.title || '—')
    return `
      <div class="alert-item">
        <div class="alert-item-head">
          <span class="alert-no">${noLink}</span>
          <span class="alert-status">${alert.status || '即将实施'}</span>
          ${alertLevel(days)}
        </div>
        <div class="alert-item-title">${titleLink}</div>
        <div class="alert-item-meta">
          发布日期：${alert.publishedAt || '—'}　实施日期：${alert.effectiveAt || '—'}　
          距实施：${days === null || days === undefined ? '—' : days >= 0 ? `${days} 天` : `已实施 ${-days} 天`}
        </div>
      </div>`
  }).join('')
}

function renderUpcoming(container, upcoming) {
  const listEl = container.querySelector('#upcomingList')
  if (!upcoming || upcoming.length === 0) {
    listEl.innerHTML = '<div class="empty-tip">暂无即将实施标准</div>'
    return
  }
  const sorted = [...upcoming].sort((a, b) => (a.daysToEffective ?? daysUntil(a.effectiveAt) ?? 1e9) - (b.daysToEffective ?? daysUntil(b.effectiveAt) ?? 1e9))
  listEl.innerHTML = sorted.map((item) => {
    const days = item.daysToEffective ?? daysUntil(item.effectiveAt || item.implementationDate || item.effectiveDate || item.implementDate)
    const noLink = item.url
      ? `<a href="${item.url}" target="_blank" rel="noopener">${item.standardNo || '—'}</a>`
      : (item.standardNo || '—')
    const titleLink = item.url
      ? `<a href="${item.url}" target="_blank" rel="noopener">${item.title || '—'}</a>`
      : (item.title || '—')
    return `
      <div class="upcoming-item">
        <div class="upcoming-days">${days === null || days === undefined ? '—' : `${days} 天`}</div>
        <div class="upcoming-main">
          <div><b>${noLink}</b>　${titleLink}</div>
          <div class="upcoming-meta">实施日期：${item.effectiveAt || '—'} ${alertLevel(days)}</div>
        </div>
      </div>`
  }).join('')
}

function buildConfig(container) {
  return {
    keywords: String(container._chipInputs?.alertKeywords?.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    types: [...container.querySelectorAll('#alertTypes input:checked')].map((input) => input.value),
    alertNodes: [Number(container.querySelector('#alertNodes').value) || 90],
    newDays: Number(container.querySelector('#alertAdvanceDays').value) || 30,
    maxItems: 24,
    concurrency: 4,
  }
}

export function initModule(container, ctx) {
  const { api, ui } = ctx
  container.innerHTML = renderTemplate()

  // 关键词：单值输入 + 标签（不用逗号）
  const keywordInput = document.createElement('input')
  keywordInput.type = 'text'
  keywordInput.placeholder = '输入一个关键词后回车或点「＋ 添加」'
  container.querySelector('#alertKeywords').appendChild(keywordInput)
  const keywordChip = new ChipInput(container.querySelector('#alertKeywords'), keywordInput)
  keywordChip.setValues(['冰箱', '保鲜', '制冷'])
  container._chipInputs = { ...(container._chipInputs || {}), alertKeywords: keywordChip }

  const pushBar = wirePushBar({
    container,
    moduleId: 'alert',
    button: '#alertPushBtn',
    status: '#alertPushStatus',
    info: '#alertPushInfo',
    ui,
  })

  // 胶囊多选视觉同步：checkbox 隐藏但保留 value / checked（buildConfig 的 input:checked 查询继续工作）
  function syncPillState() {
    ;[...container.querySelectorAll('#alertTypes .pill-option')].forEach((pill) => {
      const input = pill.querySelector('input')
      pill.classList.toggle('selected', !!input?.checked)
    })
  }

  const applyConfig = (config) => {
    if (!config) return
    keywordChip.setValues(config.keywords || [])
    ;[...container.querySelectorAll('#alertTypes input[type="checkbox"]')].forEach((input) => {
      input.checked = (config.types || []).includes(input.value)
    })
    syncPillState()
    if (Array.isArray(config.alertNodes) && config.alertNodes.length) container.querySelector('#alertNodes').value = config.alertNodes[0]
    if (config.newDays) container.querySelector('#alertAdvanceDays').value = config.newDays
  }

  // 主按钮运行中状态：loading-spinner + 禁用 + 文案
  function setRunning(running) {
    const btn = container.querySelector('#alertStart')
    btn.disabled = running
    const spinner = btn.querySelector('.loading-spinner')
    const label = btn.querySelector('.btn-text')
    if (spinner) spinner.style.display = running ? 'inline-block' : 'none'
    if (label) label.textContent = running ? '监测中…' : '开始监测'
  }

  container.querySelector('#alertStart').addEventListener('click', async () => {
    const config = buildConfig(container)
    if (!config.keywords.length) return ui.showToast('请至少填写一个关键词', 'error')
    if (!config.types.length) return ui.showToast('请至少选择一种标准类型', 'error')
    if (location.protocol === 'file:') {
      ui.showToast('静态模式：请运行 node std-crawler/serve-demo.mjs 后访问 http://127.0.0.1:5277', 'warn')
      return
    }
    container.querySelector('#alertThresholdValue').textContent = config.alertNodes.join('/')

    const progress = new ui.ProgressPanel(container.querySelector('#alertProgress'), { title: '监测中（真实爬取 + 预警筛选）' })
    progress.show()
    progress.clearLogs()
    progress.setProgress(2)
    progress.appendLog({ time: new Date().toISOString(), stage: '任务创建', message: `关键词「${config.keywords.join(' / ')}」预警节点 ${config.alertNodes.join('/')} 天` })

    setRunning(true)
    try {
      const { jobId } = await api.createJob('alert', config)
      const result = await api.pollJob(jobId, {
        onLog: (entry) => {
          progress.appendLog(entry)
          progress.setProgress(entry.stage === 'LLM 提取' ? 90 : 70)
        },
      })
      progress.setTitle('监测完成')
      progress.setProgress(100)
      setRunning(false)

      const alerts = result.alerts || []
      const upcoming = result.upcoming || alerts.filter((item) => {
        const days = item.daysToEffective ?? daysUntil(item.effectiveAt)
        return days !== null && days !== undefined && days >= 0 && days <= 90
      })
      container.querySelector('#alertDegraded').style.display = alerts.length ? 'none' : 'block'
      container.querySelector('#alertCount').textContent = alerts.length
      renderAlertCards(container, alerts)
      renderUpcoming(container, upcoming)
      if (pushBar) pushBar.refresh()
      ui.showToast(`监测完成：${alerts.length} 条预警、${upcoming.length} 条即将实施`, 'success')
    } catch (error) {
      setRunning(false)
      progress.setTitle('监测失败')
      progress.appendLog({ time: new Date().toISOString(), stage: '错误', message: error.message })
      container.querySelector('#alertDegraded').style.display = 'block'
      ui.showToast('监测失败：' + error.message, 'error')
    }
  })

  // 胶囊多选视觉同步（checkbox 仍真实存在，change 由 label 包裹触发）
  container.querySelector('#alertTypes').addEventListener('change', syncPillState)

  syncPillState()
  container.querySelector('#alertServerStatus').textContent = '预警模块已就绪（可对接后端预警管线）'

  return {
    destroy() {
      container.innerHTML = ''
    },
  }
}
