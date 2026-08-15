// 前端公共核心：共享 UI 组件（toast/进度/配置历史/弹窗/格式化/调试面板）
// 设计语言对齐 Policyanalysize：teal-100 胶囊 chip、navy-900 深底 tooltip/toast、
// teal→sky 渐变进度条、lucide 风格 SVG 图标（禁止 emoji）

// lucide 风格内联 SVG 图标
const svgIcon = (inner, size = 14) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

// 常用图标（供内部组件复用）
const ICONS = {
  plus: svgIcon('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  close: svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  warn: svgIcon('<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'),
  ok: svgIcon('<path d="M20 6 9 17l-5-5"/>'),
  debug: svgIcon('<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>'),
  exportIcon: svgIcon('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  trash: svgIcon('<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>'),
  save: svgIcon('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
  info: svgIcon('<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>'),
  load: svgIcon('<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>'),
}

export function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ---------- 单值输入 + 标签（chip）：不用再写逗号，逐个输入自动转数组 ----------
// 用法：new ChipInput(container, inputEl, { onAdd }) → .getValues() / .setValues([...]) / .value（兼容旧逻辑）
// 视觉：teal-100 胶囊 + 圆角 ×移除
export class ChipInput {
  constructor(container, inputEl, { onAdd, placeholder } = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container
    this.inputEl = typeof inputEl === 'string' ? this.container.querySelector(inputEl) : inputEl
    this.onAdd = onAdd
    this.values = []
    this.chipWrap = null
    this.wrap = document.createElement('div')
    this.wrap.className = 'chip-input'
    this.inputEl.remove()
    this.inputEl.classList.remove('chip-input')
    this.wrap.appendChild(this.inputEl)
    this.container.appendChild(this.wrap)
    if (placeholder) this.inputEl.placeholder = placeholder

    const addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.className = 'chip-add-btn'
    addBtn.innerHTML = `${ICONS.plus}添加`
    addBtn.addEventListener('click', () => this.addFromInput())
    this.wrap.appendChild(addBtn)
    this.addBtn = addBtn

    this.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ',') {
        event.preventDefault()
        this.addFromInput()
      }
    })
    this.inputEl.addEventListener('blur', () => this.addFromInput())
    this.renderChips()
  }

  addFromInput() {
    const raw = String(this.inputEl.value || '').trim()
    if (!raw) return
    this.addValue(raw)
    this.inputEl.value = ''
  }

  addValue(value) {
    const item = String(value ?? '').trim()
    if (!item) return
    if (!this.values.includes(item)) {
      this.values.push(item)
      this.renderChips()
      if (typeof this.onAdd === 'function') this.onAdd(item, this.values)
    }
  }

  removeValue(value) {
    this.values = this.values.filter((item) => item !== value)
    this.renderChips()
  }

  setValues(values) {
    this.values = (Array.isArray(values) ? values : String(values || '').split(/[,，]/))
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
    this.renderChips()
  }

  getValues() {
    return [...this.values]
  }

  get value() {
    return this.values.join(',')
  }

  set value(value) {
    this.setValues(value)
  }

  renderChips() {
    ;[...this.wrap.querySelectorAll('.chip')].forEach((chip) => chip.remove())
    this.values.forEach((value) => {
      const chip = document.createElement('span')
      chip.className = 'chip'
      const label = document.createElement('span')
      label.textContent = value
      const removeBtn = document.createElement('button')
      removeBtn.type = 'button'
      removeBtn.className = 'chip-remove'
      removeBtn.innerHTML = ICONS.close
      removeBtn.title = '移除'
      removeBtn.addEventListener('click', () => this.removeValue(value))
      chip.appendChild(label)
      chip.appendChild(removeBtn)
      this.wrap.insertBefore(chip, this.inputEl)
    })
  }
}

// ---------- 隐藏提示语（fieldHint）：标签旁的小「?」，悬停/聚焦时显示解释 ----------
let fieldHintStylesInjected = false

