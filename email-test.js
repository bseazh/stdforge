const statusResult = document.querySelector('#statusResult');
const sendButton = document.querySelector('#sendTest');
const sendHint = document.querySelector('#sendHint');
const activityLog = document.querySelector('#activityLog');

function setStatus(state, title, detail) {
  statusResult.className = `status-result ${state}`;
  statusResult.innerHTML = `<span class="status-dot"></span><div><strong>${title}</strong><small>${detail}</small></div>`;
}

function addLog(kind, title, detail) {
  const item = document.createElement('li');
  item.className = kind;
  item.innerHTML = `<span></span><div><strong>${title}</strong><small>${detail}</small></div>`;
  activityLog.prepend(item);
}

async function checkStatus() {
  sendButton.disabled = true;
  setStatus('loading', '正在检测服务端配置', '请求 GET /api/health');
  sendHint.textContent = '等待服务端状态检查完成。';
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    if (result.smtpConfigured === true) {
      setStatus('ready', 'SMTP 已配置，可以发送测试邮件', '邮件凭据只存在于服务端环境变量。');
      sendButton.disabled = false;
      sendHint.textContent = '测试邮件将发送到服务端预配置的收件人。';
      addLog('success', 'SMTP 状态检查通过', '服务端确认 SMTP 凭据与固定收件人均已配置。');
      return;
    }
    setStatus('failed', '邮件服务尚未部署或未配置', '当前 API 未返回 smtpConfigured: true。');
    sendHint.textContent = '请部署新版服务并注入 SMTP 环境变量后重试。';
    addLog('error', 'SMTP 状态检查未通过', '线上服务仍为旧版本，或缺少 SMTP 配置。');
  } catch (error) {
    setStatus('failed', '无法连接邮件服务', error.message || '请求 /api/health 失败。');
    sendHint.textContent = '请确认页面与 API 网关均可访问。';
    addLog('error', '服务状态检查失败', error.message || '请求 /api/health 失败。');
  }
}

document.querySelector('#refreshStatus').addEventListener('click', checkStatus);
sendButton.addEventListener('click', async () => {
  sendButton.disabled = true;
  sendButton.textContent = '正在发送...';
  sendHint.textContent = '正在等待 SMTP 服务端响应。';
  try {
    const response = await fetch('/api/notifications/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    sendHint.textContent = `邮件已由 SMTP 服务接受，投递至 ${result.accepted} 个配置收件人。`;
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
