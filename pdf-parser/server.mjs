#!/usr/bin/env node

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { parsePdf, ResultDownloadError } from './mineru-client.mjs';
import { appendToFeishuDocument } from './feishu-mcp-client.mjs';
import { createApprovalInstance, getApprovalInstance } from './feishu-approval-client.mjs';
import { KnowledgeBase, knowledgeModules } from './kb-store.mjs';

const root = resolve(import.meta.dirname);
const runtimeRoot = join(root, '.runtime');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const maxFileSize = 30 * 1024 * 1024;
const jobs = new Map();
const kb = new KnowledgeBase(join(root, '../KB'));

await mkdir(runtimeRoot, { recursive: true });
for (const envFile of ['.env.local', '.env.smtp.local']) {
  try {
    const envText = await readFile(resolve(root, `../${envFile}`), 'utf8');
    for (const line of envText.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* Local config files are optional; deployment normally uses environment variables. */ }
}
await kb.init();
const token = process.env.MINERU_TOKEN;
const llmBaseUrl = (process.env.LLM_BASE_URL || '').replace(/\/$/, '');
const llmApiKey = process.env.LLM_API_KEY;
const llmModel = process.env.LLM_MODEL;
const feishuAppId = process.env.FEISHU_APP_ID;
const feishuAppSecret = process.env.FEISHU_APP_SECRET;
const feishuApprovalCode = process.env.FEISHU_APPROVAL_CODE;
const feishuInitiatorOpenId = process.env.FEISHU_INITIATOR_OPEN_ID;
const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpSecure = process.env.SMTP_SECURE !== 'false';
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || smtpUser;
const notificationRecipients = (process.env.NOTIFICATION_RECIPIENTS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const notificationTestAccessToken = process.env.NOTIFICATION_TEST_ACCESS_TOKEN;
const notificationTestRecipientLimit = Math.max(1, Math.min(20, Number(process.env.NOTIFICATION_TEST_RECIPIENT_LIMIT || 10)));
const notificationTestRecipientsPath = join(runtimeRoot, 'notification-test-recipients.json');
const notificationCooldownMs = Math.max(0, Number(process.env.NOTIFICATION_COOLDOWN_MS || 60_000));
const smtpConfigured = Boolean(smtpHost && smtpPort && smtpUser && smtpPass && smtpFrom && notificationRecipients.length);
const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000
    })
  : null;