export function fieldHint(text) {
  if (!fieldHintStylesInjected) {
    fieldHintStylesInjected = true
    const style = document.createElement('style')
    style.textContent = `
      .field-hint-trigger {
        display: inline-flex; align-items: center; justify-content: center;
        width: 18px; height: 18px; margin-left: 6px; border-radius: 50%;
        background: var(--teal-100, #e5f6f3); border: 1px solid #b7e0da;
        color: var(--teal-700, #0f766e); font-size: 11px; font-weight: 800; line-height: 18px;
        cursor: help; position: relative; vertical-align: middle; user-select: none;
      }
      .field-hint-trigger::after {
        content: attr(data-tip);
        position: absolute; bottom: calc(100% + 8px); left: 50%;
        transform: translateX(-50%); width: max-content; max-width: 280px;
        background: var(--navy-900, #2c4055); border: 1px solid rgba(255, 255, 255, 0.18);
        color: #fff; font-size: 11px; line-height: 1.65; font-weight: 400;
        padding: 9px 12px; border-radius: 9px; box-shadow: 0 8px 24px rgba(15, 23, 42, 0.35);
        white-space: normal; text-align: left;
        opacity: 0; visibility: hidden; transition: opacity 0.15s ease, visibility 0.15s ease;
        z-index: 60; pointer-events: none;
      }
      .field-hint-trigger:hover::after,
      .field-hint-trigger:focus::after,
      .field-hint-trigger:focus-visible::after {
        opacity: 1; visibility: visible;
      }`
    document.head.appendChild(style)
  }
  const tip = esc(String(text ?? ''))
  return `<span class="field-hint-trigger" tabindex="0" role="tooltip" data-tip="${tip}">?</span>`
}

// 本地时区时间/日期格式化（后端日志为 UTC ISO，直接截取会显示成北京时间-8小时）
export function formatLocalTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

export function formatLocalDate(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso).slice(0, 10)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatLocalDateTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return String(iso)
  const datePart = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return `${datePart} ${formatLocalTime(iso)}`
}

// ---------- Toast 单例（navy-900 深底圆角，顶部滑入，success/warn/error 三态） ----------
let toastEl = null
let toastTimer = null

export function showToast(message, type = '') {
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.className = 'toast'
    toastEl.id = 'toast'
    document.body.appendChild(toastEl)
  }
  const icon = type === 'success' ? ICONS.ok : type === 'error' ? ICONS.warn : type === 'warn' ? ICONS.warn : ''
  toastEl.innerHTML = icon ? `${icon}<span>${esc(message)}</span>` : esc(message)
  toastEl.className = 'toast show ' + (type || '')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toastEl.className = 'toast' }, 6000)
}

// ---------- 进度面板（渐变进度条 + 阶段日志） ----------
export class ProgressPanel {
  constructor(container, { title = '任务执行中' } = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container
    this.panel = document.createElement('div')
    this.panel.className = 'progress-panel'
    this.panel.style.display = 'none'
    this.panel.innerHTML = `
      <div class="progress-head">
        <b class="progress-title">${esc(title)}</b>
        <span class="progress-percent">0%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill"></div></div>
      <div class="progress-log"></div>`
    this.container.appendChild(this.panel)
    this.titleEl = this.panel.querySelector('.progress-title')
    this.percentEl = this.panel.querySelector('.progress-percent')
    this.fillEl = this.panel.querySelector('.progress-fill')
    this.logEl = this.panel.querySelector('.progress-log')
  }

  show(title) {
    if (title) this.titleEl.textContent = title
    this.panel.style.display = 'block'
  }

  hide() {
    this.panel.style.display = 'none'
  }

  setProgress(percent) {
    const value = Math.min(100, Math.max(0, Number(percent) || 0))
    this.fillEl.style.width = value + '%'
    this.percentEl.textContent = Math.round(value) + '%'
  }

  setTitle(title) {
    this.titleEl.textContent = title
  }

  clearLogs() {
    this.logEl.innerHTML = ''
  }

  appendLog(entry) {
    const time = formatLocalTime(entry.time)
    const div = document.createElement('div')
    div.innerHTML = `<span class="log-time">${esc(time)}</span><span class="log-stage">${esc(entry.stage)}</span>${esc(entry.message)}`
    this.logEl.appendChild(div)
    this.logEl.scrollTop = this.logEl.scrollHeight
  }

