// 采集模块视图（标准采集）：配置 → 提交采集任务 → 结果列表 + 采集日志
// 契约：POST /api/analyze { moduleId: 'collection', config } → result = { items, log, stats }
import { fieldHint, ChipInput } from '../core/ui.js'
import { wirePushBar } from '../core/mail.js'

export const moduleInfo = { id: 'collection', name: '标准采集', status: 'ready' }

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
  folderTree: '<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  folderOpen: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
}

function renderTemplate() {
  return `
    <!-- 01 · 采集范围 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.folderTree, 20)}</div>
        <div class="section-header-copy">
          <span>01 · 采集范围</span>
          <h2>关键词与数据源</h2>
          <p>定义要采集的标准类型与来源</p>
        </div>
      </div>
      <div class="section-body">
        <div class="config-grid" style="padding:0">
          <div class="config-field">
            <label class="field-label">关注关键词<small>　逐条输入，按回车或「＋ 添加」即可，不用再写逗号</small></label>
            <div id="collectionKeywords"></div>
          </div>
          <div class="config-field">
            <label class="field-label">数据源 / 类型</label>
            <div class="pill-group" id="collectionTypes" role="group" aria-label="数据源/类型">
              ${DEFAULT_SOURCES.map((source) => `<label class="pill-option selected"><input type="checkbox" value="${source.value}" checked style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>${source.label}</span></label>`).join('')}
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 02 · 采集条件 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.settings, 20)}</div>
        <div class="section-header-copy">
          <span>02 · 采集条件</span>
          <h2>相关度与更新</h2>
          <p>阈值与执行频率</p>
        </div>
      </div>
      <div class="section-body">
        <div class="config-grid" style="padding:0">
          <div class="config-field">
            <label class="field-label">相关度阈值${fieldHint('相关度得分 ≥ 该值的记录会被标记「⚠ 提醒」并进入待办提醒。得分来自标题命中关键词、范围/标签命中、ICS/CCS 白名单命中（0-100，默认 80）。')}</label>            <div class="input-with-suffix">
              <input type="number" id="collectionThreshold" value="80" min="0" max="100" />
              <span class="input-suffix">分</span>
            </div>
            <div class="field-hint-inline">范围 0-100，默认 80</div>
          </div>
          <div class="config-field">
            <label class="field-label">更新频率</label>
            <select id="collectionFrequency">
              <option value="manual">手动（本迭代）</option>
              <option value="daily">每日（预留定时）</option>
              <option value="weekly">每周（预留定时）</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- 03 · 执行与历史 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.play, 20)}</div>
        <div class="section-header-copy">
          <span>03 · 执行与历史</span>
          <h2>运行采集与配置管理</h2>
          <p>提交采集任务 · 保存与复用配置</p>
        </div>
      </div>
      <div class="section-body">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="collectionStart" style="min-height:46px;padding:11px 26px;font-size:14px">
            <span class="loading-spinner" style="display:none" aria-hidden="true"></span>
            ${svgIcon(ICON_PATHS.play, 16)}<span class="btn-text">开始采集</span>
          </button>
          <span class="server-status" id="collectionServerStatus">检测服务连接…</span>
        </div>

        <div class="config-history-panel">
          <div class="config-history-panel-head">
            <b>配置历史</b>
            <span>点击条目加载 · × 删除 · 保存时内联命名</span>
          </div>
          <div class="history-list" id="collectionHistoryList"></div>
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
            <select id="collectionHistory" aria-label="配置历史列表" style="min-width:220px;min-height:38px;padding:7px 10px;background:#f9fbfb;color:var(--navy-950);border:1px solid var(--slate-300);border-radius:8px;font-size:12px"></select>
            <span class="history-chip-inline-save">
              <input type="text" id="collectionSaveName" placeholder="命名本次配置…" aria-label="配置名称" />
              <button type="button" id="collectionSave">${svgIcon(ICON_PATHS.save, 13)} 保存</button>
            </span>
            <button type="button" class="btn btn-secondary" id="collectionLoad">${svgIcon(ICON_PATHS.folderOpen, 14)} 加载选中</button>
            <button type="button" class="btn btn-danger" id="collectionDelete">${svgIcon(ICON_PATHS.trash, 14)} 删除选中</button>
          </div>
        </div>
      </div>
    </div>

    <div id="collectionProgress"></div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.database, 16)} 采集结果</h3>
      <div id="collectionDegraded" class="module-degraded" style="display:none">
        <strong>${svgIcon(ICON_PATHS.warn, 15)} 采集模块后端尚未就绪：</strong>当前服务未返回采集管线结果。请确认后端
        <code>capability-registry.mjs</code> + <code>collection-pipeline.mjs</code> 已就绪。
      </div>
      <div id="collectionResults" class="collection-results">
        <div class="results-placeholder" id="collectionPlaceholder">
          <div style="text-align:center">
            <div class="placeholder-icon">${svgIcon(ICON_PATHS.folderTree, 24)}</div>
            <div style="font-size:16px;color:var(--slate-500)">尚未开始采集</div>
            <div style="font-size:14px;color:var(--slate-600);margin-top:6px">配置关键词与数据源后点击「开始采集」</div>
          </div>
        </div>
        <div id="collectionStatsRow" class="collection-stats" style="display:none">
          <span class="filter-tag">本次新增 <b id="collectionStatsNew">0</b> 条</span>
          <span class="filter-tag">数据源 <b id="collectionStatsSource">—</b></span>
          <span class="filter-tag">LLM 耗时 <b id="collectionStatsLlm">—</b></span>
          <span class="filter-tag">任务时间 <b id="collectionStatsTime">—</b></span>
        </div>
        <div style="overflow-x:auto">
          <table class="standards-table collection-table">
            <thead>
              <tr>
                <th>标准号</th>
                <th>标题</th>
                <th>文号</th>
                <th>发文机关</th>
                <th>发布日期</th>
                <th>摘要/标签</th>
                <th>相关度</th>
              </tr>
            </thead>
            <tbody id="collectionTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.fileText, 16)} 采集日志</h3>
      <div class="progress-log" id="collectionLog" style="max-height:260px"></div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.send, 16)} 审批后推送邮箱</h3>
      <div class="push-bar">
        <button type="button" class="btn btn-primary" id="collectionPushBtn" disabled>${svgIcon(ICON_PATHS.checkCircle, 15)} 审批通过并推送邮箱</button>
        <a href="/mail-test" class="mail-link">${svgIcon(ICON_PATHS.mail, 13)} 收件人管理</a>
        <span class="server-status" id="collectionPushStatus"></span>
      </div>
      <div id="collectionPushInfo" class="push-info">
        尚未生成结果：运行采集后在此完成「审批 → 推送邮箱」（管理验证码会话 + 收件人白名单 + 发送限频）。
      </div>
    </div>`
}

