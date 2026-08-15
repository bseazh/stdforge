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
  feishuBar: document.querySelector('#feishuBar'), feishuDocUrl: document.querySelector('#feishuDocUrl'), syncFeishu: document.querySelector('#syncFeishu'), feishuMessage: document.querySelector('#feishuMessage'), submitApproval: document.querySelector('#submitApproval'), approvalLink: document.querySelector('#approvalLink'), checkApproval: document.querySelector('#checkApproval')
};

let selectedFile;
let previewUrl;
let currentJob;
let pollTimer;

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

function selectFile(file) {
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) return notify('请选择 PDF 文件');
  if (file.size > 30 * 1024 * 1024) return notify('PDF 文件不能超过 30 MB');
  selectedFile = file;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  elements.pdfPreview.src = previewUrl;
  elements.previewContainer.classList.remove('empty');
  elements.dropzone.classList.add('hidden');
  elements.fileSummary.classList.remove('hidden');
  elements.fileName.textContent = file.name;
  elements.fileMeta.textContent = `${formatBytes(file.size)} · PDF 文档`;
  elements.fileState.textContent = '准备就绪';
  elements.parseButton.disabled = false;
  elements.resetButton.disabled = false;
}

function reset() {
  selectedFile = undefined;
  currentJob = undefined;
  window.clearTimeout(pollTimer);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  elements.fileInput.value = '';
  elements.pdfPreview.removeAttribute('src');
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
  elements.submitApproval.classList.add('hidden');
  elements.approvalLink.classList.add('hidden');
  elements.checkApproval.classList.add('hidden');
  elements.fileState.textContent = '未选择';
  elements.parseButton.disabled = true;
  elements.resetButton.disabled = true;
  elements.parseButton.innerHTML = '<i data-lucide="scan-text"></i>开始解析';
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
  if (state === 'done') return 100;
  return 0;
}

function updateProgress(job) {
  const value = progressFor(job.state, job.progress);
  const labels = { queued: '任务已创建', uploading: '正在上传', 'waiting-file': '等待文件', pending: '等待解析', running: '正在解析', converting: '正在整理', downloading: '正在下载结果', done: '解析完成' };
  elements.progressTitle.textContent = labels[job.state] || '处理中';
  elements.progressMessage.textContent = job.message || '请稍候';
  elements.progressValue.textContent = `${value}%`;
  elements.progressBar.style.width = `${value}%`;
  const stageIndex = value < 25 ? 0 : value < 40 ? 1 : value < 86 ? 2 : 3;
  document.querySelectorAll('.stages span').forEach((stage, index) => stage.classList.toggle('active', index <= stageIndex));
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[character]);
}

function renderMarkdown(markdown) {
  const html = escapeHtml(markdown)
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^!\[[^\]]*\]\([^\)]+\)\s*$/gm, '<p>[解析图片见完整结果包]</p>')
    .replace(/^(?!<h[1-3]>)(.+)$/gm, '<p>$1</p>')
    .replace(/<p>\s*<\/p>/g, '');
  elements.renderedResult.innerHTML = html;
  elements.sourceResult.textContent = markdown;
}

function showDone(job) {
  renderMarkdown(job.markdown || '');
  elements.resultEmpty.classList.add('hidden');
  elements.errorPanel.classList.add('hidden');
  elements.renderedResult.classList.remove('hidden');
  elements.sourceResult.classList.add('hidden');
  elements.downloadBar.classList.remove('hidden');
  elements.feishuBar.classList.remove('hidden');
  if (job.feishuSync) elements.submitApproval.classList.remove('hidden');
  if (job.feishuApproval) showApproval(job.feishuApproval);
  elements.downloadOriginal.href = `/api/jobs/${job.id}/download/original`;
  elements.downloadMarkdown.href = `/api/jobs/${job.id}/download/markdown`;
  elements.downloadArchive.href = `/api/jobs/${job.id}/download/archive`;
  elements.resultMeta.textContent = `${job.markdown.length.toLocaleString()} 字符 · MinerU VLM`;
  elements.fileState.textContent = '解析完成';
  elements.parseButton.disabled = false;
  elements.parseButton.innerHTML = '<i data-lucide="check"></i>解析完成';
  lucide.createIcons();
  notify('PDF 解析完成');
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
    elements.feishuMessage.textContent = result.reused ? '该解析任务已同步到此文档' : '同步成功，已以追加方式写入';
    currentJob.feishuSync = result;
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
    const response = await fetch(`/api/parse?filename=${encodeURIComponent(selectedFile.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: selectedFile });
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

fetch('/api/health').then(response => response.json()).then(health => {
  elements.serverState.className = `server-state ${health.ok && health.mineruConfigured ? 'ready' : 'error'}`;
  elements.serverState.querySelector('em').textContent = health.mineruConfigured ? (health.feishuConfigured ? 'MinerU / 飞书已连接' : 'MinerU 已连接，飞书未配置') : '缺少 MinerU 配置';
}).catch(() => {
  elements.serverState.className = 'server-state error';
  elements.serverState.querySelector('em').textContent = '解析服务不可用';
});

lucide.createIcons();
