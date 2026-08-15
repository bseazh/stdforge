const state = {
  issues: [
    { severity: '高风险', title: '7.4.2 缺少判定依据', description: '条款包含检查要求，但未给出符合与不符合的判断条件，结果不可复现。', suggestion: '补充“检查结果应符合附录 A 表 A.1 的要求；任一安全项目不符合时，判定为不合格”。' },
    { severity: '建议修改', title: '5.2 表述存在模糊词', description: '“至少应满足”后的部分条件未给出可量化要求。', suggestion: '将模糊表述替换为明确的环境温度、湿度或设施要求。' },
    { severity: '建议修改', title: '引用文件版本待核验', description: 'GB/T 21667 的引用版本需要与标准库中的现行版本交叉核验。', suggestion: '保留日期引用并写入版本核验记录。' },
    { severity: '提示', title: '附录 A 表格字段不完整', description: '鉴定表中建议补充鉴定人员、日期和复核结论字段。', suggestion: '在附录 A 增加记录与复核字段。' }
  ]
};

function hydrateParsedStandard() {
  const parsed = window.STDFORGE_STANDARD?.standard;
  if (!parsed) return;
  document.querySelectorAll('[data-standard-number]').forEach(element => { element.textContent = parsed.number; });
  document.querySelectorAll('[data-standard-title]').forEach(element => { element.textContent = parsed.title; });
  document.querySelectorAll('[data-page-count]').forEach(element => { element.textContent = parsed.pageCount; });
  document.querySelectorAll('[data-block-count]').forEach(element => { element.textContent = parsed.blocks; });
}