let lastNotificationAt = 0;

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function safeName(value) {
  const cleaned = basename(value || 'document.pdf').replace(/[^\p{L}\p{N}_. -]/gu, '_');
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned}.pdf`;
}

function safeDocumentName(value) {
  return basename(value || 'document.txt').replace(/[^\p{L}\p{N}_. -]/gu, '_');
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxFileSize) throw new Error('文档不能超过 30 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonRequest(request) {
  const body = await readRequestBody(request);
  try { return JSON.parse(body.toString('utf8')); } catch { throw new Error('请求内容必须是 JSON'); }
}

function parseKbModule(value, fallback = 'standards') {
  const module = value || fallback;
  if (!knowledgeModules.includes(module)) throw new Error('知识库分区必须是 standard-drafting、standards 或 policies');
  return module;
}

function publicDocument(document) {
  const { chunks, ...rest } = document;
  return { ...rest, chunkCount: chunks.length };
}

async function generateGroundedAnswer(question, hits) {
  if (!hits.length) {
    return {
      mode: 'not-found',
      answer: '知识库中没有找到能够支撑该问题的内容。请上传相关标准、编写材料或政策原文后再提问。'
    };
  }
  const sources = hits.map((hit, index) => `【${index + 1}】${hit.title} / ${hit.heading || `片段 ${hit.chunk}`}\n${hit.text}`).join('\n\n');
  if (!llmBaseUrl || !llmApiKey || !llmModel) {
    return {
      mode: 'extractive',
      answer: `已检索到与“${question}”最相关的知识库内容。请结合以下引用片段核对；配置 LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL 后，可生成归纳回答。`
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmApiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: llmModel,
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: '你是标准化知识库问答助手。只能依据提供的知识库片段作答，不能补充片段外事实。回答使用中文，结论后必须以 [1]、[2] 形式标注依据；资料不足时明确说明。'
          },
          { role: 'user', content: `问题：${question}\n\n知识库片段：\n${sources}` }
        ]
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || `LLM HTTP ${response.status}`);
    const answer = body.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error('LLM 未返回可用回答');
    return { mode: 'llm', answer };
  } catch (error) {
    console.error('KB LLM answer failed:', error.message);
    return {
      mode: 'extractive',
      answer: `已完成知识库检索，但 LLM 生成暂时不可用。请依据下方引用片段核对答案。`
    };
  } finally {
    clearTimeout(timeout);
  }
}

function publicJob(job) {
  return {
    id: job.id,
    fileName: job.fileName,
    size: job.size,
    state: job.state,
    message: job.message,
    progress: job.progress,
    createdAt: job.createdAt,
    markdown: job.state === 'done' ? job.markdown : undefined,
    error: job.error,
    failureStage: job.failureStage,
    retryable: job.retryable === true,
    feishuSync: job.feishuSync,
    feishuApproval: job.feishuApproval,
    kb: job.kb
  };
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function hasTestManagementAccess(request) {
  const suppliedToken = request.headers['x-stdforge-test-token'];
  if (!notificationTestAccessToken || typeof suppliedToken !== 'string') return false;
  const expected = Buffer.from(notificationTestAccessToken);
  const supplied = Buffer.from(suppliedToken);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

async function readTestRecipientOverrides() {
  try {
    const stored = JSON.parse(await readFile(notificationTestRecipientsPath, 'utf8'));
    if (Array.isArray(stored)) return { added: stored.map(normalizeEmail).filter(Boolean), removed: [] };
    return {
      added: Array.isArray(stored.added) ? stored.added.map(normalizeEmail).filter(Boolean) : [],
      removed: Array.isArray(stored.removed) ? stored.removed.map(normalizeEmail).filter(Boolean) : []
    };
  } catch { return { added: [], removed: [] }; }
}

async function writeTestRecipientOverrides(overrides) {
  await writeFile(notificationTestRecipientsPath, `${JSON.stringify(overrides, null, 2)}\n`, { mode: 0o600 });
}

async function getTestRecipients() {
  const overrides = await readTestRecipientOverrides();
  const removed = new Set(overrides.removed);
  return [...new Set([...notificationRecipients.map(normalizeEmail).filter(Boolean), ...overrides.added])].filter(email => !removed.has(email));
}

async function addTestRecipient(value) {
  const email = normalizeEmail(value);
  if (!email) throw new Error('请输入有效的邮箱地址');
  const recipients = await getTestRecipients();
  if (recipients.includes(email)) return recipients;
  if (recipients.length >= notificationTestRecipientLimit) throw new Error(`测试收件人最多允许 ${notificationTestRecipientLimit} 个`);
  const overrides = await readTestRecipientOverrides();
  overrides.added = [...new Set([...overrides.added, email])];
  overrides.removed = overrides.removed.filter(value => value !== email);
  await writeTestRecipientOverrides(overrides);
  return [...recipients, email];
}

async function removeTestRecipient(value) {
  const email = normalizeEmail(value);
  if (!email) throw new Error('测试收件人地址无效');
  const recipients = await getTestRecipients();
  if (!recipients.includes(email)) return recipients;
  const overrides = await readTestRecipientOverrides();
  overrides.added = overrides.added.filter(value => value !== email);
  if (notificationRecipients.map(normalizeEmail).includes(email)) overrides.removed = [...new Set([...overrides.removed, email])];
  await writeTestRecipientOverrides(overrides);
  return getTestRecipients();
}

async function sendReviewNotification() {
  if (!transporter) throw new Error('服务端未配置 SMTP 邮件通知');
  const now = new Date();
  const sent = await transporter.sendMail({
    from: smtpFrom,
    to: notificationRecipients,
    subject: '[StdForge] GB/T 46274-2025 待专家评审',
    text: [
      'StdForge 已发起标准条款级评审。',
      '',
      '标准：GB/T 46274-2025 二手家用电器产品品质鉴定规范 洗衣机',
      '当前版本：v0.3 草案',
      '待处理问题：4 项',
      `发起时间：${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
      '',
      '请登录 StdForge 查看条款、提交意见并完成评审。'
    ].join('\n'),
    html: `
      <h2>标准条款级评审待处理</h2>
      <p>StdForge 已发起标准条款级评审。</p>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr><td style="padding:4px 16px 4px 0;color:#64748b">标准</td><td>GB/T 46274-2025 二手家用电器产品品质鉴定规范 洗衣机</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#64748b">当前版本</td><td>v0.3 草案</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#64748b">待处理问题</td><td>4 项</td></tr>
        <tr><td style="padding:4px 16px 4px 0;color:#64748b">发起时间</td><td>${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</td></tr>
      </table>
      <p>请登录 StdForge 查看条款、提交意见并完成评审。</p>`
  });
  return { messageId: sent.messageId, accepted: sent.accepted?.length || 0 };
}

