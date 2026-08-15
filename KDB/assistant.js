(() => {
  const moduleLabels = { 'standard-drafting': '标准编写', standards: '标准', policies: '政策' };
  let selectedFile;
  let pollTimer;

  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
  const isPdf = file => file?.type === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf');
  const renderIcons = () => window.lucide?.createIcons();

  document.body.insertAdjacentHTML('beforeend', `
    <button class="kdb-fab" type="button" aria-label="打开知识助手" aria-expanded="false">
      <i data-lucide="sparkles"></i><span>知识助手</span>
    </button>
    <aside class="kdb-assistant" aria-label="KDB 知识助手" aria-hidden="true">
      <header class="kdb-assistant-header"><div><span class="kdb-assistant-kicker">KDB</span><strong>知识助手</strong><small>跨页面检索与文档入库</small></div><div><a href="/KDB/" title="打开知识库管理页"><i data-lucide="database"></i></a><button type="button" class="kdb-assistant-close" aria-label="关闭知识助手"><i data-lucide="x"></i></button></div></header>
      <div class="kdb-assistant-body">
        <form class="kdb-assistant-form">
          <div class="kdb-assistant-fields"><label>检索范围<select name="module"><option value="">全部知识库</option><option value="standard-drafting">标准编写</option><option value="standards">标准</option><option value="policies">政策</option></select></label></div>
          <textarea name="question" aria-label="知识库问题" placeholder="问标准、条款或政策问题" required></textarea>
          <button class="kdb-assistant-ask" type="submit"><i data-lucide="send-horizontal"></i>提问</button>
        </form>
        <section class="kdb-assistant-result is-empty" aria-live="polite"><i data-lucide="message-square-text"></i><p>在任何页面快速查询已入库的文档</p></section>
        <details class="kdb-assistant-upload"><summary><i data-lucide="file-up"></i><span>上传文档到知识库</span><i data-lucide="chevron-down"></i></summary><div><label class="kdb-file-picker"><input type="file" accept="application/pdf,.pdf,.docx,.txt,.md,.markdown,.csv,text/plain,text/markdown,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /><i data-lucide="paperclip"></i><span>选择 PDF、DOCX、TXT、Markdown 或 CSV</span><small>最大 30 MB</small></label><div class="kdb-upload-actions"><label>入库分区<select><option value="standard-drafting">标准编写</option><option value="standards" selected>标准</option><option value="policies">政策</option></select></label><button type="button" disabled><i data-lucide="upload-cloud"></i>入库</button></div><p class="kdb-upload-status">上传后将自动转换为可检索文本并更新索引。</p></div></details>
      </div>
    </aside>`);

  const shell = document.querySelector('.kdb-assistant');
  const fab = document.querySelector('.kdb-fab');
  const form = shell.querySelector('.kdb-assistant-form');
  const resultPanel = shell.querySelector('.kdb-assistant-result');
  const fileInput = shell.querySelector('.kdb-file-picker input');
  const fileLabel = shell.querySelector('.kdb-file-picker span');
  const uploadModule = shell.querySelector('.kdb-upload-actions select');
  const uploadButton = shell.querySelector('.kdb-upload-actions button');
  const uploadStatus = shell.querySelector('.kdb-upload-status');

  function setOpen(open) {
    shell.classList.toggle('is-open', open);
    shell.setAttribute('aria-hidden', String(!open));
    fab.setAttribute('aria-expanded', String(open));
    if (open) window.setTimeout(() => form.question.focus(), 180);
  }

  function renderResult(payload) {
    const citationsById = new Map((payload.citations || []).map(citation => [String(citation.id), citation]));
    const answer = escapeHtml(payload.answer).replace(/\[(\d+)\]/g, (marker, id) => citationsById.has(id)
      ? `<button class="kdb-citation-link" type="button" data-citation-id="${id}">${marker}</button>`
      : marker).replace(/\n/g, '<br>');
    resultPanel.classList.remove('is-empty');
    resultPanel.innerHTML = `<div class="kdb-result-label"><i data-lucide="sparkles"></i><span>${payload.mode === 'llm' ? '基于知识库生成' : '检索结果'}</span></div><p class="kdb-result-answer">${answer}</p><div class="kdb-citation-focus hidden"></div>`;
    resultPanel.querySelectorAll('.kdb-citation-link').forEach(button => button.addEventListener('click', () => {
      const citation = citationsById.get(button.dataset.citationId);
      if (!citation) return;
      const source = resultPanel.querySelector('.kdb-citation-focus');
      source.classList.remove('hidden');
      source.innerHTML = `<div><span>[${citation.id}]</span><strong>${escapeHtml(citation.title)}</strong><small>${escapeHtml(citation.heading || `片段 ${citation.chunk}`)}</small></div><button type="button" aria-label="关闭引用"><i data-lucide="x"></i></button><p>${escapeHtml(citation.excerpt)}</p>`;
      source.querySelector('button').addEventListener('click', () => source.classList.add('hidden'));
      renderIcons();
    }));
    renderIcons();
  }

  async function ask(event) {
    event.preventDefault();
    const question = form.question.value.trim();
    if (!question) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.innerHTML = '<i data-lucide="loader-circle"></i>检索中';
    renderIcons();
    try {
      const response = await fetch('/api/kb/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, module: form.elements.module.value || undefined }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '知识库问答失败');
      renderResult(payload);
    } catch (error) {
      resultPanel.classList.remove('is-empty');
      resultPanel.innerHTML = `<div class="kdb-result-error"><i data-lucide="circle-alert"></i>${escapeHtml(error.message)}</div>`;
      renderIcons();
    } finally {
      button.disabled = false;
      button.innerHTML = '<i data-lucide="send-horizontal"></i>提问';
      renderIcons();
    }
  }

  function setUploadStatus(message, error = false) {
    uploadStatus.textContent = message;
    uploadStatus.classList.toggle('is-error', error);
  }

  async function waitForJob(job) {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise(resolve => { pollTimer = window.setTimeout(resolve, 2_000); });
      const response = await fetch(`/api/jobs/${job.id}`);
      const current = await response.json();
      if (!response.ok) throw new Error(current.error || '无法读取 PDF 解析任务');
      if (current.state === 'done') return current;
      if (current.state === 'failed') throw new Error(current.error || 'PDF 解析失败');
      setUploadStatus(current.message || '正在解析 PDF 并更新索引');
    }
    throw new Error('PDF 解析超时');
  }

  async function upload() {
    if (!selectedFile) return;
    uploadButton.disabled = true;
    setUploadStatus(isPdf(selectedFile) ? 'PDF 已进入解析队列' : '正在转换文本并写入知识库');
    try {
      const response = await fetch(`/api/kb/ingest?module=${encodeURIComponent(uploadModule.value)}&filename=${encodeURIComponent(selectedFile.name)}`, { method: 'POST', headers: { 'Content-Type': selectedFile.type || 'application/octet-stream' }, body: selectedFile });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || '文档入库失败');
      if (payload.kind === 'pdf-job') {
        const job = await waitForJob(payload.job);
        if (job.kb?.error) throw new Error(job.kb.error);
        setUploadStatus(job.kb?.reused ? '知识库已有相同文本' : 'PDF 已完成解析并更新索引');
      } else {
        setUploadStatus(payload.reused ? '知识库已有相同文本' : `已写入 ${payload.document.chunkCount} 个检索片段`);
      }
      selectedFile = undefined;
      fileInput.value = '';
      fileLabel.textContent = '选择 PDF、DOCX、TXT、Markdown 或 CSV';
    } catch (error) {
      setUploadStatus(error.message, true);
    } finally {
      uploadButton.disabled = !selectedFile;
      renderIcons();
    }
  }

  fab.addEventListener('click', () => setOpen(!shell.classList.contains('is-open')));
  shell.querySelector('.kdb-assistant-close').addEventListener('click', () => setOpen(false));
  document.querySelectorAll('[data-kdb-assistant-open]').forEach(button => button.addEventListener('click', () => setOpen(true)));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setOpen(false); });
  form.addEventListener('submit', ask);
  fileInput.addEventListener('change', event => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) { setUploadStatus('文档不能超过 30 MB', true); return; }
    selectedFile = file;
    fileLabel.textContent = file.name;
    uploadButton.disabled = false;
    setUploadStatus(isPdf(file) ? 'PDF 将经过解析后入库。' : '文档将直接转换为文本入库。');
  });
  uploadButton.addEventListener('click', upload);
  window.addEventListener('pagehide', () => window.clearTimeout(pollTimer));
  renderIcons();
})();
