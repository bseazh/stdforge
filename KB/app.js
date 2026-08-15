const elements = {
  serverState: document.querySelector('#serverState'), stats: document.querySelector('#stats'), modelState: document.querySelector('#modelState'),
  answer: document.querySelector('#answer'), citations: document.querySelector('#citations'), questionForm: document.querySelector('#questionForm'),
  question: document.querySelector('#question'), questionModule: document.querySelector('#questionModule'), askButton: document.querySelector('#askButton'),
  fileInput: document.querySelector('#fileInput'), fileLabel: document.querySelector('#fileLabel'), uploadModule: document.querySelector('#uploadModule'),
  uploadButton: document.querySelector('#uploadButton'), uploadStatus: document.querySelector('#uploadStatus'), documentList: document.querySelector('#documentList'),
  refreshDocuments: document.querySelector('#refreshDocuments'), toast: document.querySelector('#toast')
};

const moduleLabels = { 'standard-drafting': '标准编写', standards: '标准', policies: '政策' };
let selectedFile;

function notify(message) {
  elements.toast.querySelector('span').textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => elements.toast.classList.remove('visible'), 2600);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function formatDate(value) {
  if (!value) return '未知时间';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value));
}

function isPdf(file) {
  return file?.type === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf');
}

function setUploadState(message, isError = false) {
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.classList.toggle('error', isError);
}

function renderStats(stats) {
  const values = Object.entries(stats.modules || {}).map(([module, value]) => `<span><b>${value.documents}</b>${moduleLabels[module]}</span>`).join('');
  elements.stats.innerHTML = `${values}<span><b>${stats.documents || 0}</b>全部文档</span>`;
}

function renderDocuments(documents) {
  if (!documents.length) {
    elements.documentList.innerHTML = '<div class="documents-empty"><i data-lucide="folder-search-2"></i><span>尚无已入库文档</span></div>';
    lucide.createIcons();
    return;
  }
  elements.documentList.innerHTML = documents.map(document => `
    <article class="document-row">
      <i data-lucide="file-text"></i>
      <div><strong>${escapeHtml(document.title)}</strong><small>${moduleLabels[document.module]} · ${document.chunkCount} 个片段 · ${formatDate(document.importedAt)}</small></div>
    </article>`).join('');
  lucide.createIcons();
}

async function loadDocuments() {
  const response = await fetch('/api/kb/documents');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '无法加载知识库文档');
  renderDocuments(result.documents);
}

async function loadHealth() {
  const response = await fetch('/api/health');
  const health = await response.json();
  if (!response.ok) throw new Error('服务健康检查失败');
  elements.serverState.className = 'server-state ready';
  elements.serverState.querySelector('em').textContent = health.llmConfigured ? 'LLM 问答已连接' : '检索服务已连接';
  elements.modelState.textContent = health.llmConfigured ? 'LLM 已连接' : '检索模式';
  renderStats(health.knowledgeBase);
}

function renderAnswer(result) {
  elements.answer.classList.remove('empty');
  elements.answer.innerHTML = `<div class="answer-label"><i data-lucide="sparkles"></i><span>${result.mode === 'llm' ? '基于知识库生成' : '知识库检索结果'}</span></div><p>${escapeHtml(result.answer).replace(/\n/g, '<br>')}</p>`;
  elements.citations.classList.toggle('hidden', !result.citations?.length);
  elements.citations.innerHTML = (result.citations || []).map(citation => `
    <article class="citation"><span>[${citation.id}]</span><div><strong>${escapeHtml(citation.title)}</strong><small>${moduleLabels[citation.module]} · ${escapeHtml(citation.heading || `片段 ${citation.chunk}`)}</small><p>${escapeHtml(citation.excerpt)}</p></div></article>`).join('');
  lucide.createIcons();
}

async function askQuestion(event) {
  event.preventDefault();
  const question = elements.question.value.trim();
  if (!question) return;
  elements.askButton.disabled = true;
  elements.askButton.innerHTML = '<i data-lucide="loader-circle"></i>检索中';
  lucide.createIcons();
  try {
    const response = await fetch('/api/kb/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, module: elements.questionModule.value || undefined })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '知识库问答失败');
    renderAnswer(result);
  } catch (error) {
    notify(error.message);
  } finally {
    elements.askButton.disabled = false;
    elements.askButton.innerHTML = '<i data-lucide="send-horizontal"></i>提问';
    lucide.createIcons();
  }
}

async function waitForPdfJob(job) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    const response = await fetch(`/api/jobs/${job.id}`);
    const current = await response.json();
    if (!response.ok) throw new Error(current.error || '无法读取解析任务');
    if (current.state === 'done') return current;
    if (current.state === 'failed') throw new Error(current.error || 'PDF 解析失败');
    setUploadState(current.message || '正在解析 PDF 并建立索引');
  }
  throw new Error('PDF 解析超时');
}

async function uploadFile() {
  if (!selectedFile) return;
  const module = elements.uploadModule.value;
  elements.uploadButton.disabled = true;
  setUploadState(isPdf(selectedFile) ? '正在提交 PDF 解析任务' : '正在提取文本并建立索引');
  try {
    let result;
    if (isPdf(selectedFile)) {
      const response = await fetch(`/api/parse?module=${encodeURIComponent(module)}&filename=${encodeURIComponent(selectedFile.name)}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: selectedFile });
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || '无法创建 PDF 解析任务');
      result = await waitForPdfJob(job);
      if (result.kb?.error) throw new Error(result.kb.error);
      setUploadState(result.kb?.reused ? '知识库已有相同文本' : 'PDF 已解析并写入知识库');
    } else {
      const response = await fetch(`/api/kb/imports?module=${encodeURIComponent(module)}&filename=${encodeURIComponent(selectedFile.name)}`, { method: 'POST', headers: { 'Content-Type': selectedFile.type || 'application/octet-stream' }, body: selectedFile });
      result = await response.json();
      if (!response.ok) throw new Error(result.error || '无法写入知识库');
      setUploadState(result.reused ? '知识库已有相同文本' : '文档已转换为文本并写入知识库');
    }
    selectedFile = undefined;
    elements.fileInput.value = '';
    elements.fileLabel.textContent = '选择文档';
    await Promise.all([loadHealth(), loadDocuments()]);
    notify('知识库索引已更新');
  } catch (error) {
    setUploadState(error.message, true);
  } finally {
    elements.uploadButton.disabled = !selectedFile;
  }
}

elements.questionForm.addEventListener('submit', askQuestion);
elements.fileInput.addEventListener('change', event => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 30 * 1024 * 1024) { setUploadState('文档不能超过 30 MB', true); return; }
  selectedFile = file;
  elements.fileLabel.textContent = file.name;
  elements.uploadButton.disabled = false;
  setUploadState(isPdf(file) ? 'PDF 将先解析为 Markdown，再写入知识库。' : '文档将直接提取为文本并写入知识库。');
});
elements.uploadButton.addEventListener('click', uploadFile);
elements.refreshDocuments.addEventListener('click', () => loadDocuments().catch(error => notify(error.message)));

Promise.all([loadHealth(), loadDocuments()]).catch(error => {
  elements.serverState.className = 'server-state error';
  elements.serverState.querySelector('em').textContent = '知识库服务不可用';
  notify(error.message);
});
lucide.createIcons();
