// 竞争分析模块视图（原案例8）：逻辑由 demo-app.js 原样迁移，行为不变
// 模块契约：export moduleInfo + initModule(container, ctx) → { destroy(), onShow?() }
import { fieldHint, ChipInput } from '../core/ui.js'
import { wirePushBar } from '../core/mail.js'

export const moduleInfo = { id: 'analysis', name: '竞争分析', status: 'ready' }

const DEFAULT_GROUPS = [
  { group: '海信系', keywords: '海信', region: '广东省' },
  { group: '美的', keywords: '美的', region: '广东省' },
  { group: '海尔', keywords: '海尔', region: '山东省' },
  { group: '格力', keywords: '格力', region: '广东省' },
  { group: '美菱', keywords: '美菱,华凌', region: '安徽省' },
]

const GROUP_COLORS = {
  '海信系': '#6366f1', '美的': '#10b981', '海尔': '#3b82f6', '格力': '#f59e0b', '美菱': '#ef4444',
}

const TECH_COLORS = {
  '保鲜': '#3b82f6', '无霜': '#10b981', '化霜': '#f59e0b', '微冻': '#a78bfa',
  '保湿': '#34d399', '精准控温': '#fb923c', '智能保鲜': '#818cf8', '零度保鲜': '#2dd4bf',
  '能效': '#22d3ee', '安全': '#f43f5e', '其他': '#6366f1',
}

