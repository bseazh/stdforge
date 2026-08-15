import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const secretPath = resolve(root, '.env.smtp.local')
const reportCachePath = resolve(root, '.smtp-report-cache.local')
const sentMarkerPath = resolve(root, '.smtp-attachment-v2-sent.local')
const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:4175'
const sendExisting = process.argv.includes('--send-existing')
const shouldSend = process.argv.includes('--send') || sendExisting

const parseEnvFile = (path) => Object.fromEntries(readFileSync(path, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => {
    const separator = line.indexOf('=')
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
  }))

if (!existsSync(secretPath)) throw new Error('缺少 .env.smtp.local')
if (shouldSend && existsSync(sentMarkerPath)) throw new Error('真实邮件测试已经执行过；为避免重复投递，本次已停止')
if (sendExisting && !existsSync(reportCachePath)) throw new Error('缺少可复用的本地报告缓存，已停止附件版推送')

const secrets = parseEnvFile(secretPath)
const expectedRecipients = String(secrets.NOTIFICATION_RECIPIENTS || '')
  .split(/[;,\n]/)
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean)
if (expectedRecipients.length !== 1) throw new Error('真实测试要求服务端白名单中恰好只有 1 个收件邮箱')
if (!secrets.NOTIFICATION_TEST_ACCESS_TOKEN) throw new Error('缺少邮件管理验证码')

const requestJson = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(options.timeout || 240_000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `${path} 返回 HTTP ${response.status}`)
  return { response, data }
}

const health = (await requestJson('/api/health')).data
if (!health.smtpConfigured || !health.smtpVerified) throw new Error('SMTP 尚未完成配置与验证')
if (!health.llmConfigured) throw new Error('DeepSeek 尚未配置')
if (health.notificationRecipientCount !== 1) throw new Error('服务端收件人白名单数量不是 1')

let reportPackage
let reportSource = 'cache'
if (existsSync(reportCachePath)) {
  reportPackage = JSON.parse(readFileSync(reportCachePath, 'utf8'))
} else {
  reportSource = 'generated'
  const crawl = (await requestJson('/api/crawl/miit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keywords: ['冰箱', '白色家电'],
      startDate: '2020-01-01',
      endDate: new Date().toISOString().slice(0, 10),
      maxPages: 3,
      pageSize: 10,
    }),
  })).data
  if (!Array.isArray(crawl.policies) || crawl.policies.length === 0) throw new Error('没有取得可用于测试的工信部政策')

  const selectedPolicy = crawl.policies.find((policy) => /冰箱|家电|节能/.test(`${policy.title} ${policy.contentPreview}`)) || crawl.policies[0]
  const classification = (await requestJson('/api/classify/policies', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policies: [selectedPolicy] }),
  })).data
  const classificationResult = classification.results?.[0]
  if (!classificationResult || classificationResult.status !== 'completed') throw new Error('政策分类没有正常完成')

  const interpretation = (await requestJson('/api/interpret/policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      policy: selectedPolicy,
      skillId: 'policy-expert-interpretation',
      audience: '业务负责人',
    }),
    timeout: 420_000,
  })).data
  if (!interpretation.report || interpretation.report.length < 300) throw new Error('政策分析报告内容异常')
  reportPackage = {
    policy: selectedPolicy,
    classification: classificationResult.classification,
    interpretation,
  }
  writeFileSync(reportCachePath, JSON.stringify(reportPackage), { encoding: 'utf8', flag: 'wx' })
}

const { policy: selectedPolicy, classification: cachedClassification, interpretation } = reportPackage
if (!selectedPolicy?.title || !selectedPolicy?.url || !interpretation?.report || interpretation.report.length < 300) throw new Error('本地报告缓存内容异常')

const authResult = await requestJson('/api/notifications/auth', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ accessToken: secrets.NOTIFICATION_TEST_ACCESS_TOKEN }),
})
const sessionCookie = String(authResult.response.headers.get('set-cookie') || '').split(';')[0]
if (!sessionCookie) throw new Error('没有取得邮件管理会话')

const recipientResult = (await requestJson('/api/notifications/recipients', {
  headers: { Cookie: sessionCookie },
})).data
if (recipientResult.recipients?.length !== 1 || recipientResult.recipients[0] !== expectedRecipients[0]) {
  throw new Error('服务端白名单与本地 Secret 不一致')
}

let sendResult = null
if (shouldSend) {
  sendResult = (await requestJson('/api/notifications/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
    body: JSON.stringify({
      recipients: expectedRecipients,
      policyTitle: selectedPolicy.title,
      policyUrl: selectedPolicy.url,
      reportType: '专家解读报告',
      analysisAudience: '业务负责人',
      administrativeLevel: cachedClassification?.administrativeLevel || '待确认',
      policyCategory: cachedClassification?.policyCategory || '待确认',
      report: interpretation.report,
    }),
  })).data
  if (sendResult.deliveries?.length !== 1) throw new Error('SMTP 没有确认唯一一封邮件')
  writeFileSync(sentMarkerPath, JSON.stringify({ sentAt: sendResult.sentAt, count: 1 }), { encoding: 'utf8', flag: 'wx' })
}

console.log(JSON.stringify({
  health: {
    smtpConfigured: health.smtpConfigured,
    smtpVerified: health.smtpVerified,
    llmModel: health.llmModel,
    recipientCount: health.notificationRecipientCount,
  },
  policy: {
    title: selectedPolicy.title,
    administrativeLevel: cachedClassification?.administrativeLevel,
    policyCategory: cachedClassification?.policyCategory,
  },
  interpretation: {
    skillId: interpretation.skillId,
    audience: interpretation.audience,
    reportCharacters: interpretation.report.length,
    source: reportSource,
  },
  delivery: {
    attempted: shouldSend,
    smtpAcceptedCount: sendResult?.deliveries?.length || 0,
    attachmentFilename: sendResult?.attachmentFilename || null,
    sentAt: sendResult?.sentAt || null,
  },
}, null, 2))
