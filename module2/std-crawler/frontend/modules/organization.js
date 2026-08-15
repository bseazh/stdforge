// 组织动态模块视图（原案例7 标委会换届专家推荐）
// 流程：标委会换届/征集委员通知采集 → 关键词过滤 → LLM 结构化提取 → 专家库匹配推荐 → 待办跟踪
// 契约：POST /api/analyze { moduleId: 'organization', config } → result = { notices, recommendations, trackings, expertPool, stats }
// 配置区已对齐 Policyanalysize 设计语言：编号区段 + lucide 风格 SVG 图标 + 胶囊多选 + 权重总和可视化
import { esc, fieldHint, ChipInput } from '../core/ui.js'
import { wirePushBar } from '../core/mail.js'

export const moduleInfo = { id: 'organization', name: '组织动态', status: 'ready' }

// lucide 风格内联 SVG 图标（对齐 Policyanalysize / collection.js / analysis.js：stroke="currentColor" fill="none"，禁止 emoji）
const svgIcon = (inner, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

const ICON_PATHS = {
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  sliders: '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  fileText: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  award: '<circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  warn: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
}

function daysUntil(dateStr) {
  if (!dateStr) return null
  const target = new Date(`${dateStr}T00:00:00Z`)
  if (Number.isNaN(target.getTime())) return null
  return Math.ceil((target.getTime() - Date.now()) / 86400000)
}

const NOTICE_TYPES = [
  { value: 'recruit', label: '征集委员', checked: true },
  { value: 'suggest', label: '征集意见公示', checked: true },
  { value: 'announcement', label: '公告', checked: false },
]

function renderTemplate() {
  return `
    <!-- 01 · 监测范围 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.building, 20)}</div>
        <div class="section-header-copy">
          <span>01 · 监测范围</span>
          <h2>标委会通知采集</h2>
          <p>定义关注的组织动态类型</p>
        </div>
        <div class="section-header-action">
          <span class="config-hint">数据源：全国专业标准化技术委员会信息公示系统 org.sacinfo.org.cn:8088/tcrm + 广东市监局（best-effort）</span>
        </div>
      </div>
      <div class="section-body">
        <div class="config-grid" style="padding:0">
          <div class="config-field">
            <label class="field-label">关注关键词<small>　逐条输入，按回车或「＋ 添加」即可，不用再写逗号</small></label>
            <div id="orgKeywords"></div>
          </div>
          <div class="config-field">
            <label class="field-label">通知类型</label>
            <div class="pill-group" id="orgTypes" role="group" aria-label="通知类型">
              ${NOTICE_TYPES.map((type) => `<label class="pill-option ${type.checked ? 'selected' : ''}"><input type="checkbox" value="${type.value}" ${type.checked ? 'checked' : ''} style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>${type.label}</span></label>`).join('')}
            </div>
          </div>
          <div class="config-field">
            <label class="field-label">截止前提醒天数${fieldHint('距截止日期 ≤ 该天数的通知进入待办提醒。示例：填 15 表示提前 15 天提醒。')}</label>
            <div class="input-with-suffix">
              <input type="number" id="orgRemindNodes" value="15" min="1" max="365" step="1" />
              <span class="input-suffix">天</span>
            </div>
            <div class="field-hint-inline">只填一个数，例如 15 表示截止前 15 天提醒</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 02 · 匹配权重 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.sliders, 20)}</div>
        <div class="section-header-copy">
          <span>02 · 匹配权重</span>
          <h2>专家推荐排序维度</h2>
          <p>四维权重总和建议为 100</p>
        </div>
      </div>
      <div class="section-body">
        <div class="config-grid" style="padding:0">
          <div class="config-field full">
            <label class="field-label">专家匹配权重（职称 / 工作年限 / 标准经历 / 专业领域）${fieldHint('四个权重决定推荐排序，建议总和为 100，数值越大表示该维度在专家匹配中越重要。')}</label>
            <div class="weight-row" id="orgWeights">
              <span>职称 <input type="number" data-weight="title" value="30" min="0" max="100" />${fieldHint('职称项权重：专家职称满足通知要求（中级/副高/正高级）得满分，不满足按 40% 计。')}</span>
              <span>年限 <input type="number" data-weight="years" value="20" min="0" max="100" />${fieldHint('年限项权重：专家工作年限达到通知要求得满分，不足按比例折算。')}</span>
              <span>标准经历 <input type="number" data-weight="stdExp" value="30" min="0" max="100" />${fieldHint('标准经历权重：主导 ≥3 项得满分，主导 2 项 92%、1 项 85%、仅参与 72%。')}</span>
              <span>专业领域 <input type="number" data-weight="field" value="20" min="0" max="100" />${fieldHint('专业领域权重：专家专业领域与通知征集范围重合度越高得分越高。')}</span>
            </div>
            <div class="field-hint-inline" style="font-weight:600" id="orgWeightSum">当前总和 100，建议为 100</div>
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
          <h2>开始采集与推荐</h2>
          <p>提交任务并实时查看进度</p>
        </div>
      </div>
      <div class="section-body">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="orgStart" style="min-height:46px;padding:11px 26px;font-size:14px">
            <span class="loading-spinner" style="display:none" aria-hidden="true"></span>
            ${svgIcon(ICON_PATHS.play, 16)}<span class="btn-text">开始采集与推荐</span>
          </button>
          <span class="server-status" id="orgServerStatus">检测服务连接…</span>
        </div>
      </div>
    </div>

    <div id="orgProgress"></div>

    <div id="orgDegraded" class="module-degraded" style="display:none">
      <strong>${svgIcon(ICON_PATHS.warn, 14)} 组织动态模块后端尚未就绪：</strong>当前服务未返回组织动态管线结果。请确认后端
      <code>capability-registry.mjs</code> + <code>organization-pipeline.mjs</code> 已就绪。
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.fileText, 16)} 标委会换届/征集委员通知</h3>
      <div class="filter-tags" style="margin-bottom:14px">
        <span class="filter-tag">通知 <b id="orgNoticeCount">0</b> 条</span>
        <span class="filter-tag">有截止日期 <b id="orgDeadlineCount">0</b></span>
        <span class="filter-tag">演示场景 <b id="orgDemoTag">—</b></span>
      </div>
      <div id="orgNoticeList"></div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.award, 16)} 专家匹配推荐（按匹配度排序）</h3>
      <div id="orgRecommendList"></div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.clock, 16)} 待办跟踪（截止前提醒）</h3>
      <div class="filter-tags" style="margin-bottom:14px">
        <span class="filter-tag">提醒节点 <b id="orgRemindTag">15/3</b> 天</span>
        <span class="filter-tag">跟踪中 <b id="orgTrackCount">0</b></span>
      </div>
      <div id="orgTrackList"></div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.send, 16)} 审批后推送邮箱</h3>
      <div class="push-bar">
        <button type="button" class="btn btn-primary" id="organizationPushBtn" disabled>${svgIcon(ICON_PATHS.checkCircle, 15)} 审批通过并推送邮箱</button>
        <a href="/mail-test" class="mail-link">${svgIcon(ICON_PATHS.mail, 13)} 收件人管理</a>
        <span class="server-status" id="organizationPushStatus"></span>
      </div>
      <div id="organizationPushInfo" class="push-info">
        尚未生成结果：运行采集与推荐后在此完成「审批 → 推送邮箱」（管理验证码会话 + 收件人白名单 + 发送限频）。
      </div>
    </div>`
}

function buildConfig(container) {
  const weights = {}
  ;[...container.querySelectorAll('#orgWeights input[data-weight]')].forEach((input) => {
    weights[input.dataset.weight] = Number(input.value) || 0
  })
  return {
    keywords: String(container._chipInputs?.orgKeywords?.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
    noticeTypes: [...container.querySelectorAll('#orgTypes input:checked')].map((input) => input.value),
    remindNodes: [Number(container.querySelector('#orgRemindNodes').value) || 15],
    matchWeights: weights,
    maxItems: 40,
    withLlm: true,
    withDemo: true,
  }
}

function renderNotices(container, notices) {
  const listEl = container.querySelector('#orgNoticeList')
  if (!notices || notices.length === 0) {
    listEl.innerHTML = '<div class="empty-tip">未采集到符合条件的标委会通知</div>'
    return
  }
  listEl.innerHTML = notices.map((notice) => {
    const days = daysUntil(notice.deadline)
    const deadlineInfo = notice.deadline
      ? `${notice.deadline}（${days === null ? '—' : days >= 0 ? `剩 ${days} 天` : `已截止 ${-days} 天`}）`
      : '—'
    const demoTag = notice.isDemo ? '<span class="badge" style="background:#fef3c7;color:#b45309">演示</span>' : ''
    return `
      <div class="alert-item">
        <div class="alert-item-head">
          <span class="alert-no">${notice.committeeCode || '—'}</span>
          <span class="alert-status">${notice.noticeType || '—'}</span>
          ${demoTag}
        </div>
        <div class="alert-item-title">
          ${notice.committeeName ? `<b>${esc(notice.committeeName)}</b><br/>` : ''}
          <a href="${notice.url || '#'}" target="_blank" rel="noopener">${esc(notice.title)}</a>
        </div>
        <div class="alert-item-meta">
          发布日期：${notice.publishedAt || '—'}　截止日期：${deadlineInfo}<br/>
          <span style="color:var(--teal-700)">专业领域：</span>${(notice.professionalAreas || []).map(esc).join('、') || '—'}　
          <span style="color:var(--teal-700)">来源：</span>${esc(notice.source)}${notice.demoSource ? `<br/><span style="color:#b45309">${esc(notice.demoSource)}</span>` : ''}
        </div>
        ${(notice.conditions || []).length ? `
          <div style="margin-top:8px;font-size:13px;color:var(--slate-600)">
            <b style="color:var(--navy-950)">委员条件：</b>
            ${notice.conditions.map((c) => `<span class="tag-chip">${esc(c)}</span>`).join(' ')}
          </div>` : ''}
        ${notice.contact ? `
          <div style="margin-top:8px;font-size:13px;color:var(--slate-500)">
            联系方式：${esc(notice.contact.person || '')} ${esc(notice.contact.phone || '')} ${esc(notice.contact.email || '')}
          </div>` : ''}
      </div>`
  }).join('')
}

function renderRecommendations(container, recommendations) {
  const listEl = container.querySelector('#orgRecommendList')
  if (!recommendations || recommendations.length === 0) {
    listEl.innerHTML = '<div class="empty-tip">暂无专家推荐结果</div>'
    return
  }
  listEl.innerHTML = recommendations.map((rec) => {
    const matches = rec.matches || []
    const rows = matches.map((m) => {
      const score = Number(m.score) || 0
      const level = score >= 85 ? 'badge-dominant' : score >= 70 ? 'badge-participate' : ''
      const breakdown = m.breakdown || {}
      return `
        <tr>
          <td style="color:#818cf8;font-weight:600">${Math.round(score)}%</td>
          <td>${esc(m.expert?.name || '—')}</td>
          <td>${esc(m.expert?.department || '—')}</td>
          <td>${esc(m.expert?.title || '—')}<div style="font-size:12px;color:var(--slate-500)">${esc(m.expert?.titleLevel || '')}</div></td>
          <td>${esc(m.expert?.professionalFields?.join('、') || '—')}</td>
          <td style="max-width:220px">${esc(m.expert?.stdExperience || '—')}</td>
          <td style="max-width:260px;font-size:13px;color:var(--slate-600)">${(m.reasons || []).map(esc).join('；')}</td>
          <td style="text-align:center"><span class="badge ${level}">${score >= 70 ? '推荐' : '备选'}</span></td>
        </tr>`
    }).join('')
    return `
      <div class="alert-item" style="margin-bottom:16px">
        <div class="alert-item-head" style="margin-bottom:10px">
          <span class="alert-status">${esc(rec.noticeTitle ? '匹配推荐' : '—')}</span>
          <span style="font-size:15px;color:var(--navy-950);font-weight:600">${esc(rec.noticeTitle)}</span>
        </div>
        <div style="overflow-x:auto">
          <table class="standards-table">
            <thead>
              <tr>
                <th>匹配度</th><th>姓名</th><th>部门</th><th>职称</th><th>专业领域</th><th>参与标准经历</th><th>匹配原因</th><th>建议</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`
  }).join('')
}

function renderTrackings(container, trackings) {
  const listEl = container.querySelector('#orgTrackList')
  if (!trackings || trackings.length === 0) {
    listEl.innerHTML = '<div class="empty-tip">暂无待办跟踪</div>'
    return
  }
  listEl.innerHTML = trackings.map((t) => {
    const days = t.daysToDeadline
    const nodes = (t.remindNodes || []).map((n) => `<span class="alert-node ${n <= 7 ? 'alert-node-7' : n <= 15 ? 'alert-node-30' : 'alert-node-90'}">提前${n}天</span>`).join(' ')
    return `
      <div class="upcoming-item">
        <div class="upcoming-days">${days === null || days === undefined ? '—' : days >= 0 ? `${days}天` : '已截止'}</div>
        <div class="upcoming-main">
          <div><b>${esc(t.committeeName || t.title || '—')}</b></div>
          <div style="font-size:13px;color:var(--slate-500);margin-top:4px">截止：${esc(t.deadline || '—')}　提醒节点：${nodes || '—'}　${t.isDemo ? '<span style="color:#b45309">演示</span>' : ''}</div>
        </div>
      </div>`
  }).join('')
}

// 生成委员推荐表（CSV/Excel 兼容导出）
function exportRecommendation(container, rec, expertPool) {
  const matches = (rec?.matches || []).map((m) => m.expert)
  const header = ['姓名', '部门', '职称', '工作年限', '专业领域', '标准经历']
  const lines = [header.join(',')]
  for (const expert of matches.length ? matches : (expertPool || [])) {
    lines.push([
      expert.name, `"${(expert.department || '').replace(/"/g, '""')}"`, `"${(expert.title || '').replace(/"/g, '""')}"`,
      expert.workYears, `"${(expert.professionalFields || []).join('、')}"`, `"${(expert.stdExperience || '').replace(/"/g, '""')}"`,
    ].join(','))
  }
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = `标委会委员推荐表-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(link.href)
  return matches.length
}

export function initModule(container, ctx) {
  const { api, ui } = ctx
  container.innerHTML = renderTemplate()

  // 关键词：单值输入 + 标签（不用逗号）
  const keywordInput = document.createElement('input')
  keywordInput.type = 'text'
  keywordInput.placeholder = '输入一个关键词后回车或点「＋ 添加」'
  container.querySelector('#orgKeywords').appendChild(keywordInput)
  const keywordChip = new ChipInput(container.querySelector('#orgKeywords'), keywordInput)
  keywordChip.setValues(['冰箱', '家电', '家用电器', '制冷'])
  container._chipInputs = { ...(container._chipInputs || {}), orgKeywords: keywordChip }

  const pushBar = wirePushBar({
    container,
    moduleId: 'organization',
    button: '#organizationPushBtn',
    status: '#organizationPushStatus',
    info: '#organizationPushInfo',
    ui,
  })

  const history = new ui.ConfigHistory('organization')
  history.renderSelect()

  // 胶囊多选视觉同步：checkbox 隐藏但保留 value / checked（buildConfig 的 input:checked 查询继续工作）
  function syncPillState() {
    ;[...container.querySelectorAll('#orgTypes .pill-option')].forEach((pill) => {
      const input = pill.querySelector('input')
      pill.classList.toggle('selected', !!input?.checked)
    })
  }

  // 权重总和实时提示：只读展示，不参与 buildConfig 收集逻辑
  function syncWeightSum() {
    const sumEl = container.querySelector('#orgWeightSum')
    if (!sumEl) return
    let sum = 0
    ;[...container.querySelectorAll('#orgWeights input[data-weight]')].forEach((input) => {
      sum += Number(input.value) || 0
    })
    sumEl.textContent = `当前总和 ${sum}${sum === 100 ? '，符合建议' : '，建议为 100'}`
    sumEl.style.color = sum === 100 ? 'var(--success)' : 'var(--warning)'
  }

  // 主按钮运行中状态：loading-spinner + 禁用 + 文案
  function setRunning(running) {
    const btn = container.querySelector('#orgStart')
    btn.disabled = running
    const spinner = btn.querySelector('.loading-spinner')
    const label = btn.querySelector('.btn-text')
    if (spinner) spinner.style.display = running ? 'inline-block' : 'none'
    if (label) label.textContent = running ? '采集中…' : '开始采集与推荐'
  }

  const applyConfig = (config) => {
    if (!config) return
    keywordChip.setValues(config.keywords || [])
    ;[...container.querySelectorAll('#orgTypes input[type="checkbox"]')].forEach((input) => {
      input.checked = (config.noticeTypes || []).includes(input.value)
    })
    syncPillState()
    if (Array.isArray(config.remindNodes) && config.remindNodes.length) {
      container.querySelector('#orgRemindNodes').value = config.remindNodes[0]
    }
    if (config.matchWeights) {
      ;[...container.querySelectorAll('#orgWeights input[data-weight]')].forEach((input) => {
        if (config.matchWeights[input.dataset.weight] !== undefined) {
          input.value = config.matchWeights[input.dataset.weight]
        }
      })
    }
    syncWeightSum()
  }

  container.querySelector('#orgStart').addEventListener('click', async () => {
    const config = buildConfig(container)
    if (!config.keywords.length) return ui.showToast('请至少填写一个关键词', 'error')
    if (!config.noticeTypes.length) return ui.showToast('请至少选择一种通知类型', 'error')
    if (location.protocol === 'file:') {
      ui.showToast('静态模式：请运行 node std-crawler/serve-demo.mjs 后访问 http://127.0.0.1:5277', 'warn')
      return
    }
    history.persistLast(config)
    container.querySelector('#orgRemindTag').textContent = config.remindNodes.join('/')

    const progress = new ui.ProgressPanel(container.querySelector('#orgProgress'), { title: '采集中（标委会通知 + 专家匹配）' })
    progress.show()
    progress.clearLogs()
    progress.setProgress(2)
    progress.appendLog({ time: new Date().toISOString(), stage: '任务创建', message: `关键词「${config.keywords.join(' / ')}」提醒 ${config.remindNodes.join('/')} 天` })

    setRunning(true)
    try {
      const { jobId } = await api.createJob('organization', config)
      const result = await api.pollJob(jobId, {
        onLog: (entry) => {
          progress.appendLog(entry)
          progress.setProgress(entry.stage === 'LLM 提取' ? 90 : 70)
        },
      })
      progress.setTitle('采集与推荐完成')
      progress.setProgress(100)
      setRunning(false)

      const notices = result.notices || []
      const recommendations = result.recommendations || []
      const trackings = result.trackings || []
      const stats = result.stats || {}
      container.querySelector('#orgDegraded').style.display = notices.length ? 'none' : 'block'
      container.querySelector('#orgNoticeCount').textContent = stats.noticeCount ?? notices.length
      container.querySelector('#orgDeadlineCount').textContent = stats.deadlineCount ?? notices.filter((n) => n.deadline).length
      container.querySelector('#orgDemoTag').textContent = stats.demoUsed ? '已注入' : '实时数据'
      container.querySelector('#orgTrackCount').textContent = trackings.length
      renderNotices(container, notices)
      renderRecommendations(container, recommendations)
      renderTrackings(container, trackings)
      if (pushBar) pushBar.refresh()

      // 导出按钮（每个推荐通知行内）
      recommendations.forEach((rec, index) => {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'btn btn-secondary'
        btn.style.cssText = 'margin:8px 0 4px;font-size:12px;padding:6px 12px'
        btn.innerHTML = `${svgIcon(ICON_PATHS.download, 14)} 导出委员推荐表(CSV)`
        btn.addEventListener('click', () => {
          const count = exportRecommendation(container, rec, result.expertPool)
          ui.showToast(`委员推荐表已导出（${count} 位专家）`, 'success')
        })
        const recItems = container.querySelectorAll('#orgRecommendList .alert-item')
        if (recItems[index]) {
          const head = recItems[index].querySelector('.alert-item-head')
          head.appendChild(btn)
        }
      })

      ui.showToast(`采集完成：${notices.length} 条通知、${trackings.length} 条待办跟踪`, 'success')
    } catch (error) {
      setRunning(false)
      progress.setTitle('采集失败')
      progress.appendLog({ time: new Date().toISOString(), stage: '错误', message: error.message })
      container.querySelector('#orgDegraded').style.display = 'block'
      ui.showToast('采集失败：' + error.message, 'error')
    }
  })

  // 权重输入实时刷新总和提示（只读展示，不影响 buildConfig/applyConfig）
  container.querySelector('#orgWeights').addEventListener('input', syncWeightSum)
  // 胶囊多选视觉同步（checkbox 仍真实存在，change 由 label 包裹触发）
  container.querySelector('#orgTypes').addEventListener('change', syncPillState)

  applyConfig(history.loadLast())
  container.querySelector('#orgServerStatus').textContent = '组织动态模块已就绪（标委会换届专家推荐）'

  return {
    destroy() {
      container.innerHTML = ''
    },
  }
}
