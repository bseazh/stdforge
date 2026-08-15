const statusResult = document.querySelector('#statusResult');
const sendButton = document.querySelector('#sendTest');
const sendHint = document.querySelector('#sendHint');
const activityLog = document.querySelector('#activityLog');
const accessToken = document.querySelector('#accessToken');
const unlockButton = document.querySelector('#unlockRecipients');
const recipientList = document.querySelector('#recipientList');
const recipientStatus = document.querySelector('#recipientStatus');
const recipientLimit = document.querySelector('#recipientLimit');
const addRecipientForm = document.querySelector('#addRecipientForm');
const newRecipient = document.querySelector('#newRecipient');
const addRecipientButton = document.querySelector('#addRecipient');

const state = { smtpReady: false, unlocked: false, recipients: [], limit: 10 };

function setStatus(style, title, detail) {
  statusResult.className = `status-result ${style}`;
  statusResult.innerHTML = `<span class="status-dot"></span><div><strong>${title}</strong><small>${detail}</small></div>`;
}

function addLog(kind, title, detail) {
  const item = document.createElement('li');
  item.className = kind;
  const marker = document.createElement('span');
  const content = document.createElement('div');
  const heading = document.createElement('strong');
  const description = document.createElement('small');
  heading.textContent = title;
  description.textContent = detail;
  content.append(heading, description);
  item.append(marker, content);
  activityLog.prepend(item);
}

function apiHeaders() {
  return { 'Content-Type': 'application/json', 'x-stdforge-test-token': accessToken.value.trim() };
}

function selectedRecipients() {
  return [...recipientList.querySelectorAll('input:checked')].map(input => input.value);
}

function updateSendState() {
  const selected = selectedRecipients();
  sendButton.disabled = !(state.smtpReady && state.unlocked && selected.length);
  document.querySelector('#selectedSummary').textContent = selected.length ? `已选择 ${selected.length} 个收件人` : '未选择收件人';
  if (state.unlocked && !selected.length) sendHint.textContent = '请至少勾选一个测试收件人。';
}

function renderRecipients() {
  recipientList.replaceChildren();
  if (!state.recipients.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-list';
    empty.textContent = '暂无测试收件人，请添加一个邮箱。';
    recipientList.append(empty);
  } else {
    state.recipients.forEach(email => {
      const label = document.createElement('label');
      label.className = 'recipient-row';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = email;
      checkbox.checked = true;
      checkbox.addEventListener('change', updateSendState);
      const text = document.createElement('span');
      text.textContent = email;
      label.append(checkbox, text);
      recipientList.append(label);
    });
  }
  recipientStatus.textContent = `${state.recipients.length} 个已加载`;
  recipientLimit.textContent = `最多 ${state.limit} 个`;
  newRecipient.disabled = false;
  addRecipientButton.disabled = false;
  updateSendState();
}

async function readResponse(response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
  return result;
}

async function checkStatus() {
  state.smtpReady = false;
  updateSendState();
  setStatus('loading', '正在检测服务端配置', '请求 GET /api/health');
  try {
    const result = await readResponse(await fetch('/api/health', { cache: 'no-store' }));
    if (result.smtpConfigured && result.smtpTestManagementConfigured) {
      state.smtpReady = true;
      setStatus('ready', 'SMTP 已配置，可以执行测试', '测试收件人与发信操作需要管理验证码。');
      sendHint.textContent = state.unlocked ? '请选择测试收件人后发送。' : '请输入管理验证码以加载收件人。';
      addLog('success', 'SMTP 状态检查通过', '服务端邮件配置和测试管理保护均已启用。');
    } else {
      const message = result.smtpConfigured ? '邮件测试授权码尚未配置。' : 'SMTP 环境变量尚未配置。';
      setStatus('failed', '邮件测试服务未就绪', message);
      sendHint.textContent = '请检查线上服务的邮件测试配置。';
      addLog('error', 'SMTP 状态检查未通过', message);
    }
  } catch (error) {
    setStatus('failed', '无法连接邮件服务', error.message || '请求 /api/health 失败。');
    sendHint.textContent = '请确认页面与 API 网关均可访问。';
    addLog('error', '服务状态检查失败', error.message || '请求 /api/health 失败。');
  }
  updateSendState();
}

async function unlockRecipients() {
  const token = accessToken.value.trim();
  if (!token) {
    sendHint.textContent = '请输入管理验证码。';
    accessToken.focus();
    return;
  }
  unlockButton.disabled = true;
  unlockButton.textContent = '校验中...';
  try {
    const result = await readResponse(await fetch('/api/notifications/test-recipients', { headers: apiHeaders() }));
    state.recipients = result.recipients;
    state.limit = result.limit;
    state.unlocked = true;
    renderRecipients();
    sendHint.textContent = '已加载测试收件人，可勾选后发送。';
    addLog('success', '测试收件人已解锁', `已加载 ${state.recipients.length} 个可用收件人。`);
  } catch (error) {
    state.unlocked = false;
    recipientStatus.textContent = '授权失败';
    sendHint.textContent = error.message || '管理验证码校验失败。';
    addLog('error', '无法加载收件人', error.message || '管理验证码校验失败。');
  } finally {
    unlockButton.disabled = false;
    unlockButton.textContent = '解锁收件人';
    updateSendState();
  }
}

async function addRecipient(event) {
  event.preventDefault();
  const email = newRecipient.value.trim();
  if (!email) return;
  addRecipientButton.disabled = true;
  try {
    const result = await readResponse(await fetch('/api/notifications/test-recipients', {
      method: 'POST', headers: apiHeaders(), body: JSON.stringify({ email })
    }));
    state.recipients = result.recipients;
    state.limit = result.limit;
    newRecipient.value = '';
    renderRecipients();
    addLog('success', '测试收件人已添加', email);
  } catch (error) {
    sendHint.textContent = error.message || '添加测试收件人失败。';
    addLog('error', '添加测试收件人失败', error.message || '服务端未返回可用结果。');
  } finally {
    addRecipientButton.disabled = false;
  }
}

document.querySelector('#refreshStatus').addEventListener('click', checkStatus);
unlockButton.addEventListener('click', unlockRecipients);
accessToken.addEventListener('keydown', event => { if (event.key === 'Enter') unlockRecipients(); });
addRecipientForm.addEventListener('submit', addRecipient);
sendButton.addEventListener('click', async () => {
  const recipients = selectedRecipients();
  sendButton.disabled = true;
  sendButton.textContent = '正在发送...';
  sendHint.textContent = '正在等待 SMTP 服务端响应。';
  try {
    const result = await readResponse(await fetch('/api/notifications/test', {
      method: 'POST', headers: apiHeaders(), body: JSON.stringify({ recipients })
    }));
    sendHint.textContent = `邮件已由 SMTP 服务接受，投递至 ${result.accepted} 个收件人。`;
    addLog('success', '测试邮件发送成功', `SMTP 服务已接受投递，收件人数量：${result.accepted}。`);
  } catch (error) {
    sendHint.textContent = error.message || '发送失败，请检查服务端配置。';
    addLog('error', '测试邮件发送失败', error.message || '服务端未返回可用结果。');
  } finally {
    sendButton.textContent = '发送测试邮件';
    window.setTimeout(checkStatus, 500);
  }
});

checkStatus();
