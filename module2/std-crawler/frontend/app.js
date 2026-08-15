// 平台壳入口：功能切换 + 模块懒加载 + 状态保留
// 各业务模块遵循契约：export moduleInfo + initModule(container, ctx) → { destroy(), onShow?() }
import * as api from './core/api.js'
import * as ui from './core/ui.js'

// lucide 风格内联 SVG 图标（stroke="currentColor" stroke-width="2" fill="none"）
const svgIcon = (inner) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

const MODULE_ICONS = {
  case56: svgIcon('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>'),
  collection: svgIcon('<path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z"/><path d="M3 5a2 2 0 0 0 2 2h3"/><path d="M3 3v13a2 2 0 0 0 2 2h3"/>'),
  alert: svgIcon('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'),
  analysis: svgIcon('<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>'),
  organization: svgIcon('<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>'),
}

const MODULES = [
  { id: 'case56', name: '每日采集预警', subtitle: '合并采集与预警 · 默认最近一天', icon: MODULE_ICONS.case56, lazy: () => import('./modules/case56.js') },
  { id: 'collection', name: '标准采集', subtitle: '采集标准 / 政策公告', icon: MODULE_ICONS.collection, lazy: () => import('./modules/collection.js') },
  { id: 'alert', name: '标准预警', subtitle: '新国标发布预警', icon: MODULE_ICONS.alert, lazy: () => import('./modules/alert.js') },
  { id: 'analysis', name: '竞争分析', subtitle: '标准竞争分析', icon: MODULE_ICONS.analysis, lazy: () => import('./modules/analysis.js') },
  { id: 'organization', name: '组织动态', subtitle: '标委会专家推荐', icon: MODULE_ICONS.organization, lazy: () => import('./modules/organization.js') },
]

const queryParams = new URLSearchParams(location.search)
const appRoot = document.getElementById('appRoot')
const tabBar = document.getElementById('moduleTabs')
const staticNotice = document.getElementById('staticNotice')
const serverStatusEl = document.getElementById('serverStatus')

const instances = new Map() // moduleId → { panel, instance }
let activeModuleId = null
let healthModules = null

const ctx = {
  api,
  ui,
  echarts: typeof window.echarts !== 'undefined' ? window.echarts : undefined,
  queryParams,
}

const TAB_STATUS_LABEL = {
  'not-implemented': '占位',
  ready: '就绪',
  degraded: '降级',
  error: '异常',
}

function renderTabs(modules) {
  tabBar.innerHTML = modules.map((module) => `
    <button type="button" class="module-tab" data-module="${module.id}" data-status="${module.status || 'ready'}">
      <span class="tab-icon">${module.icon}</span>
      <span class="module-tab-copy">
        <span class="module-tab-name">${module.name}</span>
        <span class="module-tab-sub">${module.subtitle || ''}</span>
      </span>
      <span class="tab-badge ${module.status === 'not-implemented' ? 'badge-wip' : ''}">${TAB_STATUS_LABEL[module.status || 'ready'] || ''}</span>
    </button>`).join('')
  ;[...tabBar.querySelectorAll('.module-tab')].forEach((button) => {
    button.addEventListener('click', () => switchModule(button.dataset.module))
  })
}

function updateTabStatuses(modules) {
  for (const module of modules) {
    const button = tabBar.querySelector(`.module-tab[data-module="${module.id}"]`)
    if (!button) continue
    button.dataset.status = module.status || 'ready'
    const badge = button.querySelector('.tab-badge')
    if (badge) {
      badge.textContent = TAB_STATUS_LABEL[module.status || 'ready'] || ''
      badge.classList.toggle('badge-wip', module.status === 'not-implemented')
    }
  }
}

function updateServerStatus(message, ok) {
  serverStatusEl.textContent = message
  serverStatusEl.className = ok ? 'server-badge ok' : 'server-badge'
}

function applyHealth(health) {
  healthModules = health.modules || null
  if (healthModules && healthModules.length) {
    updateTabStatuses(healthModules)
  }
  updateServerStatus(`✓ 服务已连接（${healthModules?.length || 5} 个模块 · LLM ${health.llmConfigured ? '已启用' : '未配置'} · SMTP ${health.smtpConfigured ? '已配置' : '未配置'}）`, true)
}

function switchModule(moduleId) {
  const target = MODULES.find((module) => module.id === moduleId)
  if (!target) return
  if (activeModuleId === moduleId) return

  const previous = instances.get(activeModuleId)
  if (previous) previous.panel.hidden = true

  let entry = instances.get(moduleId)
  const finishSwitch = () => {
    entry.panel.hidden = false
    if (typeof entry.instance?.onShow === 'function') entry.instance.onShow()
    activeModuleId = moduleId
    ;[...tabBar.querySelectorAll('.module-tab')].forEach((button) => {
      button.classList.toggle('active', button.dataset.module === moduleId)
    })
    window.dispatchEvent(new Event('resize'))
  }

  if (entry) {
    finishSwitch()
    return
  }

  entry = { panel: null, instance: null }
  instances.set(moduleId, entry)
  entry.panel = document.createElement('div')
  entry.panel.className = 'module-panel'
  entry.panel.dataset.module = moduleId
  entry.panel.hidden = true
  appRoot.appendChild(entry.panel)

  target.lazy()
    .then((module) => {
      entry.instance = module.initModule(entry.panel, {
        ...ctx,
        moduleInfo: module.moduleInfo,
        status: healthModules?.find((item) => item.id === moduleId)?.status || 'ready',
      })
      finishSwitch()
    })
    .catch((error) => {
      console.error(`模块「${target.name}」加载失败:`, error)
      entry.panel.innerHTML = `
        <div class="module-error">
          <div class="module-error-icon">${svgIcon('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>')}</div>
          <div class="module-error-title">模块「${target.name}」加载失败</div>
          <div class="module-error-msg">${String(error?.message || error)}</div>
        </div>`
      entry.panel.hidden = false
      activeModuleId = moduleId
      ;[...tabBar.querySelectorAll('.module-tab')].forEach((button) => {
        button.classList.toggle('active', button.dataset.module === moduleId)
      })
    })
}

// 初始渲染：health 就绪前先按默认注册表渲染，health 返回后刷新状态徽标
renderTabs(MODULES)
updateServerStatus('检测服务连接…', false)

if (location.protocol === 'file:') {
  staticNotice.style.display = 'block'
  updateServerStatus('静态模式', false)
  switchModule('analysis')
} else {
  api.fetchHealth()
    .then((health) => {
      staticNotice.style.display = 'none'
      applyHealth(health)
      if (!activeModuleId) switchModule('analysis')
    })
    .catch(() => {
      staticNotice.style.display = 'block'
      updateServerStatus('✗ 未连接服务（功能切换可用，业务调用将提示）', false)
      if (!activeModuleId) switchModule('analysis')
    })
}
