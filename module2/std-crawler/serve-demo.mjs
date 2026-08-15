// 演示服务：托管页面 + 异步实时分析任务（真实爬取 + LLM）+ 按 moduleId 分派业务模块
// 运行：node serve-demo.mjs   → http://127.0.0.1:5277
// POST /api/analyze { moduleId?, config }  创建任务（缺省 moduleId = analysis）
//      旧调用兼容：直接传 { keywords, types, ... } 视为 analysis 的 config
// GET  /api/analyze/:jobId                  轮询进度与结果
// GET  /api/health                          { ok, modules, llmConfigured }
// 静态资源：/std-crawler/frontend/**（ES Modules：application/javascript + no-store）
import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findModule, listModules } from './capability-registry.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 5277)
// 邮件测试页/收件人管理由 pdf-parser 服务托管；本站收到 /mail-test 时重定向过去
const MAIL_SERVER_URL = String(process.env.MAIL_SERVER_URL || 'http://127.0.0.1:4175').replace(/\/+$/, '')
// 全部使用相对本文件的位置，迁移到任意目录均可运行
const DEMO_HTML = join(__dirname, '..', 'index.html')
const FRONTEND_ROOT = join(__dirname, 'frontend')
const CONFIG_FILE = join(__dirname, 'ds配置.json')
const QUERY_CONFIG_FILE = join(__dirname, 'case8-config.json')
const SNAPSHOT_FILE = join(__dirname, 'output', 'case8-scenario-data.json')
const MAIL_ENV_FILE = join(__dirname, '..', '..', '.env.smtp.local')
const DEPLOY_ENV_FILE = join(__dirname, '..', '..', '.env.local')

const readDeployEnv = () => {
  try {
    return Object.fromEntries(readFileSync(DEPLOY_ENV_FILE, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line && !line.trimStart().startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()]
      }))
  } catch {
    return {}
  }
}

// 读取本地 .env.smtp.local（仅提取服务间同步令牌，不读取/输出任何 SMTP 凭据）
const readMailSyncToken = () => {
  try {
    if (!existsSync(MAIL_ENV_FILE)) return ''
    for (const line of readFileSync(MAIL_ENV_FILE, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      if (trimmed.startsWith('MAIL_SYNC_TOKEN=')) return trimmed.slice('MAIL_SYNC_TOKEN='.length).trim().replace(/^["']|["']$/g, '')
    }
  } catch {
    // 读取失败按未配置处理
  }
  return ''
}

const MIME_TYPES = {
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
}

const readLlmConfig = () => {
  const deployEnv = readDeployEnv()
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    return {
      baseUrl: parsed?.provider?.deepseek?.options?.baseURL || process.env.STD_LLM_BASE_URL || deployEnv.LLM_BASE_URL || '',
      model: process.env.STD_LLM_MODEL || deployEnv.LLM_MODEL || 'deepseek-chat',
      apiKey: parsed?.provider?.deepseek?.options?.apiKey || process.env.STD_LLM_API_KEY || deployEnv.LLM_API_KEY || '',
    }
  } catch {
    return {
      baseUrl: process.env.STD_LLM_BASE_URL || deployEnv.LLM_BASE_URL || '',
      model: process.env.STD_LLM_MODEL || deployEnv.LLM_MODEL || 'deepseek-chat',
      apiKey: process.env.STD_LLM_API_KEY || deployEnv.LLM_API_KEY || '',
    }
  }
}

// 检索条件默认值：优先读取 case8-config.json（仅 analysis 模块沿用，保证旧行为不变）
const readQueryConfig = () => {
  try {
    const parsed = JSON.parse(readFileSync(QUERY_CONFIG_FILE, 'utf8'))
    return {
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map((item) => String(item).trim()).filter(Boolean) : [],
      types: Array.isArray(parsed.types) ? parsed.types.filter((type) => ['gb', 'hb', 'db', 'plan'].includes(type)) : [],
      startDate: String(parsed.startDate || ''),
      endDate: String(parsed.endDate || ''),
      maxPages: Number(parsed.maxPages) || 1,
      pageSize: Number(parsed.pageSize) || 20,
      maxItems: Number(parsed.maxItems) || 24,
      searchConcurrency: Number(parsed.searchConcurrency) || 3,
      llmConcurrency: Number(parsed.llmConcurrency) || 5,
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      // 领域相关度配置（可选，缺省用 domain-config 默认）
      domain: String(parsed.domain || ''),
      relevanceThreshold: parsed.relevanceThreshold != null ? Number(parsed.relevanceThreshold) : null,
      icsWhitelist: Array.isArray(parsed.icsWhitelist) ? parsed.icsWhitelist.map(String) : null,
      ccsWhitelist: Array.isArray(parsed.ccsWhitelist) ? parsed.ccsWhitelist.map(String) : null,
    }
  } catch {
    return {}
  }
}

// 值合并：空数组/空字符串/缺失 → 取下一级默认（与改造前「请求 > 文件 > 硬编码」语义一致）
const pick = (value, fallback) => {
  if (Array.isArray(value)) return value.length > 0 ? value : fallback
  if (value === undefined || value === null || value === '') return fallback
  return value
}

const resolveModuleConfig = (module, requestConfig = {}) => {
  const fileDefaults = module.id === 'analysis' ? readQueryConfig() : {}
  const source = { ...module.defaultConfig, ...fileDefaults }
  const merged = {}
  for (const key of Object.keys(source)) {
    merged[key] = pick(requestConfig[key], source[key])
  }
  for (const key of Object.keys(requestConfig)) {
    if (!(key in merged)) merged[key] = requestConfig[key]
  }
  return merged
}

const sendJson = (response, statusCode, data) => {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(data))
}

const readJsonBody = (request, maxBytes = 2_000_000) => new Promise((resolve, reject) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > maxBytes) {
      reject(new Error('请求数据过大'))
      request.destroy()
    }
  })
  request.on('end', () => {
    try {
      resolve(body ? JSON.parse(body) : {})
    } catch {
      reject(new Error('请求体不是有效 JSON'))
    }
  })
  request.on('error', reject)
})