async function sendSmtpTestNotification(recipients) {
  if (!transporter) throw new Error('服务端未配置 SMTP 邮件通知');
  const now = new Date();
  const sent = await transporter.sendMail({
    from: smtpFrom,
    to: recipients,
    subject: '[StdForge] SMTP 邮件连通性测试',
    text: [
      '这是一封由 StdForge 邮件通知测试页发出的连通性测试邮件。',
      '',
      `发送时间：${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`,
      'SMTP 配置已通过服务端发送流程验证。'
    ].join('\n'),
    html: `
      <h2>SMTP 邮件连通性测试</h2>
      <p>这是一封由 StdForge 邮件通知测试页发出的连通性测试邮件。</p>
      <p><strong>发送时间：</strong>${now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}</p>
      <p>SMTP 配置已通过服务端发送流程验证。</p>`
  });
  return { messageId: sent.messageId, accepted: sent.accepted?.length || 0 };
}

async function startParse(job) {
  try {
    const result = await parsePdf({
      token,
      pdfPath: job.originalPath,
      fileName: job.fileName,
      outputDir: job.outputDir,
      onStatus: update => Object.assign(job, update)
    });
    Object.assign(job, result, { state: 'indexing', message: '解析完成，正在写入知识库索引' });
    try {
      const indexed = await kb.upsertText({
        module: job.kbModule,
        fileName: job.fileName,
        text: result.markdown,
        source: { type: 'mineru-pdf', title: job.fileName.replace(/\.pdf$/i, '') }
      });
      job.kb = { document: publicDocument(indexed.document), reused: indexed.reused, indexedAt: new Date().toISOString() };
      Object.assign(job, { state: 'done', message: indexed.reused ? '解析完成，知识库已有相同文本' : '解析完成，知识库索引已更新' });
    } catch (indexError) {
      console.error('KB indexing failed:', indexError.message);
      Object.assign(job, { state: 'done', message: '解析完成，但知识库更新失败', kb: { error: indexError.message } });
    }
  } catch (error) {
    const resultDownloadFailed = error instanceof ResultDownloadError;
    if (resultDownloadFailed) {
      console.error('MinerU result archive download failed:', error.cause?.cause?.code || error.cause?.message || error.cause || error.message);
    } else {
      console.error('MinerU parse failed:', error.cause?.code || error.message);
    }
    Object.assign(job, {
      state: 'failed',
      message: resultDownloadFailed ? error.message : '解析失败',
      error: error.message,
      failureStage: resultDownloadFailed ? 'result-download' : 'parse',
      retryable: resultDownloadFailed
    });
  }
}

