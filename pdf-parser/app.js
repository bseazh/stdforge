const elements = {
  fileInput: document.querySelector('#fileInput'), dropzone: document.querySelector('#dropzone'), fileSummary: document.querySelector('#fileSummary'),
  fileName: document.querySelector('#fileName'), fileMeta: document.querySelector('#fileMeta'), fileState: document.querySelector('#fileState'),
  previewContainer: document.querySelector('#previewContainer'), pdfPreview: document.querySelector('#pdfPreview'), parseButton: document.querySelector('#parseButton'),
  resetButton: document.querySelector('#resetButton'), removeFile: document.querySelector('#removeFile'), progressPanel: document.querySelector('#progressPanel'),
  progressTitle: document.querySelector('#progressTitle'), progressMessage: document.querySelector('#progressMessage'), progressValue: document.querySelector('#progressValue'),
  progressBar: document.querySelector('#progressBar'), resultEmpty: document.querySelector('#resultEmpty'), renderedResult: document.querySelector('#renderedResult'),
  sourceResult: document.querySelector('#sourceResult'), errorPanel: document.querySelector('#errorPanel'), errorMessage: document.querySelector('#errorMessage'),
  downloadBar: document.querySelector('#downloadBar'), downloadOriginal: document.querySelector('#downloadOriginal'), downloadMarkdown: document.querySelector('#downloadMarkdown'),
  downloadArchive: document.querySelector('#downloadArchive'), resultMeta: document.querySelector('#resultMeta'), serverState: document.querySelector('#serverState'), toast: document.querySelector('#toast'),
  feishuBar: document.querySelector('#feishuBar'), feishuDocUrl: document.querySelector('#feishuDocUrl'), syncFeishu: document.querySelector('#syncFeishu'), openFeishuDoc: document.querySelector('#openFeishuDoc'), feishuMessage: document.querySelector('#feishuMessage'), submitApproval: document.querySelector('#submitApproval'), approvalLink: document.querySelector('#approvalLink'), checkApproval: document.querySelector('#checkApproval'),
  kbModule: document.querySelector('#kbModule'), fileBadge: document.querySelector('#fileBadge'), previewMessage: document.querySelector('#previewMessage'), kbResult: document.querySelector('#kbResult'),
  demoInputsGrid: document.querySelector('#demoInputsGrid'), previewModal: document.querySelector('#previewModal'), previewTitle: document.querySelector('#previewTitle'), previewBody: document.querySelector('#previewBody'), previewDownload: document.querySelector('#previewDownload'), closePreviewButton: document.querySelector('#closePreviewButton'),
  draftModeNote: document.querySelector('#draftModeNote'), templateFileInput: document.querySelector('#templateFileInput'), templateState: document.querySelector('#templateState'), parseTemplateButton: document.querySelector('#parseTemplateButton'), generateDraftButton: document.querySelector('#generateDraftButton'), draftProgress: document.querySelector('#draftProgress'), draftProgressText: document.querySelector('#draftProgressText'), draftResult: document.querySelector('#draftResult'), draftMarkdown: document.querySelector('#draftMarkdown'), downloadDraftButton: document.querySelector('#downloadDraftButton')
};

let selectedFile;
let previewUrl;
let currentJob;
let pollTimer;
let currentSourceText = '';
let currentSourceName = '';
let currentTemplateText = '';
let currentTemplateName = 'GB/T 1.1 常见章节结构（演示）';
let generatedDrafts = {};
let activeDraftTab = 'standardDraft';

const lastFeishuDocumentKey = 'stdforge.lastFeishuDocumentUrl';

function rememberFeishuDocument(docUrl) {
  if (!docUrl) return;
  elements.feishuDocUrl.value = docUrl;
  elements.openFeishuDoc.href = docUrl;
  elements.openFeishuDoc.classList.remove('hidden');
  localStorage.setItem(lastFeishuDocumentKey, docUrl);
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function notify(message) {
  elements.toast.querySelector('span').textContent = message;
  elements.toast.classList.add('visible');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => elements.toast.classList.remove('visible'), 2500);
}

function extensionFor(file) {
  const match = file?.name?.match(/(\.[^.]+)$/);
  return match ? match[1].toLowerCase() : '';
}

function isPdf(file) {
  return file?.type === 'application/pdf' || extensionFor(file) === '.pdf';
}