  get logCount() {
    return this.logEl.querySelectorAll('div').length
  }
}

// ---------- 配置历史（localStorage，key 按模块 ID 隔离） ----------
export class ConfigHistory {
  constructor(moduleId, { selectId } = {}) {
    this.moduleId = moduleId
    this.HISTORY_KEY = `${moduleId}-config-history`
    this.LAST_CONFIG_KEY = `${moduleId}-last-config`
    this.history = []
    this.select = document.getElementById(selectId || `${moduleId}History`)
    this.saveMode = 'select' // 'select' | 'inline'
    this.load()
  }

  load() {
    try {
      this.history = JSON.parse(localStorage.getItem(this.HISTORY_KEY) || '[]')
    } catch {
      this.history = []
    }
    if (!Array.isArray(this.history)) this.history = []
  }

  save() {
    localStorage.setItem(this.HISTORY_KEY, JSON.stringify(this.history))
  }

  // 增强样式：空态占位 + 选中项高亮；结构保持 <option> 不变（模块 JS 依赖 value=index）
  renderSelect() {
    if (!this.select) return
    this.select.innerHTML = this.history.length
      ? this.history.map((item, index) => `<option value="${index}">${esc(item.name || '未命名')}（${formatLocalDate(item.savedAt)}）</option>`).join('')
      : '<option value="">（暂无配置历史）</option>'
    if (this.select.classList) this.select.classList.add('config-history-select')
  }

  // 保存模式辅助：'select' 为原生下拉（默认，模块 JS 用 prompt 命名）；
  // 'inline' 提示调用方使用内联命名保存面板（见 .config-history-panel 样式）
  setSaveMode(mode = 'select') {
    this.saveMode = mode
    return this
  }

  add(config, name) {
    const safeName = (name || '').trim() || `配置-${new Date().toLocaleDateString('zh-CN')}`
    const item = { ...config, name: safeName, savedAt: new Date().toISOString() }
    this.history.push(item)
    this.save()
    this.renderSelect()
    if (this.select) this.select.value = String(this.history.length - 1)
    return item
  }

  selected() {
    if (!this.select) return null
    return this.history[Number(this.select.value)] || null
  }

  removeSelected() {
    const index = Number(this.select?.value)
    if (!this.history[index]) return false
    this.history.splice(index, 1)
    this.save()
    this.renderSelect()
    return true
  }

  persistLast(config) {
    try { localStorage.setItem(this.LAST_CONFIG_KEY, JSON.stringify(config)) } catch { /* 忽略存储异常 */ }
  }

  loadLast() {
    try { return JSON.parse(localStorage.getItem(this.LAST_CONFIG_KEY) || 'null') } catch { return null }
  }
}

