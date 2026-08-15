import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import nodemailer from 'nodemailer'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_RECIPIENTS = 10
const MAX_REPORT_LENGTH = 800_000

const normalizeEmail = (value = '') => String(value).trim().toLowerCase()
const parseRecipients = (value = '') => String(value)
  .split(/[;,\n]/)
  .map(normalizeEmail)
  .filter((email, index, list) => EMAIL_PATTERN.test(email) && list.indexOf(email) === index)
  .slice(0, MAX_RECIPIENTS)

const safeEqual = (left = '', right = '') => {
  const leftHash = createHash('sha256').update(String(left)).digest()
  const rightHash = createHash('sha256').update(String(right)).digest()
  return timingSafeEqual(leftHash, rightHash)
}

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;')

const cleanHeaderText = (value = '') => String(value).replace(/[\r\n]+/g, ' ').trim()
const normalizeHttpUrl = (value = '') => {
  const rawUrl = String(value).trim()
  if (!rawUrl || rawUrl.length > 2_048) return ''
  try {
    const parsedUrl = new URL(rawUrl)
    return ['http:', 'https:'].includes(parsedUrl.protocol) ? parsedUrl.href : ''
  } catch {
    return ''
  }
}
const createAttachmentFilename = (policyTitle, reportType) => {
  const safeTitle = cleanHeaderText(policyTitle)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 72)
  const safeReportType = cleanHeaderText(reportType)
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .slice(0, 24)
  return `${safeTitle || '政策分析'}-${safeReportType || '分析报告'}.md`
}

const parseCookie = (header = '') => Object.fromEntries(String(header)
  .split(';')
  .map((part) => part.trim())
  .filter(Boolean)
  .map((part) => {
    const index = part.indexOf('=')
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))]
  }))

const readJsonBody = (request, maxBytes = 1_000_000) => new Promise((resolve, reject) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > maxBytes) reject(new Error('请求数据过大'))
  })
  request.on('end', () => {
    try {
      resolve(JSON.parse(body || '{}'))
    } catch {
      reject(new Error('请求数据不是有效 JSON'))
    }
  })
  request.on('error', reject)
})

const sendJson = (response, statusCode, payload, headers = {}) => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  Object.entries(headers).forEach(([key, value]) => response.setHeader(key, value))
  response.end(JSON.stringify(payload))
}

const createReportHtml = ({
  policyTitle,
  policyUrl,
  reportType,
  analysisAudience,
  administrativeLevel,
  policyCategory,
  attachmentFilename,
}) => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#f2f6f6;font-family:'Microsoft YaHei','PingFang SC',Arial,sans-serif;color:#243b4d">
  <div style="max-width:760px;margin:0 auto;padding:28px 18px">
    <div style="padding:24px 26px;background:#173b52;color:#fff;border-radius:12px 12px 0 0">
      <div style="font-size:13px;color:#79ddd0;font-weight:700">政策标准化平台 · 政策分析报告</div>
      <h1 style="margin:9px 0 0;font-size:24px;line-height:1.45">${escapeHtml(reportType)}</h1>
      <div style="margin-top:8px;font-size:15px;line-height:1.65;color:#dce9ee">${escapeHtml(policyTitle)}</div>
    </div>
    <div style="padding:24px 26px;background:#fff;border-radius:0 0 12px 12px">
      <div style="margin-bottom:20px;padding:16px 18px;background:#edf8f5;border-left:4px solid #0d998b;border-radius:7px;font-size:14px;line-height:1.75">
        您收到的是一份<strong>${escapeHtml(reportType)}</strong>。您可以通过下方链接查看政策官方原文，完整分析报告已整理为 Markdown 文件，请下载邮件附件查看。
      </div>
      <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.6">
        <tr><td style="width:112px;padding:9px 0;color:#728491;border-bottom:1px solid #e5ecee">政策文件</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #e5ecee">${escapeHtml(policyTitle)}</td></tr>
        <tr><td style="padding:9px 0;color:#728491;border-bottom:1px solid #e5ecee">政策链接</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #e5ecee"><a href="${escapeHtml(policyUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0d8075;text-decoration:underline">查看政策官方原文</a></td></tr>
        <tr><td style="padding:9px 0;color:#728491;border-bottom:1px solid #e5ecee">报告类型</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #e5ecee">${escapeHtml(reportType)}</td></tr>
        <tr><td style="padding:9px 0;color:#728491;border-bottom:1px solid #e5ecee">政策层级</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #e5ecee">${escapeHtml(administrativeLevel || '待确认')}</td></tr>
        <tr><td style="padding:9px 0;color:#728491;border-bottom:1px solid #e5ecee">适用类型</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #e5ecee">${escapeHtml(policyCategory || '待确认')}</td></tr>
        <tr><td style="padding:9px 0;color:#728491;border-bottom:1px solid #e5ecee">分析主体</td><td style="padding:9px 0;font-weight:700;border-bottom:1px solid #e5ecee">${escapeHtml(analysisAudience)}</td></tr>
      </table>
      <div style="margin-top:22px;padding:15px 17px;background:#f5f8f8;border:1px solid #dce7e8;border-radius:7px;font-size:13px;line-height:1.7;color:#526b79">
        <strong style="color:#274558">附件：</strong>${escapeHtml(attachmentFilename)}<br>
        附件采用 UTF-8 编码，可使用 Markdown 编辑器、VS Code 或支持 Markdown 的文档工具打开。
      </div>
      <div style="margin-top:22px;font-size:12px;color:#8a9aa3">本邮件由政策标准化平台通过已授权的 SMTP 服务发送。</div>
    </div>
  </div>