function selectFile(file) {
  if (!file) return;
  const extension = extensionFor(file);
  if (!['.pdf', '.docx', '.txt', '.md', '.markdown', '.csv'].includes(extension)) return notify('请选择 PDF、DOCX、TXT、Markdown 或 CSV 文件');
  if (file.size > 30 * 1024 * 1024) return notify('文档不能超过 30 MB');
  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  if (isPdf(file)) {
    previewUrl = URL.createObjectURL(file);
    elements.pdfPreview.src = previewUrl;
    elements.previewContainer.classList.remove('empty');
    elements.previewMessage.textContent = 'PDF 预览';
  } else {
    previewUrl = undefined;
    elements.pdfPreview.removeAttribute('src');
    elements.previewContainer.classList.add('empty');
    elements.previewMessage.textContent = '将提取文本并写入知识库';
  }
  elements.dropzone.classList.add('hidden');
  elements.fileSummary.classList.remove('hidden');
  elements.fileBadge.textContent = extension.replace('.', '').toUpperCase();
  elements.fileName.textContent = file.name;
  elements.fileMeta.textContent = `${formatBytes(file.size)} · ${isPdf(file) ? 'PDF 结构化解析' : '文本提取入库'}`;
  elements.fileState.textContent = '准备就绪';
  elements.parseButton.disabled = false;
  elements.parseButton.innerHTML = isPdf(file) ? '<i data-lucide="scan-text"></i>开始解析' : '<i data-lucide="database-zap"></i>提取并入库';
  elements.resetButton.disabled = false;
  lucide.createIcons();
}

function reset() {
  selectedFile = undefined;
  currentJob = undefined;
  window.clearTimeout(pollTimer);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  elements.fileInput.value = '';
  elements.pdfPreview.removeAttribute('src');
  elements.previewMessage.textContent = 'PDF 预览';
  elements.previewContainer.classList.add('empty');
  elements.dropzone.classList.remove('hidden');
  elements.fileSummary.classList.add('hidden');
  elements.progressPanel.classList.add('hidden');
  elements.resultEmpty.classList.remove('hidden');
  elements.renderedResult.classList.add('hidden');
  elements.sourceResult.classList.add('hidden');
  elements.errorPanel.classList.add('hidden');
  elements.downloadBar.classList.add('hidden');
  elements.feishuBar.classList.add('hidden');
  elements.openFeishuDoc.classList.add('hidden');
  elements.submitApproval.classList.add('hidden');
  elements.approvalLink.classList.add('hidden');
  elements.checkApproval.classList.add('hidden');
  elements.fileState.textContent = '未选择';
  elements.kbResult.textContent = '';
  elements.parseButton.disabled = true;
  elements.resetButton.disabled = true;
  elements.parseButton.innerHTML = '<i data-lucide="scan-text"></i>开始解析';
  currentSourceText = '';
  currentSourceName = '';
  generatedDrafts = {};
  elements.draftResult.classList.add('hidden');
  updateDraftAvailability();
  lucide.createIcons();
}

function progressFor(state, progress) {
  if (state === 'queued') return 5;
  if (state === 'uploading') return 15;
  if (state === 'waiting-file' || state === 'pending') return 30;
  if (state === 'running') {
    if (progress?.total_pages) return Math.min(82, 35 + Math.round(progress.extracted_pages / progress.total_pages * 47));
    return 58;
  }
  if (state === 'converting' || state === 'downloading') return 88;
  if (state === 'indexing') return 96;
  if (state === 'done') return 100;
  return 0;
}