// 内存任务表（演示用；生产可换队列 + 持久化）
const jobs = new Map()
let jobSeq = 0

const createJob = (module, requestConfig) => {
  const config = resolveModuleConfig(module, requestConfig)
  const job = {
    id: `job-${Date.now()}-${++jobSeq}`,
    moduleId: module.id,
    status: 'running',
    config,
    logs: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)
  const llmConfig = readLlmConfig()

  module.run({
    ...config,
    llmConfig,
    onLog: (entry) => {
      job.logs.push(entry)
      if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200)
    },
  })
    .then((result) => {
      job.status = 'done'
      job.result = result
      // 同步最新结果到邮件服务（审批后推送复用同一份结果）
      const syncToken = process.env.MAIL_SYNC_TOKEN || readMailSyncToken()
      if (syncToken && MAIL_SERVER_URL) {
        fetch(`${MAIL_SERVER_URL}/api/mail/sync-result`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-sync-token': syncToken,
          },
          body: JSON.stringify({ moduleId: module.id, result }),
        }).catch((error) => {
          console.warn(`同步「${module.id}」结果到邮件服务失败：`, error?.message || error)
        })
      }
    })
    .catch((error) => {
      job.status = 'error'
      job.error = error instanceof Error ? error.message : '任务失败'
    })

  // 任务完成后 30 分钟清理
  setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000).unref()
  return job
}