const toast = document.querySelector('#toast');
function notify(message) {
  toast.querySelector('span').textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

function showView(id) {
  if (id === 'announcements') {
    window.location.assign('module2/index.html');
    return;
  }
  if (id === 'policies') {
    window.location.assign('module3/dist/index.html');
    return;
  }
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === id));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === id));
  document.querySelectorAll('.module-tab').forEach(item => item.classList.toggle('active', item.dataset.view === id));
  if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showPolicyStage(stage) {
  document.querySelectorAll('.policy-stage-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.policyStage === stage));
  document.querySelectorAll('.policy-stage').forEach(panel => panel.classList.toggle('active', panel.dataset.policyStagePanel === stage));
  document.querySelector('#policies').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

let moduleOneSourceText = '';
let moduleOneSourceName = '';
let moduleOneSourceItem = null;
let moduleOneTemplateText = '';
let moduleOneTemplateName = 'GB/T 1.1 常见章节结构（演示）';
let moduleOneTemplates = [];
let moduleOneTemplateItem = null;
let moduleOneUploadedTemplateUrl = '';
let moduleOneDrafts = {};
let moduleOneActiveOutput = 'standardDraft';
let moduleOneFeishuUrl = '';
let activeEditorSection = 'safety';

const editorOutlineSections = {
  preface: { label: '前言', title: '前言', body: '本文件按照 GB/T 1.1—2020 给出的规则起草。本演示稿由研发技术要求自动整理后形成，后续由标准化工程师确认。', subheading: '编制说明', detail: '本章节为固定演示文案，用于说明草案来源与人工确认责任。' },
  scope: { label: '1 范围', title: '1 范围', body: '本文件规定了二手洗衣机鉴定的技术要求、鉴定方法、鉴定结论与记录要求。本文件适用于进入二手流通环节的家用洗衣机。', subheading: '适用边界', detail: '不适用于无法安全通电、缺少关键部件或无法识别型号的产品。' },
  references: { label: '2 规范性引用文件', title: '2 规范性引用文件', body: '下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。凡是注日期的引用文件，仅所注日期的版本适用于本文件。', subheading: '引用清单', detail: 'GB/T 4706.1—2024 家用和类似用途电器的安全 第 1 部分：通用要求。' },
  terms: { label: '3 术语和定义', title: '3 术语和定义', body: '二手洗衣机：已进入使用或流通环节，经过检测、鉴定后可再次进入交易或再利用环节的洗衣机产品。', subheading: '鉴定结论', detail: '符合本文件技术要求的产品，鉴定结论为“合格”。' },
  process: { label: '4 鉴定流程和要求', title: '4 鉴定流程和要求', body: '鉴定应包括受理、信息核验、外观检查、安全检查、性能检查、结论判定和记录归档等步骤。', subheading: '流程记录', detail: '每个步骤应保留产品型号、检查人、检查时间和结论。' },
  conditions: { label: '5 鉴定作业条件', title: '5 鉴定作业条件', body: '鉴定场所应具备安全供电、通风、照明和必要的测试条件。环境温度宜为 15 ℃ 至 35 ℃。', subheading: '作业安全', detail: '鉴定前应确认产品断电状态，并检查电源线和接地条件。' },
  organization: { label: '6 鉴定机构和人员', title: '6 鉴定机构和人员', body: '鉴定机构应具备与鉴定活动相适应的场地、设备和质量管理能力。鉴定人员应经过相关培训并保留能力记录。', subheading: '复核要求', detail: '高风险问题应由复核人员独立确认后形成结论。' },
  requirements: { label: '7 鉴定技术要求', title: '7 鉴定技术要求', body: '产品应满足安全性、功能性和主要性能要求。每项检查应有明确的检查方法和判定依据。', subheading: '章节提示', detail: '点击“7.2 安全性检查”或“7.4 性能检查”查看对应条款。' },
  safety: { label: '7 鉴定技术要求', title: '7.2 安全性检查', body: '二手洗衣机的安全性应符合 GB/T 4706.1—2024 的规定。', subheading: '7.2.1 检查方法', detail: '请填写检查步骤、使用的仪器或引用的试验方法。', editable: true, alert: true },
  performance: { label: '7 鉴定技术要求', title: '7.4 性能检查', body: '洗涤、脱水、排水和控制功能应正常；运行过程中不应出现影响使用安全的异常噪声、振动或故障提示。', subheading: '7.4.1 检查方法', detail: '按产品使用说明书进行通电试运行，并记录功能检查结果。' },
  appendix: { label: '附录 A（规范性）', title: '附录 A 鉴定记录表', body: '鉴定记录应至少包括产品信息、外观检查、安全检查、性能检查、判定结论、鉴定人员和复核人员。', subheading: '记录要求', detail: '记录表应与本次鉴定任务唯一关联，并保留可追溯编号。' }
};

function moduleOneMarkdownHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || '';
    if (/^\|/.test(line) && /^\|?\s*:?-{3,}/.test(next)) {
      const header = line.split('|').slice(1, -1).map(value => '<th>' + escapeHtml(value.trim()) + '</th>').join('');
      output.push('<table><thead><tr>' + header + '</tr></thead><tbody>');
      index += 2;
      while (index < lines.length && /^\|/.test(lines[index])) {
        const cells = lines[index].split('|').slice(1, -1).map(value => '<td>' + escapeHtml(value.trim()) + '</td>').join('');
        output.push('<tr>' + cells + '</tr>');
        index += 1;
      }
      output.push('</tbody></table>');
      index -= 1;
    } else if (/^### /.test(line)) output.push('<h3>' + escapeHtml(line.slice(4)) + '</h3>');
    else if (/^## /.test(line)) output.push('<h2>' + escapeHtml(line.slice(3)) + '</h2>');
    else if (/^# /.test(line)) output.push('<h1>' + escapeHtml(line.slice(2)) + '</h1>');
    else if (line.trim()) output.push('<p>' + escapeHtml(line) + '</p>');
  }
  return output.join('');
}

function setModuleOneMode(mode) {
  const ai = mode === 'ai';
  document.querySelector('#moduleOneDraft').classList.toggle('hidden', !ai);
  document.querySelector('#clauseEditorWorkbench').classList.toggle('hidden', ai);
  document.querySelector('#standardEditorActions').classList.toggle('hidden', ai);
  document.querySelectorAll('[data-drafting-mode]').forEach(button => button.classList.toggle('active', button.dataset.draftingMode === mode));
}

function updateModuleOneDraftState() {
  const ready = Boolean(moduleOneSourceText);
  document.querySelector('#moduleOneGenerate').disabled = !ready;
  document.querySelector('#moduleOneDraftState').textContent = ready
    ? '已选择：' + moduleOneSourceName + ' · 模板：' + moduleOneTemplateName
    : '选择输入后会自动匹配行业模板，也可手动切换。';
  updateModuleOneComparison();
}

function previewMarkdownExcerpt(markdown, maxLength = 720) {
  const plain = String(markdown || '').replace(/^>.*$/gm, '').trim();
  return moduleOneMarkdownHtml(plain.slice(0, maxLength) + (plain.length > maxLength ? '\n\n…' : ''));
}

function updateModuleOneComparison() {
  const input = document.querySelector('#moduleOneInputComparison');
  const template = document.querySelector('#moduleOneTemplateComparison');
  const output = document.querySelector('#moduleOneOutputComparison');
  if (moduleOneSourceItem) {
    input.innerHTML = '<span class="comparison-type">DOCX 输入</span><strong>' + escapeHtml(moduleOneSourceItem.title) + '</strong><small>' + escapeHtml(moduleOneSourceItem.industry) + ' · ' + escapeHtml(moduleOneSourceItem.fileName) + '</small><article class="comparison-excerpt">' + previewMarkdownExcerpt(moduleOneSourceText) + '</article><button class="text-button" type="button" id="moduleOneOpenInputPreview"><i data-lucide="scan-text"></i>预览完整 DOCX 内容</button>';
    document.querySelector('#moduleOneOpenInputPreview').addEventListener('click', () => openModuleOnePreview(moduleOneSourceItem, moduleOneSourceText));
  }
  if (moduleOneTemplateItem) {
    template.innerHTML = '<span class="comparison-type">PDF 模板</span><strong>' + escapeHtml(moduleOneTemplateItem.title) + '</strong><small>' + escapeHtml(moduleOneTemplateItem.code || '上传模板') + ' · ' + escapeHtml(moduleOneTemplateItem.extraction || '已解析') + '</small><article class="comparison-excerpt">' + previewMarkdownExcerpt(moduleOneTemplateText) + '</article><button class="text-button" type="button" id="moduleOneOpenTemplatePreview"><i data-lucide="file-search"></i>预览原始 PDF</button>';
    document.querySelector('#moduleOneOpenTemplatePreview').addEventListener('click', () => openModuleOnePdfPreview(moduleOneTemplateItem));
  }
  if (moduleOneDrafts[moduleOneActiveOutput]) {
    const labels = { standardDraft: '标准草案', compilationNotes: '编制说明', preResearchReport: '预研报告' };
    output.innerHTML = '<span class="comparison-type">生成输出</span><strong>' + labels[moduleOneActiveOutput] + '</strong><small>基于已选输入与模板生成 · 待专家审核</small><article class="comparison-excerpt">' + previewMarkdownExcerpt(moduleOneDrafts[moduleOneActiveOutput]) + '</article><button class="text-button" type="button" id="moduleOneOpenOutput"><i data-lucide="arrow-down"></i>查看完整输出</button>';
    document.querySelector('#moduleOneOpenOutput').addEventListener('click', () => document.querySelector('#moduleOneOutput').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  lucide.createIcons();
}

async function selectModuleOneDemo(item, markdown) {
  moduleOneSourceText = markdown;
  moduleOneSourceName = item.fileName;
  moduleOneSourceItem = item;
  document.querySelectorAll('.module-one-demo-card').forEach(card => card.classList.toggle('active', card.dataset.demoId === item.id));
  if (item.defaultTemplateId && moduleOneTemplateItem?.id !== 'uploaded') await selectModuleOneReferenceTemplate(item.defaultTemplateId, { silent: true });
  updateModuleOneDraftState();
  notify('已选择研发输入：' + item.title);
}

function openModuleOnePreview(item, markdown) {
  document.querySelector('#moduleOnePreviewTitle').textContent = item.title;
  document.querySelector('#moduleOnePreviewBody').innerHTML = moduleOneMarkdownHtml(markdown);
  const download = document.querySelector('#moduleOnePreviewDownload');
  download.href = item.downloadUrl;
  download.download = item.fileName;
  document.querySelector('#moduleOnePreviewDialog').showModal();
  lucide.createIcons();
}

function openModuleOnePdfPreview(item) {
  const dialog = document.querySelector('#moduleOnePdfPreviewDialog');
  document.querySelector('#moduleOnePdfPreviewTitle').textContent = item.title;
  document.querySelector('#moduleOnePdfPreviewFrame').src = item.previewUrl + '#view=FitH';
  const download = document.querySelector('#moduleOnePdfPreviewDownload');
  download.href = item.downloadUrl || item.previewUrl;
  download.download = item.downloadName || item.fileName || 'reference-template.pdf';
  dialog.showModal();
  lucide.createIcons();
}

function renderModuleOneTemplateLibrary() {
  const library = document.querySelector('#moduleOneTemplateLibrary');
  library.innerHTML = moduleOneTemplates.map(item => '<article class="module-one-template-card' + (moduleOneTemplateItem?.id === item.id ? ' active' : '') + '" data-template-id="' + escapeHtml(item.id) + '"><small>' + escapeHtml(item.industry) + ' · ' + escapeHtml(item.pages) + ' 页</small><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.summary) + '</p><div class="module-one-template-meta"><span>' + escapeHtml(item.code) + '</span><span>' + escapeHtml(item.extraction) + '</span></div><div class="module-one-demo-actions"><button class="button secondary" type="button" data-template-preview>预览 PDF</button><button class="button primary" type="button" data-template-select>用作模板</button></div></article>').join('');
  library.querySelectorAll('.module-one-template-card').forEach(card => {
    const item = moduleOneTemplates.find(candidate => candidate.id === card.dataset.templateId);
    card.querySelector('[data-template-preview]').addEventListener('click', () => openModuleOnePdfPreview(item));
    card.querySelector('[data-template-select]').addEventListener('click', () => void selectModuleOneReferenceTemplate(item.id));
  });
  lucide.createIcons();
}

async function selectModuleOneReferenceTemplate(id, { silent = false } = {}) {
  const item = moduleOneTemplates.find(candidate => candidate.id === id);
  if (!item) return;
  try {
    const response = await fetch(item.textUrl);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '模板文本读取失败');
    moduleOneTemplateText = result.text;
    moduleOneTemplateName = item.code + '《' + item.title + '》';
    moduleOneTemplateItem = item;
    renderModuleOneTemplateLibrary();
    updateModuleOneDraftState();
    if (!silent) notify('已选参考模板：' + item.code);
  } catch (error) {
    notify(error.message);
  }
}

async function loadModuleOneTemplates() {
  const library = document.querySelector('#moduleOneTemplateLibrary');
  try {
    const response = await fetch('/api/reference-templates');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '参考模板加载失败');
    moduleOneTemplates = payload.templates || [];
    renderModuleOneTemplateLibrary();
  } catch (error) {
    library.innerHTML = '<p class="draft-loading">参考模板加载失败：' + escapeHtml(error.message) + '</p>';
  }
}

async function loadModuleOneDemos() {
  const grid = document.querySelector('#moduleOneDemoGrid');
  try {
    const response = await fetch('/api/demo-inputs');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '演示输入加载失败');
    moduleOneTemplateText = payload.template?.text || '';
    moduleOneTemplateName = payload.template?.name || moduleOneTemplateName;
    grid.innerHTML = payload.inputs.map(item => '<article class="module-one-demo-card" data-demo-id="' + escapeHtml(item.id) + '"><small>' + escapeHtml(item.industry) + '</small><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.summary) + '</p><div class="module-one-demo-actions"><button class="button secondary" type="button" data-demo-preview>预览</button><button class="button primary" type="button" data-demo-select>选择</button></div></article>').join('');
    grid.querySelectorAll('.module-one-demo-card').forEach(card => {
      const item = payload.inputs.find(candidate => candidate.id === card.dataset.demoId);
      const readPreview = async () => {
        const response = await fetch(item.previewUrl);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '文档预览读取失败');
        return result.markdown;
      };
      card.querySelector('[data-demo-preview]').addEventListener('click', async () => {
        try { openModuleOnePreview(item, await readPreview()); } catch (error) { notify(error.message); }
      });
      card.querySelector('[data-demo-select]').addEventListener('click', async () => {
        try { await selectModuleOneDemo(item, await readPreview()); } catch (error) { notify(error.message); }
      });
    });
    updateModuleOneDraftState();
  } catch (error) {
    grid.innerHTML = '<p class="draft-loading">演示输入加载失败：' + escapeHtml(error.message) + '</p>';
  }
}

async function pollModuleOneTemplate(jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 1500));
    const response = await fetch('/api/jobs/' + jobId);
    const job = await response.json();
    if (job.state === 'done') return job.markdown || '';
    if (job.state === 'failed') throw new Error(job.error || '参考 PDF 解析失败');
    document.querySelector('#moduleOneTemplateStatus').textContent = job.message || '正在解析参考 PDF…';
  }
  throw new Error('参考 PDF 解析超时');
}