// lucide 风格内联 SVG 图标（对齐 Policyanalysize：stroke="currentColor" fill="none" 线条图标，禁止 emoji）
const svgIcon = (inner, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`

const ICON_PATHS = {
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  snowflake: '<line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
  mapPin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  folderOpen: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  checkCircle: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  warn: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  ok: '<path d="M20 6 9 17l-5-5"/>',
}

function renderTemplate() {
  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return `
    <!-- 01 · 查询范围 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.search, 20)}</div>
        <div class="section-header-copy">
          <span>01 · 查询范围</span>
          <h2>关键词与标准范围</h2>
          <p>定义要分析的领域与技术方向</p>
        </div>
        <div class="section-header-action">
          <span class="config-hint" id="dataSourceTag">数据源：全国标准信息公共服务平台 std.samr.gov.cn（详情补抓）+ hbba.sacinfo.org.cn（行业标准起草单位）</span>
        </div>
      </div>
      <div class="section-body">
        <div class="config-grid" style="padding:0">
          <div class="config-field">
            <label class="field-label">技术领域关键词<small>　逐条输入，按回车或「＋ 添加」即可，不用再写逗号</small></label>
            <div id="cfgKeywords"></div>
          </div>
          <div class="config-field">
            <label class="field-label">标准类型</label>
            <div class="pill-group" id="cfgTypes" role="group" aria-label="标准类型">
              <label class="pill-option selected"><input type="checkbox" value="gb" checked style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>国家标准</span></label>
              <label class="pill-option selected"><input type="checkbox" value="hb" checked style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>行业标准</span></label>
              <label class="pill-option selected"><input type="checkbox" value="db" checked style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>地方标准</span></label>
              <label class="pill-option selected"><input type="checkbox" value="plan" checked style="position:absolute;opacity:0;width:0;height:0;margin:0;pointer-events:none" /><span>国家标准计划</span></label>
            </div>
          </div>
          <div class="config-field">
            <label class="field-label">发布日期范围${fieldHint('只检索「发布日期」落在该区间的标准；在审国家标准计划没有发布日期，不受此窗口限制。')}</label>
            <div class="date-preset-row" id="datePresetRow" aria-label="日期快捷预设">
              <button type="button" class="date-preset-btn" data-preset="1y">近1年</button>
              <button type="button" class="date-preset-btn" data-preset="3y">近3年</button>
              <button type="button" class="date-preset-btn selected" data-preset="5y">近5年</button>
              <button type="button" class="date-preset-btn" data-preset="custom">自定义</button>
            </div>
            <div class="date-range">
              <input type="date" id="cfgStart" value="2021-01-01" />
              <span>~</span>
              <input type="date" id="cfgEnd" value="${today}" />
            </div>
          </div>
          <div class="config-field">
            <label class="field-label">主导判定口径${fieldHint('判定企业是否「主导」起草：起草单位首位 = 第一位命中即算主导；前3位 = 前三位任一击中算主导。')}</label>
            <select id="cfgLeadingRule">
              <option value="first">起草单位首位</option>
              <option value="top3">起草单位前3位</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <!-- 02 · 分析对象 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.users, 20)}</div>
        <div class="section-header-copy">
          <span>02 · 分析对象</span>
          <h2>企业集团关联</h2>
          <p>起草单位关键词命中自动归并</p>
        </div>
      </div>
      <div class="section-body">
        <table class="group-table">
          <thead>
            <tr><th>集团名称</th><th>识别关键词（逐条添加）</th><th>注册地</th><th style="width:60px"></th></tr>
          </thead>
          <tbody id="groupTableBody"></tbody>
        </table>
        <button type="button" class="btn btn-secondary" id="addGroupBtn" style="margin-top:12px">${svgIcon(ICON_PATHS.plus, 14)} 添加集团</button>
      </div>
    </div>

    <!-- 03 · 执行与输出 -->
    <div class="config-section">
      <div class="section-header">
        <div class="section-icon">${svgIcon(ICON_PATHS.play, 20)}</div>
        <div class="section-header-copy">
          <span>03 · 执行与输出</span>
          <h2>运行与结果导出</h2>
          <p>真实爬取 + LLM 实时分析</p>
        </div>
      </div>
      <div class="section-body">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <button type="button" class="btn btn-primary" id="btnAnalyze" style="min-height:46px;padding:11px 26px;font-size:14px">
            <span class="loading-spinner" style="display:none" aria-hidden="true"></span>
            ${svgIcon(ICON_PATHS.play, 16)}<span class="btn-text">开始实时分析</span>
          </button>
          <span class="server-status" id="analysisServerStatus">检测服务连接…</span>
          <label class="debug-toggle"><input type="checkbox" id="cfgDebug" /> 调试模式</label>
        </div>

        <div class="config-history-panel">
          <div class="config-history-panel-head">
            <b>配置历史</b>
            <span>点击条目加载 · × 删除 · 保存时内联命名</span>
          </div>
          <div class="history-list" id="configHistoryList"></div>
          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px">
            <select id="cfgHistory" aria-label="配置历史列表" style="min-width:220px;min-height:38px;padding:7px 10px;background:#f9fbfb;color:var(--navy-950);border:1px solid var(--slate-300);border-radius:8px;font-size:12px"></select>
            <span class="history-chip-inline-save">
              <input type="text" id="cfgSaveName" placeholder="命名本次配置…" aria-label="配置名称" />
              <button type="button" id="cfgSave">${svgIcon(ICON_PATHS.save, 13)} 保存</button>
            </span>
            <button type="button" class="btn btn-secondary" id="cfgLoad">${svgIcon(ICON_PATHS.folderOpen, 14)} 加载选中</button>
            <button type="button" class="btn btn-danger" id="cfgDelete">${svgIcon(ICON_PATHS.trash, 14)} 删除选中</button>
          </div>
        </div>
      </div>
    </div>

    <div class="analysis-actions-row">
      <button type="button" class="btn btn-secondary" id="exportExcelBtn">${svgIcon(ICON_PATHS.download, 14)} 导出Excel</button>
      <button type="button" class="btn btn-primary" id="exportPDFBtn">${svgIcon(ICON_PATHS.printer, 14)} 导出PDF报告</button>
    </div>

    <div class="progress-panel" id="progressPanel" style="display:none">
      <div class="progress-head">
        <b id="progressTitle">实时分析中</b>
        <span id="progressPercent">0%</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
      <div class="progress-log" id="progressLogs"></div>
    </div>

    <div class="debug-panel" id="debugPanel" style="display:none">
      <div class="debug-head">
        <b>${svgIcon(ICON_PATHS.tool, 16)} 调试信息（全过程诊断）</b>
        <button type="button" class="btn btn-secondary" id="exportDebugBtn">${svgIcon(ICON_PATHS.download, 14)} 导出调试日志(JSON)</button>
      </div>
      <div id="debugContent"></div>
    </div>

    <div class="print-header">
      <h2 id="printTitle">标准竞争分析报告</h2>
      <p id="printMeta">数据来源：全国标准信息公共服务平台（真实爬取 + LLM 分析）</p>
    </div>

    <div id="resultsArea" class="results-area">
      <div class="results-placeholder" id="resultsPlaceholder">
        <div style="text-align:center">
          <div class="placeholder-icon">${svgIcon(ICON_PATHS.search, 24)}</div>
          <div style="font-size:16px;color:var(--slate-500)">尚未开始分析</div>
          <div style="font-size:14px;color:var(--slate-600);margin-top:6px">请在上方配置查询条件，点击「开始实时分析」后展示结果</div>
        </div>
      </div>
    </div>

    <div class="stats-cards">
      <div class="stat-card">
        <div class="stat-label">标准总数</div>
        <div class="stat-value" id="statTotal">0</div>
        <div class="stat-trend up"><span>${svgIcon(ICON_PATHS.book, 14)}</span> 近5年家电制冷保鲜领域</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">海信参与标准</div>
        <div class="stat-value" id="statHisense">0</div>
        <div class="stat-trend up"><span>${svgIcon(ICON_PATHS.building, 14)}</span> 含海信冰箱/容声/空调</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">保鲜技术占比</div>
        <div class="stat-value" id="statFreshness">0%</div>
        <div class="stat-trend up"><span>${svgIcon(ICON_PATHS.snowflake, 14)}</span> LLM 技术标签</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">覆盖省份</div>
        <div class="stat-value" id="statProvinces">0</div>
        <div class="stat-trend"><span>${svgIcon(ICON_PATHS.mapPin, 14)}</span> 粤鲁皖产业集群</div>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-header">
          <h3 class="chart-title">企业标准参与数量对比（含主导）</h3>
          <span style="font-size:13px;color:var(--slate-500)">${svgIcon(ICON_PATHS.search, 13)} 点击柱子查看明细</span>
        </div>
        <div id="barChart" class="chart-container"></div>
      </div>
      <div class="chart-card">
        <div class="chart-header">
          <h3 class="chart-title">技术领域分布</h3>
        </div>
        <div id="pieChart" class="chart-container"></div>
      </div>
      <div class="chart-card full-width">
        <div class="chart-header">
          <h3 class="chart-title">近5年保鲜领域标准数量趋势</h3>
        </div>
        <div id="lineChart" class="chart-container tall"></div>
      </div>
      <div class="chart-card full-width">
        <div class="chart-header">
          <h3 class="chart-title">企业地域分布热力图</h3>
        </div>
        <div id="mapChart" class="chart-container tall"></div>
      </div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.sparkles, 16)} AI智能分析结论</h3>
      <div class="analysis-content">
        <ul class="conclusion-list" id="conclusionList"></ul>
        <div class="company-detail-card">
          <div class="company-detail-title"><span>${svgIcon(ICON_PATHS.building, 16)}</span> 海信系企业明细</div>
          <div class="company-stats">
            <div class="company-stat-item">
              <div class="company-stat-value" id="companyLeading">0</div>
              <div class="company-stat-label">主导标准（首位起草）</div>
            </div>
            <div class="company-stat-item">
              <div class="company-stat-value" id="companyParticipating">0</div>
              <div class="company-stat-label">参与标准</div>
            </div>
          </div>
          <div class="company-focus">
            <strong style="color:var(--teal-700)">技术聚焦：</strong>保鲜、能效、化霜（LLM 标签）<br>
            <strong style="color:var(--teal-700)">重点企业：</strong>海信冰箱有限公司、海信容声（广东）冰箱有限公司、海信空调有限公司
          </div>
        </div>
      </div>
    </div>

    <div class="analysis-section">
      <h3 class="analysis-title">${svgIcon(ICON_PATHS.send, 16)} 审批后推送邮箱</h3>
      <div class="push-bar">
        <button type="button" class="btn btn-primary" id="analysisPushBtn" disabled>${svgIcon(ICON_PATHS.checkCircle, 15)} 审批通过并推送邮箱</button>
        <a href="/mail-test" class="mail-link">${svgIcon(ICON_PATHS.mail, 13)} 收件人管理</a>
        <span class="server-status" id="analysisPushStatus"></span>
      </div>
      <div id="analysisPushInfo" class="push-info">
        尚未生成结果：运行分析后在此完成「审批 → 推送邮箱」（管理验证码会话 + 收件人白名单 + 发送限频）。
      </div>
    </div>

    <div class="drill-modal" id="drillModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3 class="modal-title" id="modalTitle">标准明细列表</h3>
          <button class="modal-close" id="modalClose" aria-label="关闭">${svgIcon(ICON_PATHS.close, 16)}</button>
        </div>
        <div class="modal-body">
          <table class="standards-table">
            <thead>
              <tr>
                <th>标准编号</th>
                <th>标准名称</th>
                <th>技术领域</th>
                <th>发布年份</th>
                <th>角色</th>
              </tr>
            </thead>
            <tbody id="standardsTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>`
}