function updateProgress(job) {
  const value = progressFor(job.state, job.progress);
  const labels = { queued: '任务已创建', uploading: '正在上传', 'waiting-file': '等待文件', pending: '等待解析', running: '正在解析', converting: '正在整理', downloading: '正在下载结果', indexing: '正在更新知识库索引', done: '解析完成' };
  elements.progressTitle.textContent = labels[job.state] || '处理中';
  elements.progressMessage.textContent = job.message || '请稍候';
  elements.progressValue.textContent = `${value}%`;
  elements.progressBar.style.width = `${value}%`;
  const stageIndex = value < 25 ? 0 : value < 40 ? 1 : value < 86 ? 2 : value < 94 ? 3 : 4;
  document.querySelectorAll('.stages span').forEach((stage, index) => stage.classList.toggle('active', index <= stageIndex));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[character]);
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const html = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || '';
    if (/^\|/.test(line) && /^\|?\s*:?-{3,}/.test(next)) {
      const headers = line.split('|').slice(1, -1).map(value => `<th>${escapeHtml(value.trim())}</th>`).join('');
      html.push(`<table><thead><tr>${headers}</tr></thead><tbody>`);
      index += 2;
      while (index < lines.length && /^\|/.test(lines[index])) {
        const cells = lines[index].split('|').slice(1, -1).map(value => `<td>${escapeHtml(value.trim())}</td>`).join('');
        html.push(`<tr>${cells}</tr>`);
        index += 1;
      }
      html.push('</tbody></table>');
      index -= 1;
      continue;
    }
    const escaped = escapeHtml(line);
    if (/^### /.test(line)) html.push(`<h3>${escaped.slice(4)}</h3>`);
    else if (/^## /.test(line)) html.push(`<h2>${escaped.slice(3)}</h2>`);
    else if (/^# /.test(line)) html.push(`<h1>${escaped.slice(2)}</h1>`);
    else if (/^\s*[-*] /.test(line)) html.push(`<p>${escaped.replace(/^\s*[-*] /, '• ')}</p>`);
    else if (/^\s*\d+\. /.test(line)) html.push(`<p>${escaped}</p>`);
    else if (escaped.trim()) html.push(`<p>${escaped}</p>`);
  }
  return html.join('');
}

function renderMarkdown(markdown) {
  elements.renderedResult.innerHTML = markdownToHtml(markdown);
  elements.sourceResult.textContent = markdown;
}

function updateDraftAvailability() {
  elements.generateDraftButton.disabled = !currentSourceText;
  elements.draftModeNote.textContent = currentSourceText ? `${currentSourceName} · 模板：${currentTemplateName}` : '等待选择研发输入';
}

function openPreview(item, markdown) {
  elements.previewTitle.textContent = item.title;
  elements.previewBody.innerHTML = markdownToHtml(markdown);
  elements.previewDownload.href = item.downloadUrl;
  elements.previewDownload.download = item.fileName;
  elements.previewModal.classList.remove('hidden');
  lucide.createIcons();
}

function closePreview() {
  elements.previewModal.classList.add('hidden');
}

async function loadDemoInputs() {
  try {
    const response = await fetch('/api/demo-inputs');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '演示输入加载失败');
    currentTemplateText = result.template?.text || '';
    currentTemplateName = result.template?.name || currentTemplateName;
    elements.demoInputsGrid.innerHTML = result.inputs.map(item => `
      <article class="demo-card" data-demo-id="${escapeHtml(item.id)}">
        <span class="demo-type">${escapeHtml(item.industry)}</span>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.summary)}</p>
        <div class="demo-card-actions"><button class="button secondary demo-preview" type="button">预览</button><button class="button primary demo-load" type="button">载入演示</button></div>
      </article>`).join('');
    elements.demoInputsGrid.querySelectorAll('.demo-card').forEach(card => {
      const item = result.inputs.find(candidate => candidate.id === card.dataset.demoId);
      card.querySelector('.demo-preview').addEventListener('click', async () => {
        const preview = await fetch(item.previewUrl).then(response => response.json());
        if (preview.markdown) openPreview(item, preview.markdown);
      });
      card.querySelector('.demo-load').addEventListener('click', async () => {
        const preview = await fetch(item.previewUrl).then(response => response.json());
        if (!preview.markdown) return notify('演示输入读取失败');
        currentSourceText = preview.markdown;
        currentSourceName = item.fileName;
        const fileResponse = await fetch(item.downloadUrl);
        const blob = await fileResponse.blob();
        selectFile(new File([blob], item.fileName, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
        elements.templateState.textContent = `已选择默认模板：${currentTemplateName}`;
        updateDraftAvailability();
        notify(`已载入：${item.title}`);
      });
    });
  } catch (error) {
    elements.demoInputsGrid.innerHTML = `<div class="demo-loading">演示输入加载失败：${escapeHtml(error.message)}</div>`;
  }
}

async function pollTemplateJob(jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 1500));
    const response = await fetch(`/api/jobs/${jobId}`);
    const job = await response.json();
    if (job.state === 'done') return job.markdown || '';
    if (job.state === 'failed') throw new Error(job.error || '参考 PDF 解析失败');
    elements.templateState.textContent = job.message || '正在解析参考 PDF…';
  }
  throw new Error('参考 PDF 解析超时');
}