async function parseModuleOneTemplate() {
  const file = document.querySelector('#moduleOneTemplateFile').files?.[0];
  if (!file) return;
  const button = document.querySelector('#moduleOneParseTemplate');
  button.disabled = true;
  document.querySelector('#moduleOneTemplateStatus').textContent = '正在提交 MinerU 解析…';
  try {
    const response = await fetch('/api/parse?module=standards&filename=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || '参考 PDF 解析失败');
    moduleOneTemplateText = await pollModuleOneTemplate(job.id);
    moduleOneTemplateName = file.name;
    moduleOneTemplateItem = { id: 'uploaded', title: file.name, code: '本次上传', extraction: 'MinerU 已解析', previewUrl: moduleOneUploadedTemplateUrl || URL.createObjectURL(file), downloadUrl: moduleOneUploadedTemplateUrl || URL.createObjectURL(file), downloadName: file.name };
    document.querySelector('#moduleOneTemplateStatus').textContent = '模板已提取：' + file.name + '，生成时将按其章节结构组织输出。';
    updateModuleOneComparison();
    updateModuleOneDraftState();
    notify('参考 PDF 已解析为模板');
  } catch (error) {
    document.querySelector('#moduleOneTemplateStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderModuleOneOutput() {
  document.querySelector('#moduleOneMarkdown').innerHTML = moduleOneMarkdownHtml(moduleOneDrafts[moduleOneActiveOutput] || '');
  document.querySelectorAll('[data-module-one-output]').forEach(button => button.classList.toggle('active', button.dataset.moduleOneOutput === moduleOneActiveOutput));
  document.querySelector('#moduleOneSyncFeishu').disabled = !moduleOneDrafts.standardDraft;
  updateModuleOneComparison();
}

async function generateModuleOneDrafts() {
  if (!moduleOneSourceText) return notify('请先选择一份研发技术要求');
  const button = document.querySelector('#moduleOneGenerate');
  button.disabled = true;
  document.querySelector('#moduleOneProgress').classList.remove('hidden');
  try {
    const response = await fetch('/api/drafts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceName: moduleOneSourceName, sourceText: moduleOneSourceText, templateName: moduleOneTemplateName, templateText: moduleOneTemplateText })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '草案生成失败');
    moduleOneDrafts = { standardDraft: result.standardDraft, compilationNotes: result.compilationNotes, preResearchReport: result.preResearchReport };
    moduleOneActiveOutput = 'standardDraft';
    moduleOneFeishuUrl = '';
    document.querySelector('#moduleOneOpenFeishu').classList.add('hidden');
    document.querySelector('#moduleOneOutput').classList.remove('hidden');
    renderModuleOneOutput();
    notify(result.mode === 'llm' ? 'LLM 已生成三类草案' : '已生成三类演示草案');
  } catch (error) {
    notify(error.message);
  } finally {
    document.querySelector('#moduleOneProgress').classList.add('hidden');
    updateModuleOneDraftState();
  }
}

function downloadModuleOneDraft() {
  const content = moduleOneDrafts[moduleOneActiveOutput];
  if (!content) return;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = moduleOneActiveOutput + '-' + moduleOneSourceName.replace(/\.[^.]+$/, '') + '.md';
  link.click();
  URL.revokeObjectURL(url);
}

async function syncModuleOneDraftToFeishu() {
  const markdown = moduleOneDrafts.standardDraft;
  if (!markdown) return notify('请先生成标准草案');
  const button = document.querySelector('#moduleOneSyncFeishu');
  button.disabled = true;
  const originalContent = button.innerHTML;
  button.innerHTML = '<i data-lucide="loader-circle"></i>正在同步到飞书';
  lucide.createIcons();
  try {
    const response = await fetch('/api/drafts/sync/feishu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceName: moduleOneSourceName, templateName: moduleOneTemplateName, markdown })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '同步飞书失败');
    moduleOneFeishuUrl = result.docUrl;
    const link = document.querySelector('#moduleOneOpenFeishu');
    link.href = moduleOneFeishuUrl;
    link.classList.remove('hidden');
    notify('草案已追加到飞书文档，可打开后在线协同编辑');
  } catch (error) {
    notify(error.message || '同步飞书失败');
  } finally {
    button.disabled = !moduleOneDrafts.standardDraft;
    button.innerHTML = originalContent;
    lucide.createIcons();
  }
}

function renderEditorSection(sectionId) {
  const section = editorOutlineSections[sectionId];
  if (!section) return;
  activeEditorSection = sectionId;
  document.querySelectorAll('[data-editor-section]').forEach(button => button.classList.toggle('active', button.dataset.editorSection === sectionId));
  document.querySelector('#editorSectionLabel').textContent = section.label;
  document.querySelector('#editorSectionTitle').textContent = section.title;
  const editor = document.querySelector('#clauseEditor');
  editor.value = section.body;
  editor.readOnly = !section.editable;
  document.querySelector('#editorSubheading').textContent = section.subheading;
  document.querySelector('#editorPlaceholder').textContent = section.detail;
  document.querySelector('#editorAlert').classList.toggle('hidden', !section.alert);
  document.querySelector('#applySuggestion').classList.toggle('hidden', !section.editable);
  document.querySelector('#editorReadonlyNote').classList.toggle('hidden', Boolean(section.editable));
}

function renderIssue(index) {
  const issue = state.issues[index];
  if (!issue) return;
  document.querySelectorAll('.issue-row').forEach(row => row.classList.toggle('selected', Number(row.dataset.issue) === index));
  document.querySelector('#issueDetail').innerHTML = `
    <span class="status ${issue.severity === '高风险' ? 'red' : 'amber'}">${issue.severity}</span>
    <h3>${issue.title}</h3>
    <p>${issue.description}</p>
    <div class="proposal"><span>AI 建议</span><p>${issue.suggestion}</p></div>
    <div class="source-ref"><i data-lucide="link"></i><span>依据：GB/T 1.1—2020，技术要求应可验证</span></div>
    <button class="button primary full" id="resolveIssue"><i data-lucide="check"></i>采纳并关闭问题</button>`;
  lucide.createIcons();
  document.querySelector('#resolveIssue').addEventListener('click', resolveIssue);
}

function resolveIssue() {
  const selected = document.querySelector('.issue-row.selected');
  if (selected) selected.remove();
  const count = Math.max(0, Number(document.querySelector('#issueCount').textContent) - 1);
  document.querySelector('#issueCount').textContent = count;
  document.querySelector('.review-tabs button b').textContent = count;
  document.querySelector('#issueDetail').innerHTML = `<span class="status teal">已关闭</span><h3>问题已纳入修订</h3><p>系统已将建议写入修订草稿，并记录采纳人、时间和依据。可继续处理下一条审核意见。</p><div class="source-ref"><i data-lucide="git-compare-arrows"></i><span>已生成 1 条修订留痕</span></div>`;
  lucide.createIcons();
  notify('已采纳建议并生成修订留痕');
}

function setFlowStage(stage) {
  const steps = document.querySelectorAll('.flow-step');
  const lines = document.querySelectorAll('.flow-line');
  steps.forEach((step, index) => {
    step.classList.toggle('complete', index < stage);
    step.classList.toggle('current', index === stage);
  });
  lines.forEach((line, index) => line.classList.toggle('complete', index < stage));
}

document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('.module-tab').forEach(item => item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('#showStandard').forEach(button => button.addEventListener('click', () => showView('standards')));
document.querySelectorAll('#showAnnouncements').forEach(button => button.addEventListener('click', () => showView('announcements')));
document.querySelectorAll('#showPolicies').forEach(button => button.addEventListener('click', () => showView('policies')));
document.querySelectorAll('.issue-row').forEach(row => row.addEventListener('click', () => { showView('standards'); setModuleOneMode('editor'); renderIssue(Number(row.dataset.issue)); }));
document.querySelectorAll('[data-drafting-mode]').forEach(button => button.addEventListener('click', () => setModuleOneMode(button.dataset.draftingMode)));
document.querySelector('#moduleOneTemplateFile').addEventListener('change', event => {
  const file = event.target.files?.[0];
  document.querySelector('#moduleOneParseTemplate').disabled = !file;
  if (file) {
    if (moduleOneUploadedTemplateUrl) URL.revokeObjectURL(moduleOneUploadedTemplateUrl);
    moduleOneUploadedTemplateUrl = URL.createObjectURL(file);
    moduleOneTemplateItem = { id: 'uploaded', title: file.name, code: '本次上传', extraction: '等待解析', previewUrl: moduleOneUploadedTemplateUrl, downloadUrl: moduleOneUploadedTemplateUrl, downloadName: file.name };
    document.querySelector('#moduleOneTemplateStatus').textContent = '已选择模板：' + file.name + '，点击“解析上传模板”。';
    updateModuleOneComparison();
  }
});
document.querySelector('#moduleOneParseTemplate').addEventListener('click', parseModuleOneTemplate);
document.querySelector('#moduleOneGenerate').addEventListener('click', generateModuleOneDrafts);
document.querySelector('#moduleOneDownload').addEventListener('click', downloadModuleOneDraft);
document.querySelector('#moduleOneSyncFeishu').addEventListener('click', syncModuleOneDraftToFeishu);
document.querySelectorAll('[data-module-one-output]').forEach(button => button.addEventListener('click', () => {
  moduleOneActiveOutput = button.dataset.moduleOneOutput;
  renderModuleOneOutput();
}));
document.querySelectorAll('[data-editor-section]').forEach(button => button.addEventListener('click', () => renderEditorSection(button.dataset.editorSection)));
document.querySelector('#moduleOnePreviewClose').addEventListener('click', () => document.querySelector('#moduleOnePreviewDialog').close());
document.querySelector('#moduleOnePreviewDismiss').addEventListener('click', () => document.querySelector('#moduleOnePreviewDialog').close());
document.querySelector('#moduleOnePdfPreviewClose').addEventListener('click', () => document.querySelector('#moduleOnePdfPreviewDialog').close());
document.querySelector('#moduleOnePdfPreviewDismiss').addEventListener('click', () => document.querySelector('#moduleOnePdfPreviewDialog').close());
document.querySelector('#runAudit').addEventListener('click', () => { setFlowStage(2); notify('规范性审核完成：发现 4 个待处理问题'); });
document.querySelector('#refreshSignals').addEventListener('click', () => notify('已同步 12 条标准公告与组织信息'));
document.querySelector('#collectSource').addEventListener('click', () => notify('已采集公开元数据并写入来源留痕'));
document.querySelectorAll('.policy-stage-tab').forEach(tab => tab.addEventListener('click', () => showPolicyStage(tab.dataset.policyStage)));
document.querySelector('#startPolicyCollection').addEventListener('click', () => {
  showPolicyStage('discover');
  notify('已开始从工信部等官方来源采集政策（演示数据）');
});
document.querySelector('#goToClassification').addEventListener('click', () => {
  showPolicyStage('classify');
  notify('已确认 3 条候选政策，等待人工确认分类');
});
document.querySelector('#backToDiscover').addEventListener('click', () => showPolicyStage('discover'));
document.querySelector('#confirmClassification').addEventListener('click', () => {
  showPolicyStage('interpret');
  notify('政策分类已确认：国家级 · 产业政策');
});
document.querySelectorAll('.analysis-type').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.analysis-type').forEach(item => item.classList.toggle('active', item === button));
}));
document.querySelector('#generatePolicyReport').addEventListener('click', () => {
  const audience = escapeHtml(document.querySelector('#analysisAudience').value.trim() || '标准化管理组');
  const clauseMode = document.querySelector('.analysis-type.active').dataset.reportType === 'clause';
  const report = document.querySelector('#analysisReport');
  report.innerHTML = clauseMode
    ? `<div class="report-content"><span class="status teal">条款拆解型 · 已生成</span><h3>绿色智能家电消费实施方案</h3><p>政策将绿色智能家电纳入消费升级重点，要求以旧换新与能效提升协同推进。与现有标准工作直接相关的内容已提取为可复核条目。</p><div class="report-points"><div><span>关联要求</span><strong>绿色产品供给</strong></div><div><span>标准影响</span><strong>能效与品质分级</strong></div><div><span>建议动作</span><strong>补充关联矩阵</strong></div></div><div class="report-evidence"><strong>原文依据</strong><br>“推进绿色智能家电以旧换新，鼓励高效节能产品消费。”</div></div>`
    : `<div class="report-content"><span class="status teal">专家解读型 · 已生成</span><h3>面向 ${audience} 的政策解读</h3><p>政策为绿色智能家电的品质升级、能效提升与循环流通提出明确导向。建议将政策要求映射到鉴定、分级和回收记录，形成标准修订评估依据。</p><div class="report-points"><div><span>适用对象</span><strong>家电生产、回收与鉴定企业</strong></div><div><span>主要机会</span><strong>绿色智能产品消费升级</strong></div><div><span>建议动作</span><strong>建立政策-条款映射</strong></div></div><div class="report-evidence"><strong>原文依据 · 3 处</strong><br>“推进绿色智能家电以旧换新，鼓励高效节能产品消费。”</div></div>`;
  lucide.createIcons();
  notify('已生成带原文依据的政策分析报告');
});
document.querySelector('#backToInterpret').addEventListener('click', () => showPolicyStage('interpret'));
document.querySelector('#sendPolicyReport').addEventListener('click', () => notify('报告已推送至 3 位已选接收人，并生成发送记录'));
document.querySelector('#openPolicySchedule').addEventListener('click', () => notify('定时更新计划：每周一 09:00（演示配置）'));
document.querySelector('#addComment').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  const originalContent = button.innerHTML;
  button.innerHTML = '<i data-lucide="loader-circle"></i>发送通知中';
  lucide.createIcons();
  try {
    const response = await fetch('/api/notifications/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '邮件通知发送失败');
    setFlowStage(3);
    notify(`已发起专家评审，邮件通知已投递至 ${result.accepted} 个配置收件人`);
  } catch (error) {
    notify(error.message || '邮件通知发送失败，请检查服务端配置');
  } finally {
    button.disabled = false;
    button.innerHTML = originalContent;
    lucide.createIcons();
  }
});
document.querySelector('#saveClause').addEventListener('click', () => {
  if (!editorOutlineSections[activeEditorSection].editable) return notify('当前章节为固定演示文案，无需保存修订');
  notify('条款 v0.3 已保存，修订留痕已更新');
});
document.querySelector('#applySuggestion').addEventListener('click', () => {
  if (!editorOutlineSections[activeEditorSection].editable) return;
  document.querySelector('#clauseEditor').value += ' 检查结果应符合附录 A 表 A.1 的要求。';
  notify('已应用 AI 建议，请人工确认后保存');
});

const dialog = document.querySelector('#importDialog');
document.querySelector('#standardFile').addEventListener('change', event => {
  const label = document.querySelector('.dropzone strong');
  if (event.target.files[0]) label.textContent = event.target.files[0].name;
});
document.querySelector('#importStandard').addEventListener('click', event => {
  event.preventDefault();
  dialog.close();
  setFlowStage(1);
  notify('文件已入库：正在识别目录、条款、表格和引用文件');
});

hydrateParsedStandard();
setModuleOneMode('ai');
renderEditorSection(activeEditorSection);
loadModuleOneTemplates();
loadModuleOneDemos();
const initialView = window.location.hash.slice(1);
if (['workspace', 'standards', 'announcements', 'policies'].includes(initialView)) showView(initialView);
lucide.createIcons();
