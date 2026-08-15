// 演示服务：托管页面 + 异步实时分析任务（真实爬取 + LLM）
// 运行：node serve-demo.mjs   → http://127.0.0.1:5277
// POST /api/analyze {config}     创建分析任务，返回 { jobId }
// GET  /api/analyze/:jobId        轮询进度与结果
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCase8Analysis } from './case8-pipeline.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 5277)
// 全部使用相对本文件的位置，迁移到任意目录均可运行
const DEMO_HTML = join(__dirname, '..', 'index.html')
const DEMO_APP_JS = join(__dirname, 'demo-app.js')
const CONFIG_FILE = join(__dirname, 'ds配置.json')
const QUERY_CONFIG_FILE = join(__dirname, 'case8-config.json')
const SNAPSHOT_FILE = join(__dirname, 'output', 'case8-scenario-data.json')
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

// 检索条件默认值：优先读取 case8-config.json（前端未传的字段用文件里的值）
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
      llmConcurrency: Number(parsed.llmConcurrency) || 3,
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
    }
  } catch {
    return {}
  }
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

const createJob = (config) => {
  const job = {
    id: `job-${Date.now()}-${++jobSeq}`,
    status: 'running',
    config,
    logs: [],
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
  }
  jobs.set(job.id, job)
  const llmConfig = readLlmConfig()
  const defaults = readQueryConfig()

  runCase8Analysis({
    keywords: Array.isArray(config.keywords) && config.keywords.filter(Boolean).length > 0
      ? config.keywords
      : (defaults.keywords && defaults.keywords.length > 0 ? defaults.keywords : ['冰箱', '保鲜', '食品保鲜']),
    types: Array.isArray(config.types) && config.types.filter(Boolean).length > 0
      ? config.types
      : (defaults.types && defaults.types.length > 0 ? defaults.types : ['gb', 'hb', 'db', 'plan']),
    startDate: config.startDate || defaults.startDate || '2021-01-01',
    endDate: config.endDate || defaults.endDate || new Date().toISOString().slice(0, 10),
    maxPages: Number(config.maxPages || defaults.maxPages || 1),
    pageSize: Number(config.pageSize || defaults.pageSize || 20),
    maxItems: Math.min(Number(config.maxItems || defaults.maxItems || 24), 60),
    concurrency: Math.min(Number(config.concurrency || 8), 12),
    searchConcurrency: Math.min(Number(config.searchConcurrency || defaults.searchConcurrency || 3), 6),
    llmConcurrency: Math.min(Number(config.llmConcurrency || defaults.llmConcurrency || 3), 8),
    groups: Array.isArray(config.groups) && config.groups.length > 0
      ? config.groups
      : (defaults.groups && defaults.groups.length > 0 ? defaults.groups : null),
    leadingRule: config.leadingRule || 'first',
    debug: Boolean(config.debug),
    llmConfig,
    onLog: (entry) => {
      job.logs.push(entry)
      if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200)
    },
  })
    .then((result) => {
      job.status = 'done'
      job.result = result
    })
    .catch((error) => {
      job.status = 'error'
      job.error = error instanceof Error ? error.message : '分析失败'
    })

  // 任务完成后 30 分钟清理
  setTimeout(() => jobs.delete(job.id), 30 * 60 * 1000).unref()
  return job
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${PORT}`)
  const pathname = url.pathname.replace(/^\/module2(?=\/)/, '')
  try {
    if (pathname === '/' || pathname === '/index.html') {
      if (!existsSync(DEMO_HTML)) {
        response.statusCode = 404
        response.end('未找到 module2/index.html')
        return
      }
      response.setHeader('content-type', 'text/html; charset=utf-8')
      response.end(readFileSync(DEMO_HTML, 'utf8'))
      return
    }

    if (pathname === '/std-crawler/demo-app.js') {
      if (!existsSync(DEMO_APP_JS)) {
        response.statusCode = 404
        response.end('未找到 demo-app.js')
        return
      }
      response.setHeader('content-type', 'application/javascript; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(readFileSync(DEMO_APP_JS, 'utf8'))
      return
    }

    if (pathname === '/api/health') {
      sendJson(response, 200, {
        ok: true,
        name: 'competitor-analysis-demo',
        port: PORT,
        llmConfigured: Boolean(readLlmConfig().baseUrl && readLlmConfig().apiKey),
      })
      return
    }

    if (pathname === '/api/analyze' && request.method === 'POST') {
      const config = await readJsonBody(request)
      if (!Array.isArray(config.keywords) || config.keywords.filter(Boolean).length === 0) {
        sendJson(response, 400, { ok: false, error: '至少需要一个关键词' })
        return
      }
      if (!Array.isArray(config.types) || config.types.filter(Boolean).length === 0) {
        sendJson(response, 400, { ok: false, error: '至少选择一个标准类型' })
        return
      }
      const job = createJob(config)
      sendJson(response, 202, { ok: true, jobId: job.id })
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
})

server.listen(PORT, process.env.HOST || '127.0.0.1', () => {
  console.log(`案例8 演示服务已启动：http://127.0.0.1:${PORT}`)
  console.log(`异步分析接口：POST /api/analyze → GET /api/analyze/{jobId}（LLM ${readLlmConfig().baseUrl ? '已配置' : '未配置，将降级为显式键值'}）`)
})