async function parseTemplate() {
  const file = elements.templateFileInput.files?.[0];
  if (!file) return;
  elements.parseTemplateButton.disabled = true;
  elements.templateState.textContent = '正在提交 MinerU 解析…';
  try {
    const response = await fetch(`/api/parse?module=standards&filename=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || '参考 PDF 解析失败');
    currentTemplateText = await pollTemplateJob(job.id);
    currentTemplateName = file.name;
    elements.templateState.textContent = `模板已提取：${file.name}，生成时将按其章节和字段组织输出`;
    updateDraftAvailability();
    notify('参考 PDF 已解析为模板');
  } catch (error) {
    elements.templateState.textContent = error.message;
  } finally {
    elements.parseTemplateButton.disabled = false;
  }
}

function renderActiveDraft() {
  elements.draftMarkdown.innerHTML = markdownToHtml(generatedDrafts[activeDraftTab] || '');
  document.querySelectorAll('[data-draft-tab]').forEach(tab => tab.classList.toggle('active', tab.dataset.draftTab === activeDraftTab));
}

async function generateDraft() {
  if (!currentSourceText) return notify('请先从演示输入库载入一份研发技术要求');
  elements.generateDraftButton.disabled = true;
  elements.draftProgress.classList.remove('hidden');
  try {
    const response = await fetch('/api/drafts/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceName: currentSourceName, sourceText: currentSourceText, templateName: currentTemplateName, templateText: currentTemplateText }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '草案生成失败');
    generatedDrafts = { standardDraft: result.standardDraft, compilationNotes: result.compilationNotes, preResearchReport: result.preResearchReport };
    activeDraftTab = 'standardDraft';
    renderActiveDraft();
    elements.draftResult.classList.remove('hidden');
    elements.draftProgressText.textContent = result.mode === 'llm' ? `LLM 已生成 · ${result.model}` : '演示映射已生成 · 当前未使用 LLM 或 LLM 暂不可用';
    notify(result.mode === 'llm' ? '三类草案生成完成' : '三类演示草案已生成');
  } catch (error) {
    elements.draftProgressText.textContent = error.message;
  } finally {
    elements.draftProgress.classList.add('hidden');
    updateDraftAvailability();
  }
}

function downloadCurrentDraft() {
  const content = generatedDrafts[activeDraftTab];
  if (!content) return;
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${activeDraftTab}-${currentSourceName.replace(/\.[^.]+$/, '')}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function showDone(job) {
  renderMarkdown(job.markdown || '');
  currentSourceText = job.markdown || '';
  currentSourceName = job.fileName || selectedFile?.name || 'source.pdf';
  updateDraftAvailability();
  elements.resultEmpty.classList.add('hidden');
  elements.errorPanel.classList.add('hidden');
  elements.renderedResult.classList.remove('hidden');
  elements.sourceResult.classList.add('hidden');
  elements.downloadBar.classList.remove('hidden');
  elements.feishuBar.classList.remove('hidden');
  if (job.feishuSync) {
    rememberFeishuDocument(job.feishuSync.docUrl);
    elements.submitApproval.classList.remove('hidden');
  }
  if (job.feishuApproval) showApproval(job.feishuApproval);
  elements.downloadOriginal.href = `/api/jobs/${job.id}/download/original`;
  elements.downloadMarkdown.href = `/api/jobs/${job.id}/download/markdown`;
  elements.downloadArchive.href = `/api/jobs/${job.id}/download/archive`;
  elements.resultMeta.textContent = `${job.markdown.length.toLocaleString()} 字符 · MinerU VLM`;
  elements.kbResult.textContent = job.kb?.error ? `知识库更新失败：${job.kb.error}` : job.kb?.document ? `已入库：${job.kb.document.chunkCount} 个检索片段 · ${job.kb.document.module}` : '';
  elements.fileState.textContent = '解析完成';
  elements.parseButton.disabled = false;
  elements.parseButton.innerHTML = '<i data-lucide="check"></i>解析完成';
  lucide.createIcons();
  notify('PDF 解析完成');
}

function showImportedDocument(result) {
  const document = result.document;
  currentSourceText = result.text || '';
  currentSourceName = document.fileName || selectedFile?.name || 'source.docx';
  updateDraftAvailability();
  elements.progressPanel.classList.add('hidden');
  elements.resultEmpty.classList.add('hidden');
  elements.errorPanel.classList.add('hidden');
  elements.renderedResult.innerHTML = `<h2>文本已写入知识库</h2><p>${escapeHtml(document.title)}</p><p>分区：${escapeHtml(document.module)}；已生成 ${document.chunkCount} 个检索片段。</p><p>文档内容已保存为 Markdown 文本，并可用于后续检索问答。</p>`;
  elements.renderedResult.classList.remove('hidden');
  elements.sourceResult.classList.add('hidden');
  elements.downloadBar.classList.add('hidden');
  elements.feishuBar.classList.add('hidden');
  elements.fileState.textContent = '已入库';
  elements.parseButton.disabled = false;
  elements.parseButton.innerHTML = '<i data-lucide="check"></i>已入库';
  lucide.createIcons();
  notify(result.reused ? '知识库已有相同文本' : '文本已入库并完成索引');
}

async function syncToFeishu() {
  const docUrl = elements.feishuDocUrl.value.trim();
  if (!currentJob?.id) return;
  if (!docUrl) return notify('请先粘贴飞书文档链接');
  elements.syncFeishu.disabled = true;
  elements.feishuMessage.textContent = '正在读取并追加解析结果';
  try {
    const response = await fetch(`/api/jobs/${currentJob.id}/sync/feishu`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ docUrl }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '飞书同步失败');
    elements.feishuMessage.textContent = result.reused ? '该解析任务已同步到此文档，可在线协同编辑后发起审查' : '同步成功，可在线协同编辑后发起审查';
    currentJob.feishuSync = result;
    rememberFeishuDocument(docUrl);
    elements.submitApproval.classList.remove('hidden');
    elements.syncFeishu.innerHTML = '<i data-lucide="check"></i>已同步';
    lucide.createIcons();
    notify('解析结果已同步到飞书文档');
  } catch (error) {
    elements.feishuMessage.textContent = error.message;
    elements.syncFeishu.disabled = false;
  }
}

function showApproval(approval) {
  elements.submitApproval.classList.add('hidden');
  if (approval.approvalUrl) {
    elements.approvalLink.href = approval.approvalUrl;
    elements.approvalLink.classList.remove('hidden');
  } else {
    elements.approvalLink.classList.add('hidden');
  }
  elements.checkApproval.classList.remove('hidden');
  elements.feishuMessage.textContent = `审批已创建：${approval.status || 'PENDING'}。${approval.approvalEntry || ''}`;
}

function defaultStandardNo() {
  const source = (selectedFile?.name || currentJob?.fileName || '').replace(/[_-]/g, ' ');
  return source.match(/(?:GB\/?T|GBT)\s*\d+(?:\s*[-—]\s*\d{4})?/i)?.[0] || source.replace(/\.pdf$/i, '');
}

async function submitApproval() {
  if (!currentJob?.id || !currentJob.feishuSync) return;
  elements.submitApproval.disabled = true;
  elements.feishuMessage.textContent = '正在创建飞书审批实例';
  try {
    const fileBaseName = (selectedFile?.name || currentJob.fileName).replace(/\.pdf$/i, '');
    const response = await fetch(`/api/jobs/${currentJob.id}/approval/feishu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standardNo: defaultStandardNo(), standardName: fileBaseName })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '创建飞书审批失败');
    currentJob.feishuApproval = result;
    showApproval(result);
    notify('飞书审批已创建');
  } catch (error) {
    elements.feishuMessage.textContent = error.message;
    elements.submitApproval.disabled = false;
  }
}

