import { defineConfig, loadEnv, type Plugin } from 'vite'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { crawlMiitPolicies, hydrateMiitPolicies, hydrateMiitPolicyDetails } from './server/miit-source.mjs'
import { analyzePolicies, type PolicyModelConfig } from './server/policy-classifier.mjs'
import { interpretPolicy } from './server/policy-interpreter.mjs'
import { createSmtpNotificationService, type SmtpNotificationService } from './server/smtp-notification.mjs'
import { createBilingualService } from './server/bilingual-translation.mjs'

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
  bilingualLlmConfig: PolicyModelConfig,
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
      bilingualTranslation: true,
      bilingualLlmConfigured: Boolean(bilingualLlmConfig.baseUrl && bilingualLlmConfig.model && bilingualLlmConfig.apiKey),
      bilingualLlmModel: bilingualLlmConfig.model || null,
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

const sendJson = (response: any, statusCode: number, payload: unknown) => {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(payload))
}

const createBilingualApiMiddleware = (bilingualService: any) => async (request: any, response: any, next: any) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  const { pathname } = url
  if (!pathname.startsWith('/api/bilingual/')) {
    next()
    return
  }

  const controller = new AbortController()
  response.on('close', () => {
    if (!response.writableEnded) controller.abort(new DOMException('客户端已断开', 'AbortError'))
  })

  try {
    if (pathname === '/api/bilingual/glossary') {
      if (request.method === 'GET') return sendJson(response, 200, { terms: await bilingualService.listGlossary() })
      if (request.method === 'POST') return sendJson(response, 201, { term: await bilingualService.createGlossaryTerm(await readJsonBody(request)) })
    }

    const glossaryMatch = pathname.match(/^\/api\/bilingual\/glossary\/([^/]+)$/)
    if (glossaryMatch) {
      const id = decodeURIComponent(glossaryMatch[1])
      if (request.method === 'PATCH') return sendJson(response, 200, { term: await bilingualService.updateGlossaryTerm(id, await readJsonBody(request)) })
      if (request.method === 'DELETE') {
        await bilingualService.deleteGlossaryTerm(id)
        response.statusCode = 204
        response.end()
        return
      }
    }

    if (pathname === '/api/bilingual/translations') {
      if (request.method === 'GET') return sendJson(response, 200, { translations: await bilingualService.listTranslations() })
      if (request.method === 'POST') {
        const input = await readJsonBody(request, 10_000_000) as Record<string, unknown>
        return sendJson(response, 201, { translation: await bilingualService.createTranslation({ ...input, signal: controller.signal }) })
      }
    }

    const downloadMatch = pathname.match(/^\/api\/bilingual\/translations\/([^/]+)\/download$/)
    if (downloadMatch && request.method === 'GET') {
      const { content, fileName } = await bilingualService.getDownload(
        decodeURIComponent(downloadMatch[1]),
        url.searchParams.get('language') || 'parallel',
      )
      response.statusCode = 200
      response.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      response.setHeader('Cache-Control', 'no-store')
      response.end(content)
      return
    }

    const revisionMatch = pathname.match(/^\/api\/bilingual\/translations\/([^/]+)\/revisions$/)
    if (revisionMatch && request.method === 'PATCH') {
      return sendJson(response, 200, {
        translation: await bilingualService.reviseTranslation(decodeURIComponent(revisionMatch[1]), await readJsonBody(request, 10_000_000)),
      })
    }

    const translationMatch = pathname.match(/^\/api\/bilingual\/translations\/([^/]+)$/)
    if (translationMatch && request.method === 'GET') {
      return sendJson(response, 200, { translation: await bilingualService.getTranslation(decodeURIComponent(translationMatch[1])) })
    }

    response.statusCode = 405
    response.setHeader('Allow', 'GET, POST, PATCH, DELETE')
    response.end('Method Not Allowed')
  } catch (error) {
    if (controller.signal.aborted || response.writableEnded) return
    const message = error instanceof Error ? error.message : '双语文档处理失败'
    const statusCode = /不存在/.test(message) ? 404 : /尚未配置/.test(message) ? 503 : 400
    sendJson(response, statusCode, { error: message })
  }
}

const policyApiPlugin = (
  llmConfig: PolicyModelConfig,
  bilingualLlmConfig: PolicyModelConfig,
  notificationService: SmtpNotificationService,
  bilingualService: any,
): Plugin => {
  const middleware = createPolicyApiMiddleware(llmConfig, bilingualLlmConfig, notificationService)
  const bilingualMiddleware = createBilingualApiMiddleware(bilingualService)
  return {
  name: 'policy-crawler-api',
  configureServer(server) {
    server.middlewares.use(notificationService.middleware)
    server.middlewares.use(middleware)
    server.middlewares.use(bilingualMiddleware)
  },
  configurePreviewServer(server) {
    server.middlewares.use(notificationService.middleware)
    server.middlewares.use(middleware)
    server.middlewares.use(bilingualMiddleware)
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
  const bilingualLlmConfig: PolicyModelConfig = {
    baseUrl: env.BILINGUAL_LLM_BASE_URL || llmConfig.baseUrl,
    model: env.BILINGUAL_LLM_MODEL || llmConfig.model,
    apiKey: env.BILINGUAL_LLM_API_KEY || llmConfig.apiKey,
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
  const bilingualService = createBilingualService({
    storePath: resolve(process.cwd(), '.runtime', 'bilingual-translations.json'),
    config: bilingualLlmConfig,
  })
  return {
    base: './',
    plugins: [react(), policyApiPlugin(llmConfig, bilingualLlmConfig, notificationService, bilingualService)],
    server: {
      host: '127.0.0.1',
      port: 5173,
    },
  }
})