// ---------- 通用弹窗（对齐 Policyanalysize modal：slate-100 头部 + 圆角关闭） ----------
export class Modal {
  constructor({ title = '' } = {}) {
    this.el = document.createElement('div')
    this.el.className = 'drill-modal'
    this.el.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title">${esc(title)}</h3>
          <button type="button" class="modal-close" aria-label="关闭">${ICONS.close}</button>
        </div>
        <div class="modal-body"></div>
      </div>`
    this.titleEl = this.el.querySelector('.modal-title')
    this.bodyEl = this.el.querySelector('.modal-body')
    this.closeBtn = this.el.querySelector('.modal-close')
    this.closeBtn.addEventListener('click', () => this.close())
    this.el.addEventListener('click', (event) => {
      if (event.target === this.el) this.close()
    })
  }

  mount(container) {
    ;(typeof container === 'string' ? document.getElementById(container) : container).appendChild(this.el)
  }

  open(title, contentHtml) {
    if (title) this.titleEl.textContent = title
    if (typeof contentHtml === 'string') this.bodyEl.innerHTML = contentHtml
    this.el.classList.add('active')
  }

  close() {
    this.el.classList.remove('active')
  }
}

// ---------- 调试面板 ----------
export class DebugPanel {
  constructor(container, { exportName = 'debug-log' } = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container
    this.exportName = exportName
    this.lastDebug = null
    this.panel = document.createElement('div')
    this.panel.className = 'debug-panel'
    this.panel.style.display = 'none'
    this.panel.innerHTML = `
      <div class="debug-head">
        <b>${ICONS.debug} 调试信息（全过程诊断）</b>
        <button type="button" class="btn btn-secondary">${ICONS.exportIcon} 导出调试日志(JSON)</button>
      </div>
      <div class="debug-content"></div>`
    this.container.appendChild(this.panel)
    this.contentEl = this.panel.querySelector('.debug-content')
    this.panel.querySelector('button').addEventListener('click', () => this.export())
  }

  show(debug, fallbackNote) {
    this.panel.style.display = 'block'
    this.lastDebug = { debug, fallbackNote }
    if (!debug || !debug.enabled) {
      this.contentEl.innerHTML = `<div class="debug-section">${esc(fallbackNote || '后端未返回调试信息：请确认已勾选「调试模式」并重新执行；任务失败时请查看服务端控制台输出。')}</div>`
      return
    }
    const table = (rows) => rows && rows.length
      ? `<table><thead><tr>${Object.keys(rows[0]).map((key) => `<th>${esc(key)}</th>`).join('')}</tr></thead><tbody>${
          rows.map((row) => `<tr>${Object.values(row).map((value) => `<td>${esc(Array.isArray(value) ? value.join('、') : String(value ?? ''))}</td>`).join('')}</tr>`).join('')
        }</tbody></table>`
      : '<div style="padding:6px 0;color:#64748b">无</div>'
    const warnings = debug.warnings && debug.warnings.length
      ? `<div class="debug-warn">${ICONS.warn} ${debug.warnings.map(esc).join('<br/>')}</div>`
      : `<div style="color:#059669">${ICONS.ok} 无警告</div>`
    const timings = Object.entries(debug.timings || {})
      .map(([name, ms]) => `${name}: ${(ms / 1000).toFixed(1)}s`)
      .join('　')
    this.contentEl.innerHTML = `
      <div class="debug-section"><details open><summary>概览与阶段耗时</summary>
        <div style="padding:8px 0;color:#64748b">阶段耗时：${esc(timings)}</div>
        ${warnings}
      </details></div>
      <div class="debug-section"><details><summary>检索命中（${(debug.search || []).length} 项）</summary>${table(debug.search)}</details></div>
      <div class="debug-section"><details><summary>领域过滤（保留 ${debug.filter?.kept} / 共 ${debug.filter?.total}，丢弃 ${(debug.filter?.dropped || []).length} 条并附原因）</summary>${table(debug.filter?.dropped)}</details></div>
      <div class="debug-section"><details><summary>行业标准起草单位补抓 hbba（${(debug.hbba || []).length} 条）</summary>${table(debug.hbba)}</details></div>
      <div class="debug-section"><details><summary>详情页补抓（${(debug.hydrate || []).length} 条，含状态/错误/键值数）</summary>${table(debug.hydrate)}</details></div>
      <div class="debug-section"><details><summary>LLM 结构化提取（${(debug.llm || []).length} 条，含状态/错误/标签/置信度）</summary>${table(debug.llm)}</details></div>
      <div class="debug-section"><details><summary>计划↔发布合并（${debug.merge?.before} → ${debug.merge?.after}）</summary><div style="padding:6px 0;color:#64748b">同标准号去重，优先保留已发布版</div></details></div>
      <div class="debug-section"><details><summary>原始调试 JSON</summary><pre>${esc(JSON.stringify(debug, null, 2))}</pre></details></div>`
  }

  hide() {
    this.panel.style.display = 'none'
  }

  get visible() {
    return this.panel.style.display === 'block'
  }

  export() {
    if (!this.lastDebug) {
      showToast('暂无调试信息：请勾选「调试模式」并完成一次任务', 'warn')
      return
    }
    const payload = { exportedAt: new Date().toISOString(), ...this.lastDebug }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${this.exportName}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    showToast('调试日志已导出', 'success')
  }
}