function renderItems(container, items) {
  const tbody = container.querySelector('#collectionTableBody')
  if (!items || items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--slate-500);padding:24px">未采集到符合条件的结果</td></tr>'
    return
  }
  tbody.innerHTML = items.map((item) => {
    const relevance = Number(item.relevance?.score ?? item.relevanceScore ?? item.relevance ?? 0)
    const warning = relevance > 0 && relevance < 80
    return `
      <tr>
        <td><a href="${item.url || '#'}" target="_blank" rel="noopener" style="color:#818cf8;text-decoration:none">${item.standardNo || '—'}</a></td>
        <td style="min-width:220px">
          <div>${item.url ? `<a href="${item.url}" target="_blank" rel="noopener" style="color:var(--navy-950);text-decoration:none">${item.title || '—'}</a>` : (item.title || '—')}</div>
          ${item.scope ? `<div style="font-size:12px;color:var(--slate-500);margin-top:4px;max-width:420px">${item.scope}</div>` : ''}
        </td>
        <td>${item.issueAnnouncementNo || item.docNo || '—'}</td>
        <td>${item.issuer || item.issuingAuthority || '—'}</td>
        <td>${item.publishedAt || item.date || '—'}</td>
        <td>
          <div class="tag-list">${(item.tags || item.techAreas || []).map((tag) => `<span class="tag-chip">${tag}</span>`).join('') || '—'}</div>
        </td>
        <td>${relevance ? `<span class="relevance-badge ${warning ? 'relevance-warn' : 'relevance-ok'}">${Math.round(relevance)}${warning ? ` ${svgIcon(ICON_PATHS.warn, 12)}` : ''}</span>` : '—'}</td>
      </tr>`
  }).join('')
}

function renderLog(container, logs) {
  const logEl = container.querySelector('#collectionLog')
  logEl.innerHTML = logs.map((entry) => `
    <div><span class="log-time">${entry.time}</span><span class="log-stage">${entry.stage}</span>${entry.message}</div>`).join('')
  logEl.scrollTop = logEl.scrollHeight
}

