// 前端公共核心：统一 API 客户端
// 契约：POST /api/analyze { moduleId, config } → 202 { ok, jobId }
//       GET  /api/analyze/:jobId → { ok, status: running|done|error, logs, result, error }
//       GET  /api/health        → { ok, modules: [{ id, name, status }], llmConfigured }

const API_ROOT = location.pathname.startsWith('/module2/') ? '/module2/api' : '/api'

export async function createJob(moduleId, config, { signal } = {}) {
  const response = await fetch(`${API_ROOT}/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ moduleId, config }),
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.ok || !data.jobId) {
    const error = new Error(data.error || `任务创建失败（HTTP ${response.status}）`)
    error.status = response.status
    error.body = data
    throw error
  }
  return data
}

export function pollJob(jobId, { onLog, intervalMs = 2500, maxAttempts = 600 } = {}) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    let lastLogCount = 0
    let stopped = false
    const timer = setInterval(async () => {
      if (stopped) return
      try {
        const response = await fetch(`${API_ROOT}/analyze/${encodeURIComponent(jobId)}`, { cache: 'no-store' })
        const data = await response.json()
        if (Array.isArray(data.logs) && data.logs.length > lastLogCount) {
          data.logs.slice(lastLogCount).forEach((entry) => {
            if (typeof onLog === 'function') onLog(entry)
          })
          lastLogCount = data.logs.length
        }
        if (data.status === 'done') {
          stopped = true
          clearInterval(timer)
          resolve(data.result)
        } else if (data.status === 'error') {
          stopped = true
          clearInterval(timer)
          reject(new Error(data.error || '任务失败'))
        }
      } catch (error) {
        attempts += 1
        if (attempts > 10) {
          stopped = true
          clearInterval(timer)
          reject(error)
        }
      }
    }, intervalMs)
  })
}

export async function fetchHealth({ signal } = {}) {
  const response = await fetch(`${API_ROOT}/health`, { cache: 'no-store', signal })
  if (!response.ok) throw new Error(`服务异常（HTTP ${response.status}）`)
  return response.json()
}
