import { defineConfig, loadEnv, type Plugin } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { crawlMiitPolicies, hydrateMiitPolicies, hydrateMiitPolicyDetails } from './server/miit-source.mjs'
import { analyzePolicies, type PolicyModelConfig } from './server/policy-classifier.mjs'
import { interpretPolicy } from './server/policy-interpreter.mjs'
import { createSmtpNotificationService, type SmtpNotificationService } from './server/smtp-notification.mjs'

const readSecretEnvFile = (path: string) => {
  if (!existsSync(path)) return {}
  try {
    return Object.fromEntries(readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
      }))
  } catch {
    return {}
  }
}

const readJsonBody = (request: any, maxBytes = 2_000_000) => new Promise((resolve, reject) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk: string) => {
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

const createPolicyApiMiddleware = (
  llmConfig: PolicyModelConfig,
  notificationService: SmtpNotificationService,
) => async (request: any, response: any, next: any) => {
  const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
  if (pathname === '/api/health') {
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({
      ok: true,
      miitCrawler: true,
      policyClassifier: true,
      policyInterpreter: true,
      llmConfigured: Boolean(llmConfig.baseUrl && llmConfig.model && llmConfig.apiKey),
      llmModel: llmConfig.model || null,
      ...notificationService.health(),
    }))
    return
  }
  if (!['/api/crawl/miit', '/api/classify/policies', '/api/interpret/policy'].includes(pathname)) {
    next()
    return
  }
  if (request.method !== 'POST') {
    response.statusCode = 405
    response.setHeader('Allow', 'POST')
    response.end('Method Not Allowed')
    return
  }

  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort(new DOMException('客户端已断开', 'AbortError'))
  })

  try {
    const input = await readJsonBody(request)
    let result
    if (pathname === '/api/classify/policies') {
      result = await analyzePolicies(
        await hydrateMiitPolicies((input as any).policies, { signal: controller.signal }),
        { config: llmConfig, signal: controller.signal },
      )
    } else if (pathname === '/api/interpret/policy') {
      result = await interpretPolicy({
        ...(input as any),
        policy: await hydrateMiitPolicyDetails((input as any).policy, { signal: controller.signal }),
      }, { config: llmConfig, signal: controller.signal })
    } else {
      result = await crawlMiitPolicies(input as any, { signal: controller.signal })
    }
    response.statusCode = 200
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.setHeader('Cache-Control', 'no-store')
    response.end(JSON.stringify(result))
  } catch (error) {
    if (controller.signal.aborted || response.writableEnded) return
    response.statusCode = 502
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : '政策处理失败' }))
  }
}

const policyApiPlugin = (
  llmConfig: PolicyModelConfig,
  notificationService: SmtpNotificationService,
): Plugin => {
  const middleware = createPolicyApiMiddleware(llmConfig, notificationService)
  return {
  name: 'policy-crawler-api',
  configureServer(server) {
    server.middlewares.use(notificationService.middleware)
    server.middlewares.use(middleware)
  },
  configurePreviewServer(server) {
    server.middlewares.use(notificationService.middleware)
    server.middlewares.use(middleware)
  },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const smtpEnv = {
    ...process.env,
    ...readSecretEnvFile(resolve(process.cwd(), '.env.smtp.local')),
  }
  const llmConfig: PolicyModelConfig = {
    baseUrl: env.POLICY_LLM_BASE_URL,
    model: env.POLICY_LLM_MODEL,
    apiKey: env.POLICY_LLM_API_KEY,
  }
  const notificationService = createSmtpNotificationService({
    host: smtpEnv.SMTP_HOST,
    connectionHost: smtpEnv.SMTP_CONNECTION_HOST,
    port: Number(smtpEnv.SMTP_PORT || 465),
    secure: String(smtpEnv.SMTP_SECURE || 'true').toLowerCase() === 'true',
    user: smtpEnv.SMTP_USER,
    pass: smtpEnv.SMTP_PASS,
    from: smtpEnv.SMTP_FROM,
    recipients: smtpEnv.NOTIFICATION_RECIPIENTS,
    accessToken: smtpEnv.NOTIFICATION_TEST_ACCESS_TOKEN,
    sessionMaxAgeSeconds: Number(smtpEnv.SMTP_SESSION_MAX_AGE_SECONDS || 3600),
    rateLimitPerHour: Number(smtpEnv.SMTP_RATE_LIMIT_PER_HOUR || 5),
  })
  return {
    base: './',
    plugins: [react(), policyApiPlugin(llmConfig, notificationService)],
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  }
})