async function checkApproval() {
  if (!currentJob?.id) return;
  elements.checkApproval.disabled = true;
  try {
    const response = await fetch(`/api/jobs/${currentJob.id}/approval/feishu`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '查询审批结果失败');
    currentJob.feishuApproval = result;
    showApproval(result);
    notify(`审批状态：${result.status}`);
  } catch (error) {
    elements.feishuMessage.textContent = error.message;
  } finally {
    elements.checkApproval.disabled = false;
  }
}

function showError(message, retryable = false) {
  elements.progressPanel.classList.add('hidden');
  elements.resultEmpty.classList.add('hidden');
  elements.errorPanel.classList.remove('hidden');
  elements.errorMessage.textContent = message;
  elements.fileState.textContent = retryable ? '结果下载失败' : '解析失败';
  elements.parseButton.disabled = false;
  elements.parseButton.innerHTML = retryable ? '<i data-lucide="refresh-cw"></i>重新解析' : '<i data-lucide="refresh-cw"></i>重试解析';
  lucide.createIcons();
}

async function pollJob() {
  try {
    const response = await fetch(`/api/jobs/${currentJob.id}`);
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || '任务查询失败');
    currentJob = job;
    updateProgress(job);
    if (job.state === 'done') return showDone(job);
    if (job.state === 'failed') return showError(job.error || 'MinerU 解析失败', job.retryable === true);
    pollTimer = window.setTimeout(pollJob, 1800);
  } catch (error) {
    showError(error.message);
  }
}