function sendDownload(response, path, downloadName, contentType) {
  response.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
    'Cache-Control': 'no-store'
  });
  createReadStream(path).pipe(response);
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(response, 200, {
      ok: true,
      mineruConfigured: Boolean(token),
      llmConfigured: Boolean(llmBaseUrl && llmApiKey && llmModel),
      knowledgeBase: kb.stats(),
      feishuConfigured: Boolean(feishuAppId && feishuAppSecret),
      feishuApprovalConfigured: Boolean(feishuApprovalCode && feishuInitiatorOpenId),
      smtpConfigured,
      smtpTestManagementConfigured: Boolean(notificationTestAccessToken)
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/kb') {
    return json(response, 200, { ok: true, modules: knowledgeModules, stats: kb.stats() });
  }
  if (request.method === 'GET' && url.pathname === '/api/kb/documents') {
    try {
      const module = url.searchParams.get('module') || undefined;
      return json(response, 200, { documents: kb.list({ module, limit: Number(url.searchParams.get('limit') || 100) }) });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/kb/imports') {
    let stagingPath;
    try {
      const module = parseKbModule(url.searchParams.get('module'));
      const fileName = safeDocumentName(url.searchParams.get('filename'));
      const extension = extname(fileName).toLowerCase();
      if (!['.txt', '.md', '.markdown', '.csv', '.docx'].includes(extension)) {
        return json(response, 415, { error: '知识库直接上传支持 TXT、Markdown、CSV 和 DOCX；PDF 请使用 /api/parse 解析后自动入库' });
      }
      const body = await readRequestBody(request);
      if (!body.length) return json(response, 400, { error: '上传文件为空' });
      const importId = randomUUID();
      stagingPath = join(runtimeRoot, `${importId}-${fileName}`);
      await writeFile(stagingPath, body);
      const indexed = await kb.importFile({ module, filePath: stagingPath, fileName, source: { type: 'upload', title: fileName.replace(/\.[^.]+$/, '') } });
      return json(response, indexed.reused ? 200 : 201, { ok: true, reused: indexed.reused, document: publicDocument(indexed.document), stats: kb.stats() });
    } catch (error) {
      return json(response, 400, { error: error.message });
    } finally {
      if (stagingPath) await unlink(stagingPath).catch(() => {});
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/kb/reindex') {
    try {
      return json(response, 200, { ok: true, stats: await kb.rebuildIndex() });
    } catch (error) {
      return json(response, 500, { error: `重建索引失败：${error.message}` });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/kb/search') {
    try {
      const { query, module, limit } = await readJsonRequest(request);
      const hits = kb.search(query, { module: module || undefined, limit: limit || 6 });
      return json(response, 200, { query, hits: hits.map(({ text, ...hit }) => hit) });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/kb/ask') {
    try {
      const { question, module } = await readJsonRequest(request);
      const hits = kb.search(question, { module: module || undefined, limit: 6 });
      const result = await generateGroundedAnswer(question, hits);
      return json(response, 200, {
        question,
        ...result,
        citations: hits.map(({ text, ...hit }, index) => ({ id: index + 1, ...hit }))
      });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/notifications/test-recipients') {
    return json(response, 200, { recipients: await getTestRecipients(), limit: notificationTestRecipientLimit });
  }
  if (request.method === 'POST' && url.pathname === '/api/notifications/test-recipients') {
    if (!notificationTestAccessToken) return json(response, 503, { error: '服务端未配置邮件测试授权码' });
    if (!hasTestManagementAccess(request)) return json(response, 401, { error: '测试授权码无效' });
    try {
      const { email } = await readJsonRequest(request);
      return json(response, 200, { recipients: await addTestRecipient(email), limit: notificationTestRecipientLimit });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  const removeRecipientMatch = url.pathname.match(/^\/api\/notifications\/test-recipients\/([^/]+)$/);
  if (request.method === 'DELETE' && removeRecipientMatch) {
    if (!notificationTestAccessToken) return json(response, 503, { error: '服务端未配置邮件测试授权码' });
    if (!hasTestManagementAccess(request)) return json(response, 401, { error: '测试授权码无效' });
    try {
      const email = decodeURIComponent(removeRecipientMatch[1]);
      return json(response, 200, { recipients: await removeTestRecipient(email), limit: notificationTestRecipientLimit });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (request.method === 'POST' && ['/api/notifications/review', '/api/notifications/test'].includes(url.pathname)) {
    if (!smtpConfigured) return json(response, 503, { error: '服务端未配置 SMTP 邮件通知' });
    const isTestRequest = url.pathname.endsWith('/test');
    if (isTestRequest && !notificationTestAccessToken) return json(response, 503, { error: '服务端未配置邮件测试授权码' });
    if (isTestRequest && !hasTestManagementAccess(request)) return json(response, 401, { error: '测试授权码无效' });
    const elapsed = Date.now() - lastNotificationAt;
    if (elapsed < notificationCooldownMs) {
      return json(response, 429, { error: '通知发送过于频繁，请稍后重试', retryAfterSeconds: Math.ceil((notificationCooldownMs - elapsed) / 1000) });
    }
    try {
      const requestBody = await readJsonRequest(request);
      const recipients = isTestRequest ? [...new Set((requestBody.recipients || []).map(normalizeEmail).filter(Boolean))] : notificationRecipients;
      if (isTestRequest) {
        const allowedRecipients = await getTestRecipients();
        if (!recipients.length) return json(response, 400, { error: '请至少选择一个测试收件人' });
        if (recipients.some(email => !allowedRecipients.includes(email))) return json(response, 400, { error: '所选邮箱不在测试收件人列表中' });
      }
      const result = isTestRequest
        ? await sendSmtpTestNotification(recipients)
        : await sendReviewNotification();
      lastNotificationAt = Date.now();
      return json(response, 200, { ok: true, accepted: result.accepted });
    } catch (error) {
      console.error('SMTP notification failed:', error.code || error.message);
      return json(response, 502, { error: '邮件服务器拒绝发送，请检查 SMTP 配置或授权码' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/parse') {
    if (!token) return json(response, 503, { error: '服务端未配置 MINERU_TOKEN' });
    if (!/application\/pdf/i.test(request.headers['content-type'] || '')) return json(response, 415, { error: '仅支持 PDF 文件' });
    try {
      const kbModule = parseKbModule(url.searchParams.get('module'));
      const body = await readRequestBody(request);
      if (body.subarray(0, 5).toString() !== '%PDF-') return json(response, 400, { error: '文件内容不是有效 PDF' });
      const id = randomUUID();
      const fileName = safeName(url.searchParams.get('filename'));
      const outputDir = join(runtimeRoot, id);
      const originalPath = join(outputDir, 'original.pdf');
      await mkdir(outputDir, { recursive: true });
      await writeFile(originalPath, body);
      const job = { id, fileName, size: body.length, outputDir, originalPath, kbModule, state: 'queued', message: '任务已创建', createdAt: new Date().toISOString() };
      jobs.set(id, job);
      void startParse(job);
      return json(response, 202, publicJob(job));
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  const jobMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)$/);
  if (request.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]);
    return job ? json(response, 200, publicJob(job)) : json(response, 404, { error: '任务不存在或服务已重启' });
  }
  const syncMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/sync\/feishu$/);
  if (request.method === 'POST' && syncMatch) {
    const job = jobs.get(syncMatch[1]);
    if (!job) return json(response, 404, { error: '任务不存在或服务已重启' });
    if (job.state !== 'done') return json(response, 409, { error: 'PDF 解析尚未完成' });
    if (!feishuAppId || !feishuAppSecret) return json(response, 503, { error: '服务端未配置飞书应用凭证' });
    try {
      const { docUrl } = await readJsonRequest(request);
      if (!/^https:\/\/[^/]*feishu\.cn\/wiki\//.test(docUrl || '') && !/^https:\/\/[^/]*feishu\.cn\/docx\//.test(docUrl || '')) {
        return json(response, 400, { error: '请输入有效的飞书文档或知识库文档链接' });
      }
      if (job.feishuSync?.docUrl === docUrl) return json(response, 200, { ...job.feishuSync, reused: true });
      const marker = `StdForge PDF 解析结果 · ${job.id}`;
      const markdown = `## ${marker}\n\n- 原始文件：${job.fileName}\n- 解析完成：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}\n- 解析引擎：MinerU VLM\n\n${job.markdown.replace(/!\[[^\]]*\]\([^\)]+\)/g, '> 解析图片请下载完整结果 ZIP 查看')}`;
      const result = await appendToFeishuDocument({ appId: feishuAppId, appSecret: feishuAppSecret, docUrl, markdown });
      job.feishuSync = { docUrl, syncedAt: new Date().toISOString(), ...result };
      return json(response, 200, job.feishuSync);
    } catch (error) {
      return json(response, 502, { error: error.message });
    }
  }
  const approvalCreateMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/approval\/feishu$/);
  if (request.method === 'POST' && approvalCreateMatch) {
    const job = jobs.get(approvalCreateMatch[1]);
    if (!job) return json(response, 404, { error: '任务不存在或服务已重启' });
    if (job.state !== 'done') return json(response, 409, { error: 'PDF 解析尚未完成' });
    if (!feishuAppId || !feishuAppSecret || !feishuApprovalCode || !feishuInitiatorOpenId) {
      return json(response, 503, { error: '服务端未配置飞书审批模板或发起人身份' });
    }
    if (!job.feishuSync?.docUrl) return json(response, 409, { error: '请先同步解析结果到飞书文档' });
    if (job.feishuApproval) return json(response, 200, { ...job.feishuApproval, reused: true });
    try {
      const requestBody = await readJsonRequest(request);
      const approval = await createApprovalInstance({
        appId: feishuAppId,
        appSecret: feishuAppSecret,
        approvalCode: feishuApprovalCode,
        initiatorOpenId: feishuInitiatorOpenId,
        docUrl: job.feishuSync.docUrl,
        jobId: job.id,
        fileName: job.fileName,
        standardNo: requestBody.standardNo,
        standardName: requestBody.standardName,
        reviewNote: requestBody.reviewNote,
        publishDate: requestBody.publishDate,
        publishMode: requestBody.publishMode
      });
      job.feishuApproval = {
        ...approval,
        docUrl: job.feishuSync.docUrl,
        status: 'PENDING',
        createdAt: new Date().toISOString()
      };
      return json(response, 201, job.feishuApproval);
    } catch (error) {
      return json(response, 502, { error: error.message });
    }
  }
  const approvalStatusMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/approval\/feishu$/);
  if (request.method === 'GET' && approvalStatusMatch) {
    const job = jobs.get(approvalStatusMatch[1]);
    if (!job) return json(response, 404, { error: '任务不存在或服务已重启' });
    if (!job.feishuApproval) return json(response, 404, { error: '尚未创建飞书审批实例' });
    try {
      const instance = await getApprovalInstance({ appId: feishuAppId, appSecret: feishuAppSecret, instanceCode: job.feishuApproval.instanceCode });
      const status = instance.status || job.feishuApproval.status;
      Object.assign(job.feishuApproval, { status, checkedAt: new Date().toISOString() });
      if (['APPROVED', 'REJECTED', 'CANCELED'].includes(status) && job.feishuApproval.writtenStatus !== status) {
        const resultLabel = status === 'APPROVED' ? '已批准' : status === 'REJECTED' ? '需修改' : '已取消';
        const markdown = `## StdForge 审批结果 · ${job.feishuApproval.instanceCode}\n\n- 状态：${resultLabel}\n- 审批实例：${job.feishuApproval.instanceCode}\n- 回写时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`;
        await appendToFeishuDocument({ appId: feishuAppId, appSecret: feishuAppSecret, docUrl: job.feishuApproval.docUrl, markdown });
        job.feishuApproval.writtenStatus = status;
      }
      return json(response, 200, job.feishuApproval);
    } catch (error) {
      return json(response, 502, { error: error.message });
    }
  }
  const downloadMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/download\/(original|markdown|archive)$/);
  if (request.method === 'GET' && downloadMatch) {
    const job = jobs.get(downloadMatch[1]);
    if (!job) return json(response, 404, { error: '任务不存在' });
    const kind = downloadMatch[2];
    if (kind !== 'original' && job.state !== 'done') return json(response, 409, { error: '解析尚未完成' });
    if (kind === 'original') return sendDownload(response, job.originalPath, job.fileName, 'application/pdf');
    if (kind === 'markdown') return sendDownload(response, job.markdownPath, `${job.fileName.replace(/\.pdf$/i, '')}.md`, 'text/markdown; charset=utf-8');
    return sendDownload(response, job.archivePath, `${job.fileName.replace(/\.pdf$/i, '')}-mineru.zip`, 'application/zip');
  }
  return json(response, 404, { error: 'API 路径不存在' });
}

async function serveStatic(response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const filePath = resolve(root, normalize(requested));
  if (!filePath.startsWith(`${root}/`) || filePath.includes('/.runtime/')) return json(response, 403, { error: '禁止访问' });
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('not file');
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  } catch {
    json(response, 404, { error: '页面不存在' });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else await serveStatic(response, url.pathname);
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`StdForge PDF Parser: http://${host}:${port}`);
  console.log(`MinerU: ${token ? 'configured' : 'missing MINERU_TOKEN'}`);
  console.log(`Feishu MCP: ${feishuAppId && feishuAppSecret ? 'configured' : 'missing FEISHU_APP_ID or FEISHU_APP_SECRET'}`);
  console.log(`SMTP notifications: ${smtpConfigured ? 'configured' : 'missing SMTP configuration'}`);
});