const requestHandler = async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${PORT}`)
  const pathname = url.pathname.replace(/^\/module2(?=\/)/, '')
  try {
    if (pathname === '/' || pathname === '/index.html') {
      if (!existsSync(DEMO_HTML)) {
        response.statusCode = 404
        response.end('未找到 competitor-analysis-demo.html')
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(readFileSync(DEMO_HTML, 'utf8'))
      return
    }

    // 收件人管理 / 邮件测试页 → pdf-parser 邮件服务（避免 404 空白页）
    if (pathname === '/mail-test') {
      response.statusCode = 302
      response.setHeader('location', `${MAIL_SERVER_URL}/mail-test`)
      response.setHeader('cache-control', 'no-store')
      response.end()
      return
    }

    // 邮件推送 API 反向代理 → pdf-parser 邮件服务（审批/收件人/推送统一走 4175）
    if (pathname.startsWith('/api/mail/')) {
      const target = new URL(pathname + url.search, MAIL_SERVER_URL)
      const upstream = await fetch(target, {
        method: request.method,
        headers: {
          'content-type': request.headers['content-type'] || 'application/json',
          cookie: request.headers.cookie || '',
        },
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request,
        duplex: 'half',
      })
      response.statusCode = upstream.status
      for (const [key, value] of upstream.headers.entries()) {
        if (key.toLowerCase() === 'set-cookie') {
          response.setHeader('set-cookie', upstream.headers.getSetCookie ? upstream.headers.getSetCookie() : value)
        } else if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          response.setHeader(key, value)
        }
      }
      response.setHeader('cache-control', 'no-store')
      const text = await upstream.text()
      response.end(text)
      return
    }

    // 静态托管：/std-crawler/frontend/**（ES Modules）
    if (pathname.startsWith('/std-crawler/frontend/')) {
      const relativePath = decodeURIComponent(pathname.slice('/std-crawler/frontend/'.length))
      if (!relativePath) {
        response.statusCode = 404
        response.end('Not Found')
        return
      }
      const filePath = resolve(FRONTEND_ROOT, relativePath)
      const insideRoot = filePath === FRONTEND_ROOT || filePath.startsWith(FRONTEND_ROOT + sep)
      if (!insideRoot || !existsSync(filePath) || !statSync(filePath).isFile()) {
        response.statusCode = 404
        response.end('Not Found')
        return
      }
      const mimeType = MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream'
      response.setHeader('content-type', mimeType)
      response.setHeader('cache-control', 'no-store')
      response.end(readFileSync(filePath))
      return
    }

    if (pathname === '/api/health') {
      // 合并邮件服务 SMTP 状态（非阻塞：邮件服务未启动时按未配置处理）
      let smtpConfigured = false
      try {
        const mailHealth = await fetch(`${MAIL_SERVER_URL}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json())
        smtpConfigured = Boolean(mailHealth?.smtpConfigured)
      } catch {
        smtpConfigured = false
      }
      sendJson(response, 200, {
        ok: true,
        name: 'competitor-analysis-demo',
        port: PORT,
        modules: listModules(),
        llmConfigured: Boolean(readLlmConfig().baseUrl && readLlmConfig().apiKey),
        smtpConfigured,
      })
      return
    }

    if (pathname === '/api/analyze' && request.method === 'POST') {
      const body = await readJsonBody(request)
      const moduleId = String(body.moduleId || 'analysis')
      const module = findModule(moduleId)
      if (!module) {
        sendJson(response, 400, {
          ok: false,
          error: `未知模块：${moduleId}（可用：${listModules().map((item) => item.id).join('、')}）`,
        })
        return
      }
      if (module.status === 'not-implemented') {
        sendJson(response, 501, { ok: false, error: `${module.name}模块未实现（status: not-implemented）` })
        return
      }
      // 契约：{ moduleId, config }；旧调用 { keywords, types, ... } 直接视为 config
      const config = body.config && typeof body.config === 'object' && !Array.isArray(body.config) ? body.config : body
      if (!Array.isArray(config.keywords) || config.keywords.filter(Boolean).length === 0) {
        sendJson(response, 400, { ok: false, error: '至少需要一个关键词' })
        return
      }
      if (moduleId === 'analysis' && (!Array.isArray(config.types) || config.types.filter(Boolean).length === 0)) {
        sendJson(response, 400, { ok: false, error: '至少选择一个标准类型' })
        return
      }
      const job = createJob(module, config)
      sendJson(response, 202, { ok: true, jobId: job.id, moduleId: job.moduleId })
      return
    }

    const jobMatch = pathname.match(/^\/api\/analyze\/([^/]+)$/)
    if (jobMatch) {
      const job = jobs.get(decodeURIComponent(jobMatch[1]))
      if (!job) {
        sendJson(response, 404, { ok: false, error: '任务不存在或已过期' })
        return
      }
      sendJson(response, 200, {
        ok: true,
        jobId: job.id,
        moduleId: job.moduleId,
        status: job.status,
        logs: job.logs,
        result: job.result,
        error: job.error,
      })
      return
    }

    if (pathname === '/api/snapshot') {
      if (existsSync(SNAPSHOT_FILE)) {
        sendJson(response, 200, JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')))
      } else {
        sendJson(response, 404, { ok: false, error: '快照文件不存在' })
      }
      return
    }

    response.statusCode = 404
    response.end('Not Found')
  } catch (error) {
    sendJson(response, 500, { ok: false, error: error instanceof Error ? error.message : '服务异常' })
  }
}

// 端口占用兜底：5277 被占用时自动向后找下一个可用端口（避免 EADDRINUSE 直接崩溃）
const startServer = (port, attempts = 20) => {
  const serverInstance = createServer((request, response) => requestHandler(request, response))
  serverInstance.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && attempts > 0) {
      console.warn(`端口 ${port} 已被占用，尝试 ${port + 1} …`)
      startServer(port + 1, attempts - 1)
      return
    }
    throw error
  })
  serverInstance.listen(port, process.env.HOST || '127.0.0.1', () => {
    console.log(`std-crawler 演示服务已启动：http://127.0.0.1:${port}`)
    console.log(`业务模块：${listModules().map((item) => `${item.id}(${item.status})`).join('、')}`)
    console.log(`异步任务接口：POST /api/analyze（moduleId 缺省=analysis）→ GET /api/analyze/{jobId}（LLM ${readLlmConfig().baseUrl ? '已配置' : '未配置，将降级为显式键值'}）`)
  })
}

startServer(PORT)
