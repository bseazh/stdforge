// 竞争对手标准布局分析 - 可配置查询 + 真实爬取 + LLM 实时分析
// 后端：node std-crawler/serve-demo.mjs（POST /api/analyze → GET /api/analyze/{jobId}）
(function () {
    'use strict';

    const API_ROOT = location.pathname.startsWith('/module2/') ? '/module2/api' : '/api';

    const DEFAULT_GROUPS = [
        { group: '海信系', keywords: '海信', region: '广东省' },
        { group: '美的', keywords: '美的', region: '广东省' },
        { group: '海尔', keywords: '海尔', region: '山东省' },
        { group: '格力', keywords: '格力', region: '广东省' },
        { group: '美菱', keywords: '美菱,华凌', region: '安徽省' }
    ];

    const GROUP_COLORS = {
        '海信系': '#6366f1', '美的': '#10b981', '海尔': '#3b82f6', '格力': '#f59e0b', '美菱': '#ef4444'
    };

    const TECH_COLORS = {
        '保鲜': '#3b82f6', '无霜': '#10b981', '化霜': '#f59e0b', '微冻': '#a78bfa',
        '保湿': '#34d399', '精准控温': '#fb923c', '智能保鲜': '#818cf8', '零度保鲜': '#2dd4bf',
        '能效': '#22d3ee', '安全': '#f43f5e', '其他': '#6366f1'
    };

    let charts = {};
    let currentRows = [];
    let currentMeta = { source: '', collectedAt: '' };
    let currentStats = null;
    let currentGroups = DEFAULT_GROUPS.map((g) => ({ ...g }));
    let lastDebug = null;

    const $ = (id) => document.getElementById(id);

    // ---------- 集团映射编辑器 ----------
    function renderGroupTable() {
        $('groupTableBody').innerHTML = currentGroups.map((g, index) => `
            <tr>
                <td><input data-group-name value="${esc(g.group)}" placeholder="集团名称" /></td>
                <td><input data-group-keywords value="${esc(g.keywords)}" placeholder="关键词，逗号分隔" /></td>
                <td><input data-group-region value="${esc(g.region)}" placeholder="注册地" /></td>
                <td><button type="button" class="del-btn" onclick="removeGroupRow(${index})">删除</button></td>
            </tr>`).join('');
    }

    function collectGroups() {
        const rows = [...$('groupTableBody').querySelectorAll('tr')];
        return rows.map((row) => ({
            group: row.querySelector('[data-group-name]').value.trim(),
            keywords: row.querySelector('[data-group-keywords]').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
            region: row.querySelector('[data-group-region]').value.trim() || '其他',
        })).filter((g) => g.group && g.keywords.length > 0);
    }

    function addGroupRow() {
        currentGroups.push({ group: '', keywords: '', region: '' });
        renderGroupTable();
    }

    function removeGroupRow(index) {
        currentGroups.splice(index, 1);
        renderGroupTable();
    }

    function esc(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // 本地时区时间/日期格式化（后端日志为 UTC ISO，直接截取会显示成北京时间-8小时）
    function formatLocalTime(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return String(iso);
        return [date.getHours(), date.getMinutes(), date.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    }

    function formatLocalDate(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return String(iso).slice(0, 10);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    // ---------- 查询配置 ----------
    function buildConfig() {
        const keywords = $('cfgKeywords').value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
        const types = [...$('cfgTypes').querySelectorAll('input:checked')].map((input) => input.value);
        const queryParams = new URLSearchParams(location.search);
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
            llmConcurrency: Number(queryParams.get('llmConcurrency') || 3),
            debug: $('cfgDebug').checked,
        };
    }

    // ---------- 配置历史（localStorage） ----------
    const HISTORY_KEY = 'case8-config-history';
    const LAST_CONFIG_KEY = 'case8-last-config';
    let history = [];

    function loadHistory() {
        try { history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { history = []; }
        if (!Array.isArray(history)) history = [];
    }

    function saveHistory() {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    }

    function renderHistorySelect() {
        $('cfgHistory').innerHTML = history.length
            ? history.map((item, index) => `<option value="${index}">${esc(item.name || '未命名')}（${formatLocalDate(item.savedAt)}）</option>`).join('')
            : '<option value="">（暂无配置历史）</option>';
    }

    function applyConfig(config) {
        if (!config) return;
        $('cfgKeywords').value = (config.keywords || []).join(',');
        [...$('cfgTypes').querySelectorAll('input[type="checkbox"]')].forEach((input) => {
            input.checked = (config.types || []).includes(input.value);
        });
        if (config.startDate) $('cfgStart').value = config.startDate;
        if (config.endDate) $('cfgEnd').value = config.endDate;
        if (config.leadingRule) $('cfgLeadingRule').value = config.leadingRule;
        if (Array.isArray(config.groups) && config.groups.length > 0) {
            currentGroups = config.groups.map((g) => ({
                group: g.group || '',
                keywords: Array.isArray(g.keywords) ? g.keywords.join(',') : String(g.keywords || ''),
                region: g.region || '',
            }));
            renderGroupTable();
        }
    }

    function saveConfig() {
        const name = prompt('配置名称：', `配置-${new Date().toLocaleDateString('zh-CN')}`);
        if (!name) return;
        const config = { ...buildConfig(), name: name.trim(), savedAt: new Date().toISOString() };
        history.push(config);
        saveHistory();
        renderHistorySelect();
        $('cfgHistory').value = String(history.length - 1);
        showToast('配置已保存到历史', 'success');
    }

    function loadConfig() {
        const index = Number($('cfgHistory').value);
        if (!history[index]) return showToast('请先选择一条配置历史', 'warn');
        applyConfig(history[index]);
        showToast(`已加载配置：${history[index].name}`, 'success');
    }

    function deleteConfig() {
        const index = Number($('cfgHistory').value);
        if (!history[index]) return showToast('请先选择要删除的配置', 'warn');
        if (!confirm(`确定删除配置「${history[index].name}」？`)) return;
        history.splice(index, 1);
        saveHistory();
        renderHistorySelect();
        showToast('配置已删除', 'success');
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
            draftCount: item.draftCount || 0
        }));
    }

    function computeDashboard(rows, groups) {
        const groupStats = Object.fromEntries(groups.map((rule) => [
            rule.group,
            { region: rule.region, leading: 0, participating: 0, standards: [] }
        ]));
        const techAreas = {};
        const yearTrend = {};
        for (const row of rows) {
            if (row.year) yearTrend[row.year] = (yearTrend[row.year] || 0) + 1;
            for (const area of row.techAreas) techAreas[area] = (techAreas[area] || 0) + 1;
            for (const rule of groups) {
                if (!row.groups.includes(rule.group)) continue;
                const stat = groupStats[rule.group];
                stat.participating += 1;
                stat.standards.push(row.standardNo);
                if (row.leadingGroup === rule.group) stat.leading += 1;
            }
        }
        const regionData = [...new Set(groups.map((rule) => rule.region))].map((region) => {
            const rules = groups.filter((rule) => rule.region === region);
            const involved = new Set();
            for (const row of rows) {
                if (rules.some((rule) => row.groups.includes(rule.group))) involved.add(row.standardNo);
            }
            return { name: region, value: involved.size, companies: rules.map((rule) => rule.group) };
        });
        const years = ['2021', '2022', '2023', '2024', '2025', '2026'];
        const companyTrend = Object.fromEntries(groups.map((rule) => [
            rule.group,
            years.map((year) => rows.filter((row) => row.year === year && row.groups.includes(rule.group)).length)
        ]));
        return { groupStats, techAreas, yearTrend, regionData, companyTrend, years };
    }

    function fallbackConclusions(stats, rows) {
        const groupStats = stats.groupStats || {};
        const hisense = groupStats['海信系'] || Object.values(groupStats)[0] || { participating: 0, leading: 0 };
        const top = Object.entries(groupStats)
            .sort((a, b) => b[1].participating - a[1].participating)
            .slice(0, 3)
            .map(([name, stat]) => `${name}${stat.participating}项`)
            .join('、');
        const freshness = (stats.techAreas || {})['保鲜'] || 0;
        return [
            { title: '竞争格局', text: `参与标准数量居前：${top}；牵头起草口径下${Object.entries(groupStats).filter(([, s]) => s.leading > 0).map(([n, s]) => `${n}${s.leading}项`).join('、') || '暂无'}(按当前口径)。` },
            { title: '趋势洞察', text: `发布年度集中在${Object.entries(stats.yearTrend || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([y, c]) => `${y}年${c}项`).join('、')}；保鲜技术标签 ${freshness} 项（占比 ${rows.length ? Math.round(freshness / rows.length * 100) : 0}%）。` },
            { title: '机会识别', text: `无霜/微冻/保湿等细分方向公开标准较少，可结合起草单位未公开的行业标准做差异化布局（本结论由统计自动生成，LLM 结论需配置模型后获取）。` }
        ];
    }

    // ---------- 图表 ----------
    function initCharts() {
        charts.bar = echarts.init($('barChart'));
        charts.pie = echarts.init($('pieChart'));
        charts.line = echarts.init($('lineChart'));
        charts.map = echarts.init($('mapChart'));
        window.addEventListener('resize', () => Object.values(charts).forEach((chart) => chart.resize()));
        charts.bar.on('click', (params) => openDrillModal(params.name));
    }

    const gradient = (c1, c2) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: c1 }, { offset: 1, color: c2 }]);
    const lighten = (hex) => {
        const num = parseInt(hex.slice(1), 16);
        const r = Math.min(255, ((num >> 16) & 255) + 70);
        const g = Math.min(255, ((num >> 8) & 255) + 70);
        const b = Math.min(255, (num & 255) + 70);
        return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    };

    // 初始空状态：未开始分析时不展示任何结果信息
    function renderEmpty() {
        ['statTotal', 'statHisense', 'statFreshness', 'statProvinces', 'companyLeading', 'companyParticipating']
            .forEach((id) => { $(id).textContent = '—'; });
        $('conclusionList').innerHTML = '';
        $('printTitle').textContent = '标准竞争分析报告';
        $('printMeta').textContent = '数据来源：待分析';
        $('resultsPlaceholder').classList.remove('hidden');
    }

    function renderAll(rows, meta, stats, conclusions, groups) {
        $('resultsPlaceholder').classList.add('hidden');
        currentRows = rows;
        currentMeta = meta || currentMeta;
        currentStats = stats;
        currentGroups = groups || currentGroups;
        const dash = stats || computeDashboard(rows, currentGroups);
        // 折线图依赖 companyTrend/years；统计接口未返回时本地补齐（修复空引用崩溃）
        if (!dash.companyTrend || !dash.years) {
            const computed = computeDashboard(rows, currentGroups);
            dash.companyTrend = computed.companyTrend;
            dash.years = computed.years;
        }
        const groupStats = dash.groupStats || {};
        const hisense = groupStats['海信系'] || Object.values(groupStats)[0] || { participating: 0, leading: 0 };

        $('statTotal').textContent = rows.length;
        $('statHisense').textContent = hisense.participating;
        const freshness = (dash.techAreas || {})['保鲜'] || 0;
        $('statFreshness').textContent = rows.length ? Math.round(freshness / rows.length * 100) + '%' : '0%';
        $('statProvinces').textContent = (dash.regionData || []).length;
        $('companyLeading').textContent = hisense.leading;
        $('companyParticipating').textContent = hisense.participating;
        $('dataSourceTag').textContent = `${currentMeta.source}（${currentMeta.collectedAt}）`;
        $('printMeta').textContent = `数据来源：${currentMeta.source}（${currentMeta.collectedAt}）· 共 ${rows.length} 条标准 · 查询口径：主导=${dash.leadingRule || currentMeta.leadingRule || '首位'}`;
        $('printTitle').textContent = currentMeta.reportTitle || '标准竞争分析报告';

        renderBar(dash);
        renderPie(dash);
        renderLine(dash);
        renderMap(dash.regionData);
        renderConclusions(conclusions, dash, rows);
    }

    function renderBar(dash) {
        const companyNames = currentGroups.map((rule) => rule.group);
        const groupStats = dash.groupStats || {};
        charts.bar.setOption({
            tooltip: {
                trigger: 'axis',
                backgroundColor: 'rgba(15, 23, 42, 0.9)',
                borderColor: 'rgba(99, 102, 241, 0.3)',
                textStyle: { color: '#e2e8f0' },
                axisPointer: { type: 'shadow' },
                formatter: function (params) {
                    const name = params[0].name;
                    const stat = groupStats[name] || { participating: 0, leading: 0 };
                    const color = GROUP_COLORS[name] || '#818cf8';
                    return `<div style="font-weight:600;margin-bottom:8px">${name}</div>
                            <div>参与标准：<span style="color:${color};font-weight:700">${stat.participating}项</span></div>
                            <div>主导标准（${dash.leadingRule === 'top3' ? '前3位' : '首位'}）：${stat.leading}项</div>
                            <div style="margin-top:8px;font-size:12px;color:#94a3b8">点击查看标准明细 →</div>`;
                }
            },
            xAxis: { type: 'category', data: companyNames, axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } }, axisLabel: { color: '#94a3b8', fontSize: 13, fontWeight: 500 }, axisTick: { show: false } },
            yAxis: { type: 'value', axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.1)', type: 'dashed' } }, axisLabel: { color: '#64748b' } },
            grid: { left: '3%', right: '4%', bottom: '3%', top: '10%', containLabel: true },
            series: [{
                type: 'bar',
                barWidth: '50%',
                itemStyle: { borderRadius: [8, 8, 0, 0] },
                label: { show: true, position: 'top', color: '#f1f5f9', fontSize: 16, fontWeight: 700, formatter: '{c}项' },
                animationDuration: 1500,
                animationEasing: 'elasticOut',
                data: currentGroups.map((rule) => {
                    const color = GROUP_COLORS[rule.group] || '#6366f1';
                    return {
                        value: (groupStats[rule.group] || { participating: 0 }).participating,
                        itemStyle: { color: gradient(lighten(color), color) }
                    };
                })
            }]
        }, true);
    }

    function renderPie(dash) {
        const data = Object.entries(dash.techAreas)
            .map(([name, value]) => ({ name, value, itemStyle: { color: gradient(lighten(TECH_COLORS[name] || '#818cf8'), TECH_COLORS[name] || '#6366f1') } }))
            .sort((a, b) => b.value - a.value);
        charts.pie.setOption({
            tooltip: { trigger: 'item', backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: 'rgba(99, 102, 241, 0.3)', textStyle: { color: '#e2e8f0' }, formatter: '{b}: {c}项 ({d}%)' },
            legend: { orient: 'vertical', right: '5%', top: 'center', textStyle: { color: '#94a3b8', fontSize: 13 }, itemWidth: 12, itemHeight: 12, itemGap: 16 },
            series: [{
                type: 'pie',
                radius: ['45%', '70%'],
                center: ['35%', '50%'],
                itemStyle: { borderRadius: 8, borderColor: '#1e293b', borderWidth: 3 },
                label: { show: true, position: 'outside', color: '#e2e8f0', fontSize: 13, formatter: '{b}\n{d}%' },
                labelLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.5)' } },
                emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold' }, itemStyle: { shadowBlur: 20, shadowColor: 'rgba(0,0,0,0.5)' }, scaleSize: 10 },
                data,
                animationType: 'scale',
                animationDuration: 1500,
                animationEasing: 'elasticOut'
            }]
        }, true);
    }

    function renderLine(dash) {
        const companyNames = currentGroups.map((rule) => rule.group);
        const trend = dash.companyTrend || {};
        charts.line.setOption({
            tooltip: { trigger: 'axis', backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: 'rgba(99, 102, 241, 0.3)', textStyle: { color: '#e2e8f0' }, axisPointer: { type: 'cross', crossStyle: { color: '#94a3b8' } } },
            legend: { data: companyNames, textStyle: { color: '#94a3b8' }, top: 0, itemWidth: 20, itemHeight: 10, itemGap: 24 },
            grid: { left: '3%', right: '4%', bottom: '3%', top: '15%', containLabel: true },
            xAxis: { type: 'category', boundaryGap: false, data: dash.years, axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } }, axisLabel: { color: '#94a3b8', fontSize: 13 }, axisTick: { show: false } },
            yAxis: { type: 'value', name: '标准数量（项）', nameTextStyle: { color: '#64748b', fontSize: 12 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.1)', type: 'dashed' } }, axisLabel: { color: '#64748b' } },
            series: currentGroups.map((rule, index) => {
                const color = GROUP_COLORS[rule.group] || '#6366f1';
                const emphasis = rule.group.includes('海信');
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
                    emphasis: { focus: 'series', scale: emphasis }
                };
            }),
            animationDuration: 1500,
            animationEasing: 'cubicInOut'
        }, true);
    }

    function renderMap(regionData) {
        const maxValue = Math.max(1, ...(regionData || []).map((item) => item.value || 0));
        fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json')
            .then((response) => response.json())
            .then((chinaJson) => {
                echarts.registerMap('china', chinaJson);
                charts.map.setOption({
                    tooltip: {
                        trigger: 'item',
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        borderColor: 'rgba(99, 102, 241, 0.3)',
                        textStyle: { color: '#e2e8f0' },
                        formatter: function (params) {
                            if (params.data && params.data.value) {
                                return `<div style="font-weight:600;margin-bottom:8px">${params.name}</div>
                                        <div>标准数量：<span style="color:#60a5fa;font-weight:700">${params.data.value}项</span></div>
                                        <div style="margin-top:6px">主要企业：${params.data.companies.join('、')}</div>`;
                            }
                            return `${params.name}<br/>暂无数据`;
                        }
                    },
                    visualMap: { min: 0, max: maxValue, left: 'left', top: 'bottom', text: ['高', '低'], textStyle: { color: '#94a3b8' }, inRange: { color: ['#1e293b', '#1e3a5f', '#2563eb', '#3b82f6', '#60a5fa'] }, calculable: true },
                    geo: { map: 'china', roam: false, zoom: 1.2, center: [105, 36], label: { show: true, color: '#94a3b8', fontSize: 11 }, emphasis: { label: { color: '#fff', fontSize: 13, fontWeight: 'bold' }, itemStyle: { areaColor: '#6366f1', shadowBlur: 20, shadowColor: 'rgba(99,102,241,0.5)' } }, itemStyle: { areaColor: '#1e293b', borderColor: 'rgba(99,102,241,0.3)', borderWidth: 1 } },
                    series: [{ name: '标准数量', type: 'map', geoIndex: 0, data: regionData || [] }],
                    animationDuration: 1500,
                    animationEasing: 'cubicInOut'
                }, true);
            })
            .catch((err) => {
                console.error('地图加载失败:', err);
                $('mapChart').innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;">地图数据加载中，请刷新页面重试...</div>';
            });
    }

    function renderConclusions(conclusions, dash, rows) {
        const list = conclusions && conclusions.length ? conclusions : fallbackConclusions(dash, rows);
        $('conclusionList').innerHTML = list.map((item) => `
            <li class="conclusion-item">
                <strong>${esc(item.title)}：</strong>${esc(item.text)}
            </li>`).join('');
    }

    // ---------- 实时分析任务 ----------
    function appendLog(entry) {
        const time = formatLocalTime(entry.time);
        const div = document.createElement('div');
        div.innerHTML = `<span class="log-time">${esc(time)}</span><span class="log-stage">${esc(entry.stage)}</span>${esc(entry.message)}`;
        $('progressLogs').appendChild(div);
        $('progressLogs').scrollTop = $('progressLogs').scrollHeight;
        updateProgress(entry);
    }

    function updateProgress(entry) {
        const stageBase = {
            '检索': 8, '领域过滤': 12, '起草单位补抓': 16, '详情补抓': 20, 'LLM 提取': 60, '合并': 96, '分析结论': 98
        };
        let percent = stageBase[entry.stage] || 0;
        const match = String(entry.message || '').match(/(\d+)\/(\d+)/);
        if (match) {
            const done = Number(match[1]);
            const total = Number(match[2]);
            if (entry.stage === '详情补抓') percent = 20 + (done / total) * 40;
            if (entry.stage === 'LLM 提取') percent = 60 + (done / total) * 35;
        }
        percent = Math.min(99, Math.max(percent, 1));
        $('progressFill').style.width = percent + '%';
        $('progressPercent').textContent = Math.round(percent) + '%';
    }

    function startAnalysis() {
        const config = buildConfig();
        if (!config.keywords.length) return showToast('请至少填写一个关键词', 'error');
        if (!config.types.length) return showToast('请至少选择一种标准类型', 'error');
        if (!config.groups.length) return showToast('请至少配置一个分析对象集团', 'error');
        if (location.protocol === 'file:') {
            showToast('静态模式：请运行 node std-crawler/serve-demo.mjs 后访问 http://127.0.0.1:5277', 'warn');
            return;
        }
        try { localStorage.setItem(LAST_CONFIG_KEY, JSON.stringify(config)); } catch { /* 忽略存储异常 */ }

        $('progressPanel').style.display = 'block';
        $('progressLogs').innerHTML = '';
        $('progressTitle').textContent = '实时分析中（真实爬取 + LLM）';
        $('progressFill').style.width = '2%';
        $('progressPercent').textContent = '2%';
        $('btnAnalyze').disabled = true;
        appendLog({ time: new Date().toISOString(), stage: '任务创建', message: `关键词「${config.keywords.join(' / ')}」类型「${config.types.join(' / ')}」${config.startDate}~${config.endDate}` });

        fetch(`${API_ROOT}/analyze`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(config),
        })
            .then((response) => response.json())
            .then((data) => {
                if (!data.ok || !data.jobId) throw new Error(data.error || '任务创建失败');
                return pollJob(data.jobId);
            })
            .then((result) => {
                $('progressTitle').textContent = '分析完成';
                $('progressFill').style.width = '100%';
                $('progressPercent').textContent = '100%';
                $('btnAnalyze').disabled = false;
                const groups = collectGroups();
                renderAll(
                    normalizeRows(result.rows),
                    {
                        source: '实时爬取（std.samr.gov.cn + LLM）',
                        collectedAt: formatLocalDate(result.collectedAt),
                        leadingRule: result.leadingRule,
                        reportTitle: result.reportTitle || `${(buildConfig().keywords || []).slice(0, 2).join('、')}领域标准竞争分析报告`,
                    },
                    { groupStats: result.groupStats, techAreas: result.techAreas, yearTrend: result.yearTrend, regionData: result.regionData, companyTrend: null, years: ['2021', '2022', '2023', '2024', '2025', '2026'], leadingRule: result.leadingRule },
                    result.conclusions,
                    groups
                );
                showToast(`实时分析完成：${result.rows.length} 条标准（LLM 结论 ${result.conclusions?.length ? '已生成' : '未生成'}）`, 'success');
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
                    };
                    renderDebugPanel(result.debug);
                } else {
                    $('debugPanel').style.display = 'none';
                }
            })
            .catch((err) => {
                $('btnAnalyze').disabled = false;
                $('progressTitle').textContent = '分析失败';
                appendLog({ time: new Date().toISOString(), stage: '错误', message: err.message });
                if (config.debug) {
                    lastDebug = { config, error: err.message, note: '任务失败阶段的完整诊断请查看服务端控制台日志（node serve-demo.mjs 输出）' };
                    renderDebugPanel(null);
                }
                showToast('实时分析失败：' + err.message, 'error');
            });
    }

    function renderDebugPanel(debug) {
        $('debugPanel').style.display = 'block';
        if (!debug || !debug.enabled) {
            $('debugContent').innerHTML = '<div class="debug-section">后端未返回调试信息：请确认已勾选「调试模式」并重新点击「开始实时分析」；任务失败时请查看服务端控制台输出。</div>';
            return;
        }
        const table = (rows) => rows && rows.length
            ? `<table><thead><tr>${Object.keys(rows[0]).map((k) => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${
                rows.map((row) => `<tr>${Object.values(row).map((value) => `<td>${esc(Array.isArray(value) ? value.join('、') : String(value ?? ''))}</td>`).join('')}</tr>`).join('')
            }</tbody></table>`
            : '<div style="padding:6px 0;color:#64748b">无</div>';
        const warnings = debug.warnings && debug.warnings.length
            ? `<div class="debug-warn">⚠️ ${debug.warnings.map(esc).join('<br/>')}</div>`
            : '<div style="color:#34d399">✓ 无警告</div>';
        const timings = Object.entries(debug.timings || {})
            .map(([name, ms]) => `${name}: ${(ms / 1000).toFixed(1)}s`)
            .join('　');
        $('debugContent').innerHTML = `
            <div class="debug-section"><details open><summary>概览与阶段耗时</summary>
                <div style="padding:8px 0;color:#94a3b8">阶段耗时：${esc(timings)}</div>
                ${warnings}
            </details></div>
            <div class="debug-section"><details><summary>检索命中（${(debug.search || []).length} 项）</summary>${table(debug.search)}</details></div>
            <div class="debug-section"><details><summary>领域过滤（保留 ${debug.filter?.kept} / 共 ${debug.filter?.total}，丢弃 ${(debug.filter?.dropped || []).length} 条并附原因）</summary>${table(debug.filter?.dropped)}</details></div>
            <div class="debug-section"><details><summary>行业标准起草单位补抓 hbba（${(debug.hbba || []).length} 条）</summary>${table(debug.hbba)}</details></div>
            <div class="debug-section"><details><summary>详情页补抓（${(debug.hydrate || []).length} 条，含状态/错误/键值数）</summary>${table(debug.hydrate)}</details></div>
            <div class="debug-section"><details><summary>LLM 结构化提取（${(debug.llm || []).length} 条，含状态/错误/标签/置信度）</summary>${table(debug.llm)}</details></div>
            <div class="debug-section"><details><summary>计划↔发布合并（${debug.merge?.before} → ${debug.merge?.after}）</summary><div style="padding:6px 0;color:#94a3b8">同标准号去重，优先保留已发布版</div></details></div>
            <div class="debug-section"><details><summary>原始调试 JSON</summary><pre>${esc(JSON.stringify(debug, null, 2))}</pre></details></div>`;
    }

    function exportDebugLog() {
        if (!lastDebug) return showToast('暂无调试信息：请勾选「调试模式」并完成一次分析', 'warn');
        const payload = { exportedAt: new Date().toISOString(), ...lastDebug };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `case8-debug-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
        showToast('调试日志已导出', 'success');
    }

    function pollJob(jobId) {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            let lastLogCount = 0;
            const timer = setInterval(() => {
                fetch(`${API_ROOT}/analyze/${jobId}`)
                    .then((response) => response.json())
                    .then((data) => {
                        if (Array.isArray(data.logs) && data.logs.length > lastLogCount) {
                            data.logs.slice(lastLogCount).forEach((entry) => appendLog(entry));
                            lastLogCount = data.logs.length;
                        }
                        if (data.status === 'done') {
                            clearInterval(timer);
                            resolve(data.result);
                        } else if (data.status === 'error') {
                            clearInterval(timer);
                            reject(new Error(data.error || '分析失败'));
                        }
                    })
                    .catch((err) => {
                        attempts += 1;
                        if (attempts > 10) {
                            clearInterval(timer);
                            reject(err);
                        }
                    });
            }, 2500);
        });
    }

    // ---------- 下钻 / 导出 ----------
    function openDrillModal(companyName) {
        const rows = currentRows.filter((row) => row.groups.includes(companyName));
        $('modalTitle').textContent = `${companyName} - 标准参与/主导明细（${rows.length} 项）`;
        $('standardsTableBody').innerHTML = rows.length
            ? rows.map((row) => `
                <tr>
                    <td style="color:#818cf8;font-weight:500"><a href="${row.url}" target="_blank" style="color:#818cf8;text-decoration:none">${row.standardNo}</a></td>
                    <td>${esc(row.title)}${row.scope ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${esc(row.scope)}</div>` : ''}</td>
                    <td>${row.techAreas.map(esc).join('、') || '—'}</td>
                    <td>${row.year}</td>
                    <td><span class="badge ${row.leadingGroup === companyName ? 'badge-dominant' : 'badge-participate'}">${row.leadingGroup === companyName ? '主导' : '参与'}</span></td>
                </tr>`).join('')
            : '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px">暂无公开起草单位数据</td></tr>';
        $('drillModal').classList.add('active');
    }

    function closeModal() {
        $('drillModal').classList.remove('active');
    }

    function exportExcel() {
        if (!currentRows.length) return showToast('暂无数据可导出', 'warn');
        const header = ['标准编号', '标准名称', '类型', '状态', '年份', '技术领域', '涉及企业集团', '牵头集团', '官方链接'];
        const lines = [header.join(',')];
        for (const row of currentRows) {
            lines.push([
                row.standardNo, `"${(row.title || '').replace(/"/g, '""')}"`, row.domain, row.status, row.year,
                `"${row.techAreas.join('、')}"`, `"${row.groups.join('、')}"`, row.leadingGroup || '', row.url
            ].join(','));
        }
        const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `保鲜领域标准竞争分析-原始数据-${currentMeta.collectedAt || 'demo'}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
        showToast('原始数据已导出（CSV/Excel 兼容）', 'success');
    }

    function exportPDF() {
        showToast('已进入打印视图，请选择“另存为 PDF”');
        window.print();
    }

    function showToast(message, type) {
        const toast = $('toast');
        toast.textContent = message;
        toast.className = 'toast show ' + (type || '');
        clearTimeout(toast._timer);
        toast._timer = setTimeout(() => { toast.className = 'toast'; }, 6000);
    }

    // ---------- 对外暴露 ----------
    window.startAnalysis = startAnalysis;
    window.addGroupRow = addGroupRow;
    window.removeGroupRow = removeGroupRow;
    window.openDrillModal = openDrillModal;
    window.closeModal = closeModal;
    window.exportExcel = exportExcel;
    window.exportPDF = exportPDF;
    window.saveConfig = saveConfig;
    window.loadConfig = loadConfig;
    window.deleteConfig = deleteConfig;
    window.exportDebugLog = exportDebugLog;

    // ---------- 初始化 ----------
    renderGroupTable();
    initCharts();
    loadHistory();
    renderHistorySelect();
    renderEmpty();
    try {
        const last = JSON.parse(localStorage.getItem(LAST_CONFIG_KEY) || 'null');
        if (last) applyConfig(last);
    } catch { /* 忽略 */ }

    $('drillModal').addEventListener('click', function (e) {
        if (e.target === this) closeModal();
    });

    // 检测本地服务：仅提示连接状态，不自动爬取（由用户点击“开始实时分析”触发）
    if (location.protocol !== 'file:') {
        fetch(`${API_ROOT}/health`, { cache: 'no-store' })
            .then((response) => response.json())
            .then((health) => {
                if (health.ok) {
                    $('serverStatus').textContent = `✓ 服务已连接（LLM ${health.llmConfigured ? '已启用' : '未配置'}），配置完成后点击「开始实时分析」`;
                } else {
                    $('serverStatus').textContent = '✗ 服务异常';
                }
            })
            .catch(() => {
                $('serverStatus').textContent = '✗ 未连接服务';
                $('staticNotice').style.display = 'block';
            });
    } else {
        $('serverStatus').textContent = '静态模式';
        $('staticNotice').style.display = 'block';
    }
})();