</body>
</html>`

export const createSmtpNotificationService = (config = {}) => {
  const settings = {
    host: String(config.host || '').trim(),
    connectionHost: String(config.connectionHost || '').trim(),
    port: Number(config.port || 465),
    secure: config.secure !== false,
    user: String(config.user || '').trim(),
    pass: String(config.pass || ''),
    from: String(config.from || '').trim(),
    accessToken: String(config.accessToken || ''),
    sessionMaxAgeSeconds: Math.max(300, Number(config.sessionMaxAgeSeconds || 3600)),
    rateLimitPerHour: Math.max(1, Number(config.rateLimitPerHour || 5)),
  }
  const configured = Boolean(
    settings.host
    && settings.port
    && settings.user
    && settings.pass
    && settings.from
    && settings.accessToken,
  )
  const allowedRecipients = new Set(parseRecipients(config.recipients))
  const sessions = new Map()
  const sendTimestamps = []
  let verificationState = configured ? 'pending' : 'unconfigured'
  let transporter = null

  if (configured) {
    transporter = nodemailer.createTransport({
      host: settings.connectionHost || settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user, pass: settings.pass },
      tls: settings.connectionHost ? { servername: settings.host } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    })
    transporter.verify()
      .then(() => { verificationState = 'verified' })
      .catch(() => { verificationState = 'failed' })
  }

  const pruneSessions = () => {
    const now = Date.now()
    sessions.forEach((expiresAt, sessionId) => {
      if (expiresAt <= now) sessions.delete(sessionId)
    })
  }

  const getSessionId = (request) => parseCookie(request.headers.cookie || '').notification_session || ''
  const isAuthorized = (request) => {
    pruneSessions()
    const sessionId = getSessionId(request)
    return Boolean(sessionId && (sessions.get(sessionId) || 0) > Date.now())
  }

  const requireAuthorization = (request, response) => {
    if (isAuthorized(request)) return true
    sendJson(response, 401, { error: '需要管理验证码授权', code: 'NOTIFICATION_AUTH_REQUIRED' })
    return false
  }

  const health = () => ({
    smtpConfigured: configured,
    smtpVerified: verificationState === 'verified',
    smtpVerificationState: verificationState,
    notificationRecipientCount: allowedRecipients.size,
    notificationMaxRecipients: MAX_RECIPIENTS,
  })

  const sendReport = async (input) => {
    if (!configured || !transporter) {
      const error = new Error('SMTP 尚未配置')
      error.statusCode = 503
      throw error
    }
    if (verificationState === 'failed') {
      const error = new Error('SMTP 连接或身份验证失败')
      error.statusCode = 503
      throw error
    }

    const recipients = [...new Set((Array.isArray(input.recipients) ? input.recipients : []).map(normalizeEmail))]
    if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) {
      const error = new Error(`每次必须选择 1—${MAX_RECIPIENTS} 个收件邮箱`)
      error.statusCode = 400
      throw error
    }
    const unauthorizedRecipient = recipients.find((email) => !allowedRecipients.has(email))
    if (unauthorizedRecipient) {
      const error = new Error('收件人不在服务端白名单内')
      error.statusCode = 403
      throw error
    }
    const report = String(input.report || '')
    if (!report || report.length > MAX_REPORT_LENGTH) {
      const error = new Error('报告正文为空或超过大小限制')
      error.statusCode = 400
      throw error
    }

    const oneHourAgo = Date.now() - 60 * 60 * 1000
    while (sendTimestamps.length > 0 && sendTimestamps[0] < oneHourAgo) sendTimestamps.shift()
    if (sendTimestamps.length >= settings.rateLimitPerHour) {
      const error = new Error('发送过于频繁，请稍后再试')
      error.statusCode = 429
      throw error
    }

    const policyTitle = cleanHeaderText(input.policyTitle || '政策分析报告').slice(0, 140)
    const policyUrl = normalizeHttpUrl(input.policyUrl)
    if (!policyUrl) {
      const error = new Error('政策官方链接为空或格式不正确')
      error.statusCode = 400
      throw error
    }
    const reportType = cleanHeaderText(input.reportType || '政策分析报告').slice(0, 80)
    const analysisAudience = cleanHeaderText(input.analysisAudience || '相关人员').slice(0, 80)
    const administrativeLevel = cleanHeaderText(input.administrativeLevel || '待确认').slice(0, 40)
    const policyCategory = cleanHeaderText(input.policyCategory || '待确认').slice(0, 40)
    const attachmentFilename = createAttachmentFilename(policyTitle, reportType)
    const subject = `[政策分析报告] ${reportType}｜${policyTitle}`.slice(0, 180)
    const text = [
      '政策标准化平台 · 政策分析报告',
      '',
      `政策文件：${policyTitle}`,
      `政策链接：${policyUrl}`,
      `报告类型：${reportType}`,
      `政策层级：${administrativeLevel}`,
      `适用类型：${policyCategory}`,
      `分析主体：${analysisAudience}`,
      '',
      `完整报告请查看邮件附件：${attachmentFilename}`,
    ].join('\n')
    const html = createReportHtml({
      policyTitle,
      policyUrl,
      reportType,
      analysisAudience,
      administrativeLevel,
      policyCategory,
      attachmentFilename,
    })
    const deliveries = []
    for (const recipient of recipients) {
      const info = await transporter.sendMail({
        from: settings.from,
        to: recipient,
        subject,
        text,
        html,
        attachments: [{
          filename: attachmentFilename,
          content: report,
          contentType: 'text/markdown; charset=utf-8',
        }],
      })
      deliveries.push({ recipient, messageId: info.messageId })
    }
    sendTimestamps.push(Date.now())
    return { deliveries, sentAt: new Date().toISOString(), attachmentFilename }
  }

  const middleware = async (request, response, next) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const pathname = url.pathname
    if (!pathname.startsWith('/api/notifications/')) {
      next()
      return
    }

    try {
      if (pathname === '/api/notifications/session' && request.method === 'GET') {
        sendJson(response, 200, { authorized: isAuthorized(request), ...health() })
        return
      }
      if (pathname === '/api/notifications/recipients' && request.method === 'GET') {
        sendJson(response, 200, { recipients: [...allowedRecipients].sort(), maxRecipients: MAX_RECIPIENTS })
        return
      }
      if (pathname === '/api/notifications/auth' && request.method === 'POST') {
        if (!configured) {
          sendJson(response, 503, { error: 'SMTP 或管理验证码尚未配置' })
          return
        }
        const input = await readJsonBody(request, 20_000)
        if (!safeEqual(input.accessToken, settings.accessToken)) {
          sendJson(response, 403, { error: '管理验证码错误' })
          return
        }
        const sessionId = randomBytes(32).toString('hex')
        sessions.set(sessionId, Date.now() + settings.sessionMaxAgeSeconds * 1000)
        sendJson(response, 200, { authorized: true }, {
          'Set-Cookie': `notification_session=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${settings.sessionMaxAgeSeconds}`,
        })
        return
      }
      if (pathname === '/api/notifications/recipients' && request.method === 'POST') {
        if (!requireAuthorization(request, response)) return
        const input = await readJsonBody(request, 20_000)
        const email = normalizeEmail(input.email)
        if (!EMAIL_PATTERN.test(email)) {
          sendJson(response, 400, { error: '邮箱格式不正确' })
          return
        }
        if (!allowedRecipients.has(email) && allowedRecipients.size >= MAX_RECIPIENTS) {
          sendJson(response, 400, { error: `测试邮箱最多 ${MAX_RECIPIENTS} 个` })
          return
        }
        allowedRecipients.add(email)
        sendJson(response, 200, { recipients: [...allowedRecipients].sort() })
        return
      }
      if (pathname === '/api/notifications/recipients' && request.method === 'DELETE') {
        if (!requireAuthorization(request, response)) return
        const input = await readJsonBody(request, 20_000)
        allowedRecipients.delete(normalizeEmail(input.email))
        sendJson(response, 200, { recipients: [...allowedRecipients].sort() })
        return
      }
      if (pathname === '/api/notifications/send' && request.method === 'POST') {
        if (!requireAuthorization(request, response)) return
        const input = await readJsonBody(request, MAX_REPORT_LENGTH + 100_000)
        const result = await sendReport(input)
        sendJson(response, 200, result)
        return
      }
      sendJson(response, 405, { error: '不支持的通知接口或请求方法' })
    } catch (error) {
      sendJson(response, Number(error?.statusCode || 500), {
        error: error instanceof Error ? error.message : '邮件通知处理失败',
      })
    }
  }

  return { health, middleware }
}