export function initModule(container, ctx) {
  const { api, ui, echarts, queryParams } = ctx
  const $ = (id) => container.querySelector('#' + id)

  container.innerHTML = renderTemplate()

  // 技术领域关键词：单值输入 + 标签（不用逗号）
  const keywordInput = document.createElement('input')
  keywordInput.type = 'text'
  keywordInput.placeholder = '输入一个关键词后回车或点「＋ 添加」'
  $('cfgKeywords').appendChild(keywordInput)
  const keywordChip = new ChipInput($('cfgKeywords'), keywordInput)
  keywordChip.setValues(['冰箱', '保鲜', '食品保鲜', '制冷', '家用电器', '家电'])
  container._chipInputs = { ...(container._chipInputs || {}), cfgKeywords: keywordChip }

  const pushBar = wirePushBar({
    container,
    moduleId: 'analysis',
    button: '#analysisPushBtn',
    status: '#analysisPushStatus',
    info: '#analysisPushInfo',
    ui,
  })

  let charts = {}
  let currentRows = []
  let currentMeta = { source: '', collectedAt: '' }
  let currentStats = null
  let currentGroups = DEFAULT_GROUPS.map((g) => ({ ...g }))
  let lastDebug = null
  let history
  let resizeHandler = null

  // ---------- 集团映射编辑器 ----------
  function renderGroupTable() {
    $('groupTableBody').innerHTML = currentGroups.map((g, index) => `
      <tr>
        <td><input data-group-name value="${ui.esc(g.group)}" placeholder="集团名称" /></td>
        <td><div class="group-keywords-cell" data-group-keywords-cell></div></td>
        <td><input data-group-region value="${ui.esc(g.region)}" placeholder="注册地" /></td>
        <td><button type="button" class="del-btn" data-del-index="${index}">删除</button></td>
      </tr>`).join('')
    // 每个集团行：关键词 chip（逐条添加，不用逗号）
    ;[...$('groupTableBody').querySelectorAll('[data-group-keywords-cell]')].forEach((cell, index) => {
      const input = document.createElement('input')
      input.type = 'text'
      input.placeholder = '输入关键词回车添加'
      cell.appendChild(input)
      const chip = new ChipInput(cell, input)
      chip.setValues(String(currentGroups[index]?.keywords || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean))
      cell._chip = chip
    })
    ;[...$('groupTableBody').querySelectorAll('[data-del-index]')].forEach((button) => {
      button.addEventListener('click', () => removeGroupRow(Number(button.dataset.delIndex)))
    })
  }

  function collectGroups() {
    const rows = [...$('groupTableBody').querySelectorAll('tr')]
    return rows.map((row) => ({
      group: row.querySelector('[data-group-name]').value.trim(),
      keywords: String(row.querySelector('[data-group-keywords-cell]')?._chip?.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      region: row.querySelector('[data-group-region]').value.trim() || '其他',
    })).filter((g) => g.group && g.keywords.length > 0)
  }

  function addGroupRow() {
    currentGroups.push({ group: '', keywords: '', region: '' })
    renderGroupTable()
  }

  function removeGroupRow(index) {
    currentGroups.splice(index, 1)
    renderGroupTable()
  }

  // ---------- 查询配置 ----------
  function buildConfig() {
    const keywords = String(container._chipInputs?.cfgKeywords?.value || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    const types = [...$('cfgTypes').querySelectorAll('input:checked')].map((input) => input.value)
    return {
      keywords,
      types,
      startDate: $('cfgStart').value,
      endDate: $('cfgEnd').value,
      leadingRule: $('cfgLeadingRule').value,
      groups: collectGroups(),
      maxItems: Number(queryParams.get('maxItems') || 24),
      concurrency: Number(queryParams.get('concurrency') || 8),
      searchConcurrency: Number(queryParams.get('searchConcurrency') || 3),
      llmConcurrency: Number(queryParams.get('llmConcurrency') || 5),
      debug: $('cfgDebug').checked,
    }
  }

  // ---------- 配置历史（analysis 模块独立 localStorage key） ----------
  history = new ui.ConfigHistory('analysis', { selectId: 'cfgHistory' })
  history.setSaveMode('inline') // 保存走内联命名输入（替代 prompt()），见 .config-history-panel

  // 历史胶囊列表（点击加载 / × 删除，与 #cfgHistory 下拉双向同步）
  function renderHistoryPanel() {
    const list = $('configHistoryList')
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

  // 日期快捷预设：近1年/近3年/近5年/自定义
  function selectPreset(preset) {
    ;[...$('datePresetRow').querySelectorAll('.date-preset-btn')].forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.preset === preset)
    })
    const years = { '1y': 1, '3y': 3, '5y': 5 }[preset]
    if (!years) return // 'custom'：不自动改写日期，交给用户手动选择
    const now = new Date()
    $('cfgEnd').value = ui.formatLocalDate(now.toISOString())
    $('cfgStart').value = ui.formatLocalDate(new Date(now.getFullYear() - years, now.getMonth(), now.getDate()).toISOString())
  }

  // 胶囊多选视觉同步：checkbox 隐藏但保留 value / checked（buildConfig 的 input:checked 查询继续工作）
  function syncPillState() {
    ;[...$('cfgTypes').querySelectorAll('.pill-option')].forEach((pill) => {
      const input = pill.querySelector('input')
      pill.classList.toggle('selected', !!input?.checked)
    })
  }

  // 主按钮运行中状态：loading-spinner + 禁用 + 文案
  function setAnalyzing(analyzing) {
    $('btnAnalyze').disabled = analyzing
    const spinner = $('btnAnalyze').querySelector('.loading-spinner')
    const label = $('btnAnalyze').querySelector('.btn-text')
    if (spinner) spinner.style.display = analyzing ? 'inline-block' : 'none'
    if (label) label.textContent = analyzing ? '实时分析中…' : '开始实时分析'
  }

  function applyConfig(config) {
    if (!config) return
    keywordChip.setValues(config.keywords || [])
    ;[...$('cfgTypes').querySelectorAll('input[type="checkbox"]')].forEach((input) => {
      input.checked = (config.types || []).includes(input.value)
    })
    syncPillState()
    if (config.startDate) $('cfgStart').value = config.startDate
    if (config.endDate) $('cfgEnd').value = config.endDate
    if (config.startDate || config.endDate) selectPreset('custom') // 历史日期非预设时高亮「自定义」
    if (config.leadingRule) $('cfgLeadingRule').value = config.leadingRule
    if (Array.isArray(config.groups) && config.groups.length > 0) {
      currentGroups = config.groups.map((g) => ({
        group: g.group || '',
        keywords: Array.isArray(g.keywords) ? g.keywords : String(g.keywords || ''),
        region: g.region || '',
      }))
      renderGroupTable()
    }
  }

  function saveConfig() {
    const nameEl = $('cfgSaveName')
    const name = String(nameEl?.value || '').trim()
    if (!name) return ui.showToast('请先填写配置名称', 'warn')
    const config = { ...buildConfig(), name: name.trim(), savedAt: new Date().toISOString() }
    history.add(config, name)
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

  // ---------- 本地聚合（快照/后端缺统计时兜底） ----------
  function normalizeRows(items) {
    return (items || []).map((item) => ({
      standardNo: item.n || item.standardNo || '',
      title: item.t || item.title || '',
      domain: item.d || item.domain || '',
      status: item.s || item.status || '',
      year: item.y || (item.publishedAt || '').slice(0, 4) || '',
      groups: item.g || item.groups || [],
      leadingGroup: item.l || item.leadingGroup || '',
      techAreas: item.a || item.techAreas || [],
      scope: item.scope || '',
      url: item.u || item.url || '',
      draftCount: item.draftCount || 0,
    }))
  }

  function computeDashboard(rows, groups) {
    const groupStats = Object.fromEntries(groups.map((rule) => [
      rule.group,
      { region: rule.region, leading: 0, participating: 0, standards: [] },
    ]))
    const techAreas = {}
    const yearTrend = {}
    for (const row of rows) {
      if (row.year) yearTrend[row.year] = (yearTrend[row.year] || 0) + 1
      for (const area of row.techAreas) techAreas[area] = (techAreas[area] || 0) + 1
      for (const rule of groups) {
        if (!row.groups.includes(rule.group)) continue
        const stat = groupStats[rule.group]
        stat.participating += 1
        stat.standards.push(row.standardNo)
        if (row.leadingGroup === rule.group) stat.leading += 1
      }
    }
    const regionData = [...new Set(groups.map((rule) => rule.region))].map((region) => {
      const rules = groups.filter((rule) => rule.region === region)
      const involved = new Set()
      for (const row of rows) {
        if (rules.some((rule) => row.groups.includes(rule.group))) involved.add(row.standardNo)
      }
      return { name: region, value: involved.size, companies: rules.map((rule) => rule.group) }
    })
    const years = ['2021', '2022', '2023', '2024', '2025', '2026']
    const companyTrend = Object.fromEntries(groups.map((rule) => [
      rule.group,
      years.map((year) => rows.filter((row) => row.year === year && row.groups.includes(rule.group)).length),
    ]))
    return { groupStats, techAreas, yearTrend, regionData, companyTrend, years }
  }

  function fallbackConclusions(stats, rows) {
    const groupStats = stats.groupStats || {}
    const hisense = groupStats['海信系'] || Object.values(groupStats)[0] || { participating: 0, leading: 0 }
    const top = Object.entries(groupStats)
      .sort((a, b) => b[1].participating - a[1].participating)
      .slice(0, 3)
      .map(([name, stat]) => `${name}${stat.participating}项`)
      .join('、')
    const freshness = (stats.techAreas || {})['保鲜'] || 0
    return [
      { title: '竞争格局', text: `参与标准数量居前：${top}；牵头起草口径下${Object.entries(groupStats).filter(([, s]) => s.leading > 0).map(([n, s]) => `${n}${s.leading}项`).join('、') || '暂无'}(按当前口径)。` },
      { title: '趋势洞察', text: `发布年度集中在${Object.entries(stats.yearTrend || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([y, c]) => `${y}年${c}项`).join('、')}；保鲜技术标签 ${freshness} 项（占比 ${rows.length ? Math.round(freshness / rows.length * 100) : 0}%）。` },
      { title: '机会识别', text: `无霜/微冻/保湿等细分方向公开标准较少，可结合起草单位未公开的行业标准做差异化布局（本结论由统计自动生成，LLM 结论需配置模型后获取）。` },
    ]
  }

  // ---------- 图表 ----------
  function initCharts() {
    if (typeof echarts === 'undefined') return
    charts.bar = echarts.init($('barChart'))
    charts.pie = echarts.init($('pieChart'))
    charts.line = echarts.init($('lineChart'))
    charts.map = echarts.init($('mapChart'))
    resizeHandler = () => Object.values(charts).forEach((chart) => chart.resize())
    window.addEventListener('resize', resizeHandler)
    charts.bar.on('click', (params) => openDrillModal(params.name))
  }

  const gradient = (c1, c2) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c1 }, { offset: 1, color: c2 }])
  const lighten = (hex) => {
    const num = parseInt(hex.slice(1), 16)
    const r = Math.min(255, ((num >> 16) & 255) + 70)
    const g = Math.min(255, ((num >> 8) & 255) + 70)
    const b = Math.min(255, (num & 255) + 70)
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
  }

  // 初始空状态：未开始分析时不展示任何结果信息
  function renderEmpty() {
    ;['statTotal', 'statHisense', 'statFreshness', 'statProvinces', 'companyLeading', 'companyParticipating']
      .forEach((id) => { $(id).textContent = '—' })
    $('conclusionList').innerHTML = ''
    $('printTitle').textContent = '标准竞争分析报告'
    $('printMeta').textContent = '数据来源：待分析'
    $('resultsPlaceholder').classList.remove('hidden')
  }

  function renderAll(rows, meta, stats, conclusions, groups) {
    $('resultsPlaceholder').classList.add('hidden')
    currentRows = rows
    currentMeta = meta || currentMeta
    currentStats = stats
    currentGroups = groups || currentGroups
    const dash = stats || computeDashboard(rows, currentGroups)
    if (!dash.companyTrend || !dash.years) {
      const computed = computeDashboard(rows, currentGroups)
      dash.companyTrend = computed.companyTrend
      dash.years = computed.years
    }
    const groupStats = dash.groupStats || {}
    const hisense = groupStats['海信系'] || Object.values(groupStats)[0] || { participating: 0, leading: 0 }

    $('statTotal').textContent = rows.length
    $('statHisense').textContent = hisense.participating
    const freshness = (dash.techAreas || {})['保鲜'] || 0
    $('statFreshness').textContent = rows.length ? Math.round(freshness / rows.length * 100) + '%' : '0%'
    $('statProvinces').textContent = (dash.regionData || []).length
    $('companyLeading').textContent = hisense.leading
    $('companyParticipating').textContent = hisense.participating
    $('dataSourceTag').textContent = `${currentMeta.source}（${currentMeta.collectedAt}）`
    $('printMeta').textContent = `数据来源：${currentMeta.source}（${currentMeta.collectedAt}）· 共 ${rows.length} 条标准 · 查询口径：主导=${dash.leadingRule || currentMeta.leadingRule || '首位'}`
    $('printTitle').textContent = currentMeta.reportTitle || '标准竞争分析报告'

    renderBar(dash)
    renderPie(dash)
    renderLine(dash)
    renderMap(dash.regionData)
    renderConclusions(conclusions, dash, rows)
  }

  function renderBar(dash) {
    const companyNames = currentGroups.map((rule) => rule.group)
    const groupStats = dash.groupStats || {}
    charts.bar.setOption({
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderColor: '#cfd8dd',
        textStyle: { color: '#223047' },
        axisPointer: { type: 'shadow' },
        formatter: function (params) {
          const name = params[0].name
          const stat = groupStats[name] || { participating: 0, leading: 0 }
          const color = GROUP_COLORS[name] || '#818cf8'
          return `<div style="font-weight:600;margin-bottom:8px">${name}</div>
                  <div>参与标准：<span style="color:${color};font-weight:700">${stat.participating}项</span></div>
                  <div>主导标准（${dash.leadingRule === 'top3' ? '前3位' : '首位'}）：${stat.leading}项</div>
                  <div style="margin-top:8px;font-size:13px;color:var(--slate-500)">点击查看标准明细 →</div>`
        },
      },
      xAxis: { type: 'category', data: companyNames, axisLine: { lineStyle: { color: '#cfd8dd' } }, axisLabel: { color: '#485a6d', fontSize: 14, fontWeight: 500 }, axisTick: { show: false } },
      yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: '#dfe6e9', type: 'dashed' } }, axisLabel: { color: '#667789' } },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
      series: [{
        type: 'bar',
        barWidth: '50%',
        itemStyle: { borderRadius: [8, 8, 0, 0] },
        label: { show: true, position: 'top', color: '#1b2a3d', fontSize: 15, fontWeight: 700, formatter: '{c}项' },
        animationDuration: 1500,
        animationEasing: 'elasticOut',
        data: currentGroups.map((rule) => {
          const color = GROUP_COLORS[rule.group] || '#6366f1'
          return {
            value: (groupStats[rule.group] || { participating: 0 }).participating,
            itemStyle: { color: gradient(lighten(color), color) },
          }
        }),
      }],
    }, true)
  }

  function renderPie(dash) {
    const data = Object.entries(dash.techAreas)
      .map(([name, value]) => ({ name, value, itemStyle: { color: gradient(lighten(TECH_COLORS[name] || '#818cf8'), TECH_COLORS[name] || '#6366f1') } }))
      .sort((a, b) => b.value - a.value)
    charts.pie.setOption({
      tooltip: { trigger: 'item', backgroundColor: 'rgba(255, 255, 255, 0.95)', borderColor: '#cfd8dd', textStyle: { color: '#223047' }, formatter: '{b}: {c}项 ({d}%)' },
      legend: { orient: 'vertical', right: '5%', top: 'center', textStyle: { color: '#485a6d', fontSize: 14 }, itemWidth: 12, itemHeight: 12, itemGap: 16 },
      series: [{
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['35%', '50%'],
        itemStyle: { borderRadius: 8, borderColor: '#ffffff', borderWidth: 3 },
        label: { show: true, position: 'outside', color: '#223047', fontSize: 13, formatter: '{b}\n{d}%' },
        labelLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.5)' } },
        emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold' }, itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.5)' }, scaleSize: 10 },
        data,
        animationType: 'scale',
        animationDuration: 1500,
        animationEasing: 'elasticOut',
      }],
    }, true)
  }

  function renderLine(dash) {
    const companyNames = currentGroups.map((rule) => rule.group)
    const trend = dash.companyTrend || {}
    charts.line.setOption({
      tooltip: { trigger: 'axis', backgroundColor: 'rgba(255, 255, 255, 0.95)', borderColor: '#cfd8dd', textStyle: { color: '#223047' }, axisPointer: { type: 'cross', crossStyle: { color: '#83909e' } } },
      legend: { data: companyNames, textStyle: { color: '#485a6d' }, top: 0, itemWidth: 20, itemHeight: 10, itemGap: 24 },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: dash.years, axisLine: { lineStyle: { color: '#cfd8dd' } }, axisLabel: { color: '#485a6d', fontSize: 14 }, axisTick: { show: false } },
      yAxis: { type: 'value', name: '标准数量（项）', nameTextStyle: { color: '#667789', fontSize: 13 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: '#dfe6e9', type: 'dashed' } }, axisLabel: { color: '#667789' } },
      series: currentGroups.map((rule) => {
        const color = GROUP_COLORS[rule.group] || '#6366f1'
        const emphasis = rule.group.includes('海信')
        return {
          name: rule.group,
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: emphasis ? 10 : 8,
          lineStyle: { width: emphasis ? 4 : 3, color, shadowBlur: emphasis ? 10 : 0, shadowColor: emphasis ? 'rgba(99,102,241,0.5)' : 'transparent' },
          itemStyle: { color, borderWidth: emphasis ? 3 : 2, borderColor: '#fff', shadowBlur: emphasis ? 15 : 0, shadowColor: emphasis ? 'rgba(99,102,241,0.6)' : 'transparent' },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: color + '4d' }, { offset: 1, color: color + '0d' }]) },
          data: trend[rule.group] || [],
          markPoint: emphasis ? { data: [{ type: 'max', name: '峰值' }], symbolSize: 50, label: { fontSize: 10 } } : undefined,
          emphasis: { focus: 'series', scale: emphasis },
        }
      }),
      animationDuration: 1500,
      animationEasing: 'cubicInOut',
    }, true)
  }

  function renderMap(regionData) {
    const maxValue = Math.max(1, ...(regionData || []).map((item) => item.value || 0))
    fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json')
      .then((response) => response.json())
      .then((chinaJson) => {
        echarts.registerMap('china', chinaJson)
        charts.map.setOption({
          tooltip: {
            trigger: 'item',
            backgroundColor: 'rgba(255, 255, 255, 0.95)',
            borderColor: '#cfd8dd',
            textStyle: { color: '#223047' },
            formatter: function (params) {
              if (params.data && params.data.value) {
                return `<div style="font-weight:600;margin-bottom:8px">${params.name}</div>
                        <div>标准数量：<span style="color:#60a5fa;font-weight:700">${params.data.value}项</span></div>
                        <div style="margin-top:6px">主要企业：${params.data.companies.join('、')}</div>`
              }
              return `${params.name}<br/>暂无数据`
            },
          },
          visualMap: { min: 0, max: maxValue, left: 'left', top: 'bottom', text: ['高', '低'], textStyle: { color: '#667789' }, inRange: { color: ['#e5f6f3', '#99f6e4', '#0d9488', '#0f766e', '#134e4a'] }, calculable: true },
          geo: { map: 'china', roam: false, zoom: 1.2, center: [105, 36], label: { show: true, color: '#485a6d', fontSize: 12 }, emphasis: { label: { color: '#fff', fontSize: 14, fontWeight: 'bold' }, itemStyle: { areaColor: '#0d9488', shadowBlur: 20, shadowColor: 'rgba(13,148,136,0.5)' } }, itemStyle: { areaColor: '#eef4f4', borderColor: '#9db6b1', borderWidth: 1 } },
          series: [{ name: '标准数量', type: 'map', geoIndex: 0, data: regionData || [] }],
          animationDuration: 1500,
          animationEasing: 'cubicInOut',
        }, true)
      })
      .catch((err) => {
        console.error('地图加载失败:', err)
        $('mapChart').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--slate-500);">地图数据加载中，请刷新页面重试...</div>'
      })
  }

  function renderConclusions(conclusions, dash, rows) {
    const list = conclusions && conclusions.length ? conclusions : fallbackConclusions(dash, rows)
    $('conclusionList').innerHTML = list.map((item) => `
      <li class="conclusion-item">
        <strong>${ui.esc(item.title)}：</strong>${ui.esc(item.text)}
      </li>`).join('')
  }

  // ---------- 实时分析任务 ----------
  function appendLog(entry) {
    const time = ui.formatLocalTime(entry.time)
    const div = document.createElement('div')
    div.innerHTML = `<span class="log-time">${ui.esc(time)}</span><span class="log-stage">${ui.esc(entry.stage)}</span>${ui.esc(entry.message)}`
    $('progressLogs').appendChild(div)
    $('progressLogs').scrollTop = $('progressLogs').scrollHeight
    updateProgress(entry)
  }

  function updateProgress(entry) {
    const stageBase = {
      '检索': 8, '领域过滤': 12, '起草单位补抓': 16, '详情补抓': 20, 'LLM 提取': 60, '合并': 96, '分析结论': 98,
    }
    let percent = stageBase[entry.stage] || 0
    const match = String(entry.message || '').match(/(\d+)\/(\d+)/)
    if (match) {
      const done = Number(match[1])
      const total = Number(match[2])
      if (entry.stage === '详情补抓') percent = 20 + (done / total) * 40
      if (entry.stage === 'LLM 提取') percent = 60 + (done / total) * 35
    }
    percent = Math.min(99, Math.max(percent, 1))
    $('progressFill').style.width = percent + '%'
    $('progressPercent').textContent = Math.round(percent) + '%'
  }

  function startAnalysis() {
    const config = buildConfig()
    if (!config.keywords.length) return ui.showToast('请至少填写一个关键词', 'error')
    if (!config.types.length) return ui.showToast('请至少选择一种标准类型', 'error')
    if (!config.groups.length) return ui.showToast('请至少配置一个分析对象集团', 'error')
    if (location.protocol === 'file:') {
      ui.showToast('静态模式：请运行 node std-crawler/serve-demo.mjs 后访问 http://127.0.0.1:5277', 'warn')
      return
    }
    history.persistLast(config)

    $('progressPanel').style.display = 'block'
    $('progressLogs').innerHTML = ''
    $('progressTitle').textContent = '实时分析中（真实爬取 + LLM）'
    $('progressFill').style.width = '2%'
    $('progressPercent').textContent = '2%'
    setAnalyzing(true)
    appendLog({ time: new Date().toISOString(), stage: '任务创建', message: `关键词「${config.keywords.join(' / ')}」类型「${config.types.join(' / ')}」${config.startDate}~${config.endDate}` })

    api.createJob('analysis', config)
      .then((data) => api.pollJob(data.jobId, { onLog: appendLog }))
      .then((result) => {
        $('progressTitle').textContent = '分析完成'
        $('progressFill').style.width = '100%'
        $('progressPercent').textContent = '100%'
        setAnalyzing(false)
        const groups = collectGroups()
        renderAll(
          normalizeRows(result.rows),
          {
            source: '实时爬取（std.samr.gov.cn + LLM）',
            collectedAt: ui.formatLocalDate(result.collectedAt),
            leadingRule: result.leadingRule,
            reportTitle: result.reportTitle || `${(buildConfig().keywords || []).slice(0, 2).join('、')}领域标准竞争分析报告`,
          },
          {
            groupStats: result.groupStats, techAreas: result.techAreas, yearTrend: result.yearTrend,
            regionData: result.regionData, companyTrend: null, years: ['2021', '2022', '2023', '2024', '2025', '2026'], leadingRule: result.leadingRule,
          },
          result.conclusions,
          groups,
        )
        ui.showToast(`实时分析完成：${result.rows.length} 条标准（LLM 结论 ${result.conclusions?.length ? '已生成' : '未生成'}）`, 'success')
        if (pushBar) pushBar.refresh()
        if (config.debug) {
          lastDebug = {
            config,
            debug: result.debug || null,
            result: {
              rows: result.rows?.length,
              mergedCount: result.mergedCount,
              reportTitle: result.reportTitle,
              conclusionsStatus: result.conclusionsStatus,
              llmOk: result.llmOk,
              hydratedCount: result.hydratedCount,
            },
          }
          renderDebugPanel(result.debug)
        } else {
          $('debugPanel').style.display = 'none'
        }
      })
      .catch((err) => {
        setAnalyzing(false)
        $('progressTitle').textContent = '分析失败'
        appendLog({ time: new Date().toISOString(), stage: '错误', message: err.message })
        if (config.debug) {
          lastDebug = { config, error: err.message, note: '任务失败阶段的完整诊断请查看服务端控制台日志（node serve-demo.mjs 输出）' }
          renderDebugPanel(null)
        }
        ui.showToast('实时分析失败：' + err.message, 'error')
      })
  }

  function renderDebugPanel(debug) {
    $('debugPanel').style.display = 'block'
    if (!debug || !debug.enabled) {
      $('debugContent').innerHTML = '<div class="debug-section">后端未返回调试信息：请确认已勾选「调试模式」并重新点击「开始实时分析」；任务失败时请查看服务端控制台输出。</div>'
      return
    }
    const table = (rows) => rows && rows.length
      ? `<table><thead><tr>${Object.keys(rows[0]).map((k) => `<th>${ui.esc(k)}</th>`).join('')}</tr></thead><tbody>${
          rows.map((row) => `<tr>${Object.values(row).map((value) => `<td>${ui.esc(Array.isArray(value) ? value.join('、') : String(value ?? ''))}</td>`).join('')}</tr>`).join('')
        }</tbody></table>`
      : '<div style="padding:6px 0;color:var(--slate-500)">无</div>'
    const warnings = debug.warnings && debug.warnings.length
      ? `<div class="debug-warn">${svgIcon(ICON_PATHS.warn, 14)} ${debug.warnings.map(ui.esc).join('<br/>')}</div>`
      : `<div style="color:#34d399">${svgIcon(ICON_PATHS.ok, 14)} 无警告</div>`
    const timings = Object.entries(debug.timings || {})
      .map(([name, ms]) => `${name}: ${(ms / 1000).toFixed(1)}s`)
      .join('　')
    $('debugContent').innerHTML = `
      <div class="debug-section"><details open><summary>概览与阶段耗时</summary>
        <div style="padding:8px 0;color:var(--slate-600)">阶段耗时：${ui.esc(timings)}</div>
        ${warnings}
      </details></div>
      <div class="debug-section"><details><summary>检索命中（${(debug.search || []).length} 项）</summary>${table(debug.search)}</details></div>
      <div class="debug-section"><details><summary>领域过滤（保留 ${debug.filter?.kept} / 共 ${debug.filter?.total}，丢弃 ${(debug.filter?.dropped || []).length} 条并附原因）</summary>${table(debug.filter?.dropped)}</details></div>
      <div class="debug-section"><details><summary>行业标准起草单位补抓 hbba（${(debug.hbba || []).length} 条）</summary>${table(debug.hbba)}</details></div>
      <div class="debug-section"><details><summary>详情页补抓（${(debug.hydrate || []).length} 条，含状态/错误/键值数）</summary>${table(debug.hydrate)}</details></div>
      <div class="debug-section"><details><summary>LLM 结构化提取（${(debug.llm || []).length} 条，含状态/错误/标签/置信度）</summary>${table(debug.llm)}</details></div>
      <div class="debug-section"><details><summary>计划↔发布合并（${debug.merge?.before} → ${debug.merge?.after}）</summary><div style="padding:6px 0;color:var(--slate-600)">同标准号去重，优先保留已发布版</div></details></div>
      <div class="debug-section"><details><summary>原始调试 JSON</summary><pre>${ui.esc(JSON.stringify(debug, null, 2))}</pre></details></div>`
  }

  function exportDebugLog() {
    if (!lastDebug) return ui.showToast('暂无调试信息：请勾选「调试模式」并完成一次分析', 'warn')
    const payload = { exportedAt: new Date().toISOString(), ...lastDebug }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `analysis-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(link.href)
    ui.showToast('调试日志已导出', 'success')
  }

  // ---------- 下钻 / 导出 ----------
  function openDrillModal(companyName) {
    const rows = currentRows.filter((row) => row.groups.includes(companyName))
    $('modalTitle').textContent = `${companyName} - 标准参与/主导明细（${rows.length} 项）`
    $('standardsTableBody').innerHTML = rows.length
      ? rows.map((row) => `
          <tr>
            <td style="color:#818cf8;font-weight:500"><a href="${row.url}" target="_blank" rel="noopener" style="color:#818cf8;text-decoration:none">${row.standardNo}</a></td>
            <td>${row.url ? `<a href="${row.url}" target="_blank" rel="noopener" style="color:var(--navy-950);text-decoration:none">${ui.esc(row.title)}</a>` : ui.esc(row.title)}${row.scope ? `<div style="font-size:12px;color:var(--slate-500);margin-top:4px">${ui.esc(row.scope)}</div>` : ''}</td>
            <td>${row.techAreas.map(ui.esc).join('、') || '—'}</td>
            <td>${row.year}</td>
            <td><span class="badge ${row.leadingGroup === companyName ? 'badge-dominant' : 'badge-participate'}">${row.leadingGroup === companyName ? '主导' : '参与'}</span></td>
          </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--slate-500);padding:24px">暂无公开起草单位数据</td></tr>'
    $('drillModal').classList.add('active')
  }

  function closeModal() {
    $('drillModal').classList.remove('active')
  }

  function exportExcel() {
    if (!currentRows.length) return ui.showToast('暂无数据可导出', 'warn')
    const header = ['标准编号', '标准名称', '类型', '状态', '年份', '技术领域', '涉及企业集团', '牵头集团', '官方链接']
    const lines = [header.join(',')]
    for (const row of currentRows) {
      lines.push([
        row.standardNo, `"${(row.title || '').replace(/"/g, '""')}"`, row.domain, row.status, row.year,
        `"${row.techAreas.join('、')}"`, `"${row.groups.join('、')}"`, row.leadingGroup || '', row.url,
      ].join(','))
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `保鲜领域标准竞争分析-原始数据-${currentMeta.collectedAt || 'demo'}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
    ui.showToast('原始数据已导出（CSV/Excel 兼容）', 'success')
  }

  function exportPDF() {
    ui.showToast('已进入打印视图，请选择“另存为 PDF”')
    window.print()
  }

  // ---------- 初始化 ----------
  renderGroupTable()
  initCharts()
  renderHistorySelect()
  renderEmpty()
  applyConfig(history.loadLast())
  syncPillState()

  $('btnAnalyze').addEventListener('click', startAnalysis)
  $('addGroupBtn').addEventListener('click', addGroupRow)
  $('cfgSave').addEventListener('click', saveConfig)
  $('cfgLoad').addEventListener('click', loadConfig)
  $('cfgDelete').addEventListener('click', deleteConfig)
  $('cfgSaveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveConfig() })
  $('exportExcelBtn').addEventListener('click', exportExcel)
  $('exportPDFBtn').addEventListener('click', exportPDF)
  $('exportDebugBtn').addEventListener('click', exportDebugLog)
  $('modalClose').addEventListener('click', closeModal)
  $('drillModal').addEventListener('click', (e) => {
    if (e.target === $('drillModal')) closeModal()
  })

  // 日期快捷预设 + 手动改日期时切回「自定义」
  $('datePresetRow').addEventListener('click', (e) => {
    const btn = e.target.closest('.date-preset-btn')
    if (btn) selectPreset(btn.dataset.preset)
  })
  $('cfgStart').addEventListener('change', () => selectPreset('custom'))
  $('cfgEnd').addEventListener('change', () => selectPreset('custom'))

  // 胶囊多选视觉同步（checkbox 仍真实存在，change 由 label 包裹触发）
  $('cfgTypes').addEventListener('change', syncPillState)

  // 历史胶囊：点击加载 / × 删除（事件委托，兼容动态渲染）
  $('configHistoryList').addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-history-del]')
    if (delBtn) {
      $('cfgHistory').value = delBtn.dataset.historyDel
      deleteConfig()
      return
    }
    const chip = e.target.closest('[data-history-index]')
    if (chip) {
      $('cfgHistory').value = chip.dataset.historyIndex
      loadConfig()
    }
  })
  $('configHistoryList').addEventListener('keydown', (e) => {
    const chip = e.target.closest('[data-history-index]')
    if (chip && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      $('cfgHistory').value = chip.dataset.historyIndex
      loadConfig()
    }
  })

  // 检测本地服务：仅提示连接状态，不自动爬取（由用户点击「开始实时分析」触发）
  if (location.protocol !== 'file:') {
    api.fetchHealth()
      .then((health) => {
        $('analysisServerStatus').textContent = health.ok
          ? `✓ 服务已连接（LLM ${health.llmConfigured ? '已启用' : '未配置'}），配置完成后点击「开始实时分析」`
          : '✗ 服务异常'
      })
      .catch(() => {
        $('analysisServerStatus').textContent = '✗ 未连接服务'
      })
  } else {
    $('analysisServerStatus').textContent = '静态模式'
  }

  return {
    destroy() {
      if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler)
        resizeHandler = null
      }
      Object.values(charts).forEach((chart) => { try { chart.dispose() } catch { /* 忽略 */ } })
      charts = {}
      container.innerHTML = ''
    },
    onShow() {
      Object.values(charts).forEach((chart) => chart.resize())
    },
  }
}
