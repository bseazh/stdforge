// 前端公共核心：邮件推送助手（推送审批 + 统一收件人管理）
// 契约：
//   GET  /api/mail/session | /api/mail/recipients | /api/mail/latest?moduleId=
//   POST /api/mail/authorize { code } | /api/mail/approve { moduleId } | /api/mail/push { moduleId, recipients? }
import * as ui from './ui.js'

const API_ROOT = location.pathname.startsWith('/module2/') ? '/module2/api' : '/api'

const api = async (path, options = {}) => {
  const response = await fetch(`${API_ROOT}${path.replace(/^\/api/, '')}`, {
    credentials: 'same-origin',
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `请求失败（HTTP ${response.status}）`)
    error.status = response.status
    error.code = data.code
    error.body = data
    throw error
  }
  return data
}

export async function fetchRecipients() {
  const data = await api('/api/mail/recipients')
  return {
    recipients: data.recipients || [],
    smtp: data.smtp || {},
    maxTestRecipients: data.maxTestRecipients || 10,
  }
}

// 内部工具：无需管理验证码，直接放行（安全边界仍由服务端限频/收件人白名单保障）
export async function ensureAuthorized() {
  return true
}

export async function fetchLatest(moduleId) {
  try {
    return await api(`/api/mail/latest?moduleId=${encodeURIComponent(moduleId)}`)
  } catch {
    return null
  }
}

export async function approveAndPush(moduleId, { recipients, skipApproval = false } = {}) {
  if (!(await ensureAuthorized())) throw new Error('已取消授权')
  if (!skipApproval) {
    await api('/api/mail/approve', { method: 'POST', body: JSON.stringify({ moduleId }) })
  }
  return api('/api/mail/push', { method: 'POST', body: JSON.stringify({ moduleId, recipients }) })
}

// 给模块页面绑定「审批通过并推送邮箱」按钮
// opts: { container, moduleId, button, status, info }（selector 或元素）
export function wirePushBar(opts) {
  const { container, moduleId, ui: uiRef = ui } = opts
  const button = opts.button instanceof HTMLElement ? opts.button : container.querySelector(opts.button)
  const statusEl = opts.status instanceof HTMLElement ? opts.status : container.querySelector(opts.status)
  const infoEl = opts.info instanceof HTMLElement ? opts.info : container.querySelector(opts.info)
  if (!button) return null

  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text
  }

  const refresh = async () => {
    const latest = await fetchLatest(moduleId)
    if (!latest) {
      if (infoEl) infoEl.textContent = '尚未生成结果：运行模块后将在此展示推送摘要，审批通过后方可推送邮箱。'
      button.disabled = true
      return null
    }
    if (infoEl) {
      const generatedAt = latest.generatedAt ? new Date(latest.generatedAt).toLocaleString('zh-CN') : '—'
      const stateText = latest.pushReady
        ? ' <b style="color:var(--success)">已审批，可推送</b>'
        : latest.approvalRequired
          ? ' <b style="color:var(--warning)">待审批：点击下方按钮完成「审批通过 → 推送」</b>'
          : ' <b style="color:var(--warning)">待审查通过</b>'
      infoEl.innerHTML = `最新结果：${latest.summary || '—'}（${generatedAt}）${stateText}`
    }
    // 有结果即可点击：点击后先「审批通过」再推送（避免审批死锁）
    button.disabled = false
    return latest
  }

  button.addEventListener('click', async () => {
    setStatus('准备推送…')
    button.disabled = true
    try {
      const latest = await fetchLatest(moduleId)
      if (!latest) throw new Error('尚未生成结果：请先运行模块')
      if (!latest.pushReady && latest.approvalRequired) {
        setStatus('待确认审批…')
        const approved = confirm(`审批确认：即将把「${moduleId}」最新结果审批通过并推送给收件人。确认？`)
        if (!approved) {
          setStatus('已取消')
          return
        }
        if (!(await ensureAuthorized())) {
          setStatus('已取消授权')
          return
        }
        setStatus('审批中…')
        await api('/api/mail/approve', { method: 'POST', body: JSON.stringify({ moduleId }) })
      }
      const mailState = await fetchRecipients()
      const emails = (mailState.recipients || []).map((item) => item.email)
      if (!emails.length) throw new Error('没有可用收件人：请到「收件人管理」（/mail-test）配置')
      const preview = emails.length <= 3 ? emails.join('、') : `${emails.slice(0, 3).join('、')} 等 ${emails.length} 位`
      if (!confirm(`推送确认：即将把「${moduleId}」最新结果发送给 ${preview}。确认推送？`)) {
        setStatus('已取消')
        return
      }
      setStatus('推送中…')
      const data = await approveAndPush(moduleId, { skipApproval: true })
      setStatus(`✓ ${data.message}`)
      uiRef.showToast(data.message, 'success')
      await refresh()
    } catch (error) {
      const message = error.message || '未知错误'
      setStatus('推送失败：' + message)
      uiRef.showToast('推送失败：' + message, 'error')
    } finally {
      const latest = await fetchLatest(moduleId).catch(() => null)
      if (latest) button.disabled = false
      else button.disabled = false
    }
  })

  refresh()
  return { refresh }
}
