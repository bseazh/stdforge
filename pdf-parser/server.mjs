#!/usr/bin/env node

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { parsePdf, ResultDownloadError } from './mineru-client.mjs';
import { appendToFeishuDocument } from './feishu-mcp-client.mjs';

const root = resolve(import.meta.dirname);
const runtimeRoot = join(root, '.runtime');
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || '127.0.0.1';
const maxFileSize = 30 * 1024 * 1024;
const jobs = new Map();

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
const token = process.env.MINERU_TOKEN;
const feishuAppId = process.env.FEISHU_APP_ID;
const feishuAppSecret = process.env.FEISHU_APP_SECRET;
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

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxFileSize) throw new Error('PDF 文件不能超过 30 MB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonRequest(request) {
  const body = await readRequestBody(request);
  try { return JSON.parse(body.toString('utf8')); } catch { throw new Error('请求内容必须是 JSON'); }
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
    retryable: job.retryable === true
  };
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

async function sendSmtpTestNotification() {
  if (!transporter) throw new Error('服务端未配置 SMTP 邮件通知');
  const now = new Date();
  const sent = await transporter.sendMail({
    from: smtpFrom,
    to: notificationRecipients,
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
    Object.assign(job, result, { state: 'done', message: '解析完成' });
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
    return json(response, 200, { ok: true, mineruConfigured: Boolean(token), feishuConfigured: Boolean(feishuAppId && feishuAppSecret), smtpConfigured });
  }
  if (request.method === 'POST' && ['/api/notifications/review', '/api/notifications/test'].includes(url.pathname)) {
    if (!smtpConfigured) return json(response, 503, { error: '服务端未配置 SMTP 邮件通知' });
    const elapsed = Date.now() - lastNotificationAt;
    if (elapsed < notificationCooldownMs) {
      return json(response, 429, { error: '通知发送过于频繁，请稍后重试', retryAfterSeconds: Math.ceil((notificationCooldownMs - elapsed) / 1000) });
    }
    try {
      await readRequestBody(request);
      const result = url.pathname.endsWith('/test')
        ? await sendSmtpTestNotification()
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
      const body = await readRequestBody(request);
      if (body.subarray(0, 5).toString() !== '%PDF-') return json(response, 400, { error: '文件内容不是有效 PDF' });
      const id = randomUUID();
      const fileName = safeName(url.searchParams.get('filename'));
      const outputDir = join(runtimeRoot, id);
      const originalPath = join(outputDir, 'original.pdf');
      await mkdir(outputDir, { recursive: true });
      await writeFile(originalPath, body);
      const job = { id, fileName, size: body.length, outputDir, originalPath, state: 'queued', message: '任务已创建', createdAt: new Date().toISOString() };
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
