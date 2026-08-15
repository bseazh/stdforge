#!/usr/bin/env node

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parsePdf } from './mineru-client.mjs';

const root = resolve(import.meta.dirname);
const runtimeRoot = join(root, '.runtime');
const port = Number(process.env.PORT || 4173);
const token = process.env.MINERU_TOKEN;
const maxFileSize = 30 * 1024 * 1024;
const jobs = new Map();

await mkdir(runtimeRoot, { recursive: true });

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
    error: job.error
  };
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
    Object.assign(job, { state: 'failed', message: '解析失败', error: error.message });
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
    return json(response, 200, { ok: true, mineruConfigured: Boolean(token) });
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

server.listen(port, '127.0.0.1', () => {
  console.log(`StdForge PDF Parser: http://127.0.0.1:${port}`);
  console.log(`MinerU: ${token ? 'configured' : 'missing MINERU_TOKEN'}`);
});