async function parseFile() {
  if (!selectedFile) return;
  window.clearTimeout(pollTimer);
  elements.parseButton.disabled = true;
  elements.progressPanel.classList.remove('hidden');
  elements.resultEmpty.classList.add('hidden');
  elements.renderedResult.classList.add('hidden');
  elements.sourceResult.classList.add('hidden');
  elements.errorPanel.classList.add('hidden');
  elements.downloadBar.classList.add('hidden');
  updateProgress({ state: 'queued', message: '正在创建解析任务' });
  try {
    if (!isPdf(selectedFile)) {
      updateProgress({ state: 'indexing', message: '正在提取文本并建立检索索引' });
      const response = await fetch(`/api/kb/imports?module=${encodeURIComponent(elements.kbModule.value)}&filename=${encodeURIComponent(selectedFile.name)}`, { method: 'POST', headers: { 'Content-Type': selectedFile.type || 'application/octet-stream' }, body: selectedFile });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '无法写入知识库');
      return showImportedDocument(result);
    }
    const response = await fetch(`/api/parse?module=${encodeURIComponent(elements.kbModule.value)}&filename=${encodeURIComponent(selectedFile.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: selectedFile });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || '无法创建解析任务');
    currentJob = job;
    updateProgress(job);
    pollJob();
  } catch (error) {
    showError(error.message);
  }
}

elements.fileInput.addEventListener('change', event => selectFile(event.target.files[0]));
elements.dropzone.addEventListener('dragover', event => { event.preventDefault(); elements.dropzone.classList.add('dragging'); });
elements.dropzone.addEventListener('dragleave', () => elements.dropzone.classList.remove('dragging'));
elements.dropzone.addEventListener('drop', event => { event.preventDefault(); elements.dropzone.classList.remove('dragging'); selectFile(event.dataTransfer.files[0]); });
elements.parseButton.addEventListener('click', parseFile);
elements.resetButton.addEventListener('click', reset);
elements.removeFile.addEventListener('click', reset);
elements.syncFeishu.addEventListener('click', syncToFeishu);
elements.submitApproval.addEventListener('click', submitApproval);
elements.checkApproval.addEventListener('click', checkApproval);
document.querySelectorAll('.view-tabs button').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.view-tabs button').forEach(tab => tab.classList.toggle('active', tab === button));
  const sourceMode = button.dataset.mode === 'source';
  elements.renderedResult.classList.toggle('hidden', sourceMode);
  elements.sourceResult.classList.toggle('hidden', !sourceMode);
}));
document.querySelectorAll('[data-close-preview]').forEach(button => button.addEventListener('click', closePreview));
elements.closePreviewButton.addEventListener('click', closePreview);
elements.templateFileInput.addEventListener('change', () => {
  const file = elements.templateFileInput.files?.[0];
  elements.parseTemplateButton.disabled = !file;
  if (file) elements.templateState.textContent = `已选择模板：${file.name}，点击“解析为模板”`;
});
elements.parseTemplateButton.addEventListener('click', parseTemplate);
elements.generateDraftButton.addEventListener('click', generateDraft);
elements.downloadDraftButton.addEventListener('click', downloadCurrentDraft);
document.querySelectorAll('[data-draft-tab]').forEach(tab => tab.addEventListener('click', () => {
  activeDraftTab = tab.dataset.draftTab;
  if (activeDraftTab) renderActiveDraft();
}));

fetch('/api/health').then(response => response.json()).then(health => {
  elements.serverState.className = `server-state ${health.ok ? 'ready' : 'error'}`;
  const kbCount = health.knowledgeBase?.documents || 0;
  elements.serverState.querySelector('em').textContent = health.mineruConfigured ? `MinerU 已连接 · KDB ${kbCount} 份文档` : `知识库可用 · 缺少 MinerU 配置`;
}).catch(() => {
  elements.serverState.className = 'server-state error';
  elements.serverState.querySelector('em').textContent = '解析服务不可用';
});

loadDemoInputs();

const lastFeishuDocumentUrl = localStorage.getItem(lastFeishuDocumentKey);
if (lastFeishuDocumentUrl) elements.feishuDocUrl.value = lastFeishuDocumentUrl;

lucide.createIcons();