function buildConfig(container) {
  return {
    keywords: String(container._chipInputs?.collectionKeywords?.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    types: [...container.querySelectorAll('#collectionTypes input:checked')].map((input) => input.value),
    relevanceThreshold: Number(container.querySelector('#collectionThreshold').value) || 80,
    frequency: container.querySelector('#collectionFrequency').value,
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
  container.querySelector('#collectionKeywords').appendChild(keywordInput)
  const keywordChip = new ChipInput(container.querySelector('#collectionKeywords'), keywordInput)
  keywordChip.setValues(['冰箱', '保鲜', '食品保鲜'])
  container._chipInputs = { ...(container._chipInputs || {}), collectionKeywords: keywordChip }

  const pushBar = wirePushBar({
    container,
    moduleId: 'collection',
    button: '#collectionPushBtn',
    status: '#collectionPushStatus',
    info: '#collectionPushInfo',
    ui,
  })

  // 配置历史（localStorage key=collection；保存走内联命名输入，见 .config-history-panel）
  const history = new ui.ConfigHistory('collection', { selectId: 'collectionHistory' })
  history.setSaveMode('inline')

  // 历史胶囊列表（点击加载 / × 删除，与 #collectionHistory 下拉双向同步）
  function renderHistoryPanel() {
    const list = container.querySelector('#collectionHistoryList')
    if (!list) return
    const items = history.history || []
    const current = String(history.select?.value ?? '')
    list.innerHTML = items.length
      ? items.map((item, index) => `
          <span class="history-chip ${String(index) === current ? 'selected' : ''}" data-history-index="${index}" role="button" tabindex="0" title="点击加载「${ui.esc(item.name || '未命名')}」"
                ${String(index) === current ? 'style="border-color:var(--teal-600);box-shadow:0 0 0 2px rgba(13,148,136,.12)"' : ''}>
            <span class="history-chip-name">${ui.esc(item.name || '未命名')}</span>
            <span class="history-chip-date">${ui.formatLocalDate(item.savedAt)}</span>
            <button type="button" class="history-chip-del" data-history-del="${index}" title="删除配置" aria-label="删除配置">${svgIcon(ICON_PATHS.close, 12)}</button>
          </span>`).join('')
      : '<span class="history-empty-tip">暂无配置历史：命名后点击「保存」，即可在此快速加载 / 删除</span>'
  }

  function renderHistorySelect() {
    history.renderSelect()
    renderHistoryPanel()
  }

  // 胶囊多选视觉同步：checkbox 隐藏但保留 value / checked（buildConfig 的 input:checked 查询继续工作）
  function syncPillState() {
    ;[...container.querySelectorAll('#collectionTypes .pill-option')].forEach((pill) => {
      const input = pill.querySelector('input')
      pill.classList.toggle('selected', !!input?.checked)
    })
  }

  const applyConfig = (config) => {
    if (!config) return
    keywordChip.setValues(config.keywords || [])
    ;[...container.querySelectorAll('#collectionTypes input[type="checkbox"]')].forEach((input) => {
      input.checked = (config.types || []).includes(input.value)
    })
    syncPillState()
    if (config.relevanceThreshold) container.querySelector('#collectionThreshold').value = config.relevanceThreshold
    if (config.frequency) container.querySelector('#collectionFrequency').value = config.frequency
  }

  // 主按钮运行中状态：loading-spinner + 禁用 + 文案
  function setRunning(running) {
    const btn = container.querySelector('#collectionStart')
    btn.disabled = running
    const spinner = btn.querySelector('.loading-spinner')
    const label = btn.querySelector('.btn-text')
    if (spinner) spinner.style.display = running ? 'inline-block' : 'none'
    if (label) label.textContent = running ? '采集中…' : '开始采集'
  }

  function saveConfig() {
    const nameEl = container.querySelector('#collectionSaveName')
    const name = String(nameEl?.value || '').trim()
    if (!name) return ui.showToast('请先填写配置名称', 'warn')
    history.add(buildConfig(container), name)
    renderHistorySelect()
    if (nameEl) nameEl.value = ''
    ui.showToast('配置已保存到历史', 'success')
  }

  function loadConfig() {
    const config = history.selected()
    if (!config) return ui.showToast('请先选择一条配置历史', 'warn')
    applyConfig(config)
    renderHistorySelect()
    ui.showToast(`已加载配置：${config.name}`, 'success')
  }

  function deleteConfig() {
    const config = history.selected()
    if (!config) return ui.showToast('请先选择要删除的配置', 'warn')
    if (!confirm(`确定删除配置「${config.name}」？`)) return
    if (history.removeSelected()) {
      renderHistorySelect()
      ui.showToast('配置已删除', 'success')
    }
  }

  container.querySelector('#collectionStart').addEventListener('click', async () => {
    const config = buildConfig(container)
    if (!config.keywords.length) return ui.showToast('请至少填写一个关键词', 'error')
    if (!config.types.length) return ui.showToast('请至少选择一种数据源', 'error')
    if (location.protocol === 'file:') {
      ui.showToast('静态模式：请运行 node std-crawler/serve-demo.mjs 后访问 http://127.0.0.1:5277', 'warn')
      return
    }
    history.persistLast(config)

    const progress = new ui.ProgressPanel(container.querySelector('#collectionProgress'), { title: '采集中（真实爬取 + LLM 提取）' })
    progress.show()
    progress.clearLogs()
    progress.setProgress(2)
    progress.appendLog({ time: new Date().toISOString(), stage: '任务创建', message: `关键词「${config.keywords.join(' / ')}」数据源「${config.types.join(' / ')}」阈值 ${config.relevanceThreshold}` })

    setRunning(true)
    try {
      const { jobId } = await api.createJob('collection', config)
      const result = await api.pollJob(jobId, {
        onLog: (entry) => {
          progress.appendLog(entry)
          progress.setProgress(entry.stage === 'LLM 提取' ? 90 : 70)
        },
      })
      progress.setTitle('采集完成')
      progress.setProgress(100)
      setRunning(false)

      const items = result.items || []
      const log = result.log || {}
      const stats = result.stats || {}
      container.querySelector('#collectionPlaceholder').classList.add('hidden')
      container.querySelector('#collectionDegraded').style.display = items.length ? 'none' : 'block'
      renderItems(container, items)
      const logEntries = [...(jobId ? [] : [])]
      renderLog(container, [
        ...logEntries,
        { time: log.taskTime || new Date().toISOString(), stage: '完成', message: `采集任务完成：${items.length} 条（LLM 成功 ${log.llmOk ?? '—'}）` },
      ])
      const statsRow = container.querySelector('#collectionStatsRow')
      statsRow.style.display = 'flex'
      container.querySelector('#collectionStatsNew').textContent = stats.total ?? items.length
      container.querySelector('#collectionStatsSource').textContent = Array.isArray(log.sources) ? log.sources.join('、') : 'std.samr.gov.cn'
      container.querySelector('#collectionStatsLlm').textContent = log.llmDurationMs != null ? `${(Number(log.llmDurationMs) / 1000).toFixed(1)}s` : '—'
      container.querySelector('#collectionStatsTime').textContent = ui.formatLocalDateTime(log.taskTime)
      if (pushBar) pushBar.refresh()
      ui.showToast(`采集完成：${items.length} 条结果`, 'success')
    } catch (error) {
      setRunning(false)
      progress.setTitle('采集失败')
      progress.appendLog({ time: new Date().toISOString(), stage: '错误', message: error.message })
      container.querySelector('#collectionDegraded').style.display = 'block'
      ui.showToast('采集失败：' + error.message, 'error')
    }
  })

  container.querySelector('#collectionSave').addEventListener('click', saveConfig)
  container.querySelector('#collectionSaveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveConfig() })
  container.querySelector('#collectionLoad').addEventListener('click', loadConfig)
  container.querySelector('#collectionDelete').addEventListener('click', deleteConfig)

  // 胶囊多选视觉同步（checkbox 仍真实存在，change 由 label 包裹触发）
  container.querySelector('#collectionTypes').addEventListener('change', syncPillState)

  // 历史胶囊：点击加载 / × 删除（事件委托，兼容动态渲染）
  container.querySelector('#collectionHistoryList').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-history-del]')
    if (delBtn) {
      container.querySelector('#collectionHistory').value = delBtn.dataset.historyDel
      deleteConfig()
      return
    }
    const chip = e.target.closest('[data-history-index]')
    if (chip) {
      container.querySelector('#collectionHistory').value = chip.dataset.historyIndex
      loadConfig()
    }
  })
  container.querySelector('#collectionHistoryList').addEventListener('keydown', (e) => {
    const chip = e.target.closest('[data-history-index]')
    if (chip && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      container.querySelector('#collectionHistory').value = chip.dataset.historyIndex
      loadConfig()
    }
  })

  renderHistorySelect()
  applyConfig(history.loadLast())
  syncPillState()
  container.querySelector('#collectionServerStatus').textContent = '采集模块已就绪（可对接后端采集管线）'

  return {
    destroy() {
      container.innerHTML = ''
    },
  }
}
