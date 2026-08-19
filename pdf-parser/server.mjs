#!/usr/bin/env node

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, resolve } from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { getRuntimeConfigHealth, loadRuntimeConfig } from '../packages/config/runtime-config.mjs';
import { createRequestId, failure, success } from '../packages/contracts/api-envelope.mjs';
import { parsePdf, ResultDownloadError } from './mineru-client.mjs';
import { appendToFeishuDocument } from './feishu-mcp-client.mjs';
import { createApprovalInstance, getApprovalInstance } from './feishu-approval-client.mjs';
import { KnowledgeBase, knowledgeModules } from './kb-store.mjs';
import { crawlMiitPolicies, hydrateMiitPolicies, hydrateMiitPolicyDetails } from '../module3/source/server/miit-source.mjs';
import { analyzePolicies } from '../module3/source/server/policy-classifier.mjs';
import { interpretPolicy } from '../module3/source/server/policy-interpreter.mjs';

const root = resolve(import.meta.dirname);
const projectRoot = resolve(root, '..');
const runtimeRoot = join(root, '.runtime');
const maxFileSize = 30 * 1024 * 1024;
const jobs = new Map();
const kb = new KnowledgeBase(join(root, '../KDB'));

const demoInputCatalog = [
  {
    id: 'vehicle-refrigerator',
    title: '车载冰箱温控与性能技术要求',
    industry: '家电 / 制冷',
    defaultTemplateId: 'vehicle-refrigerator',
    fileName: 'vehicle-refrigerator-tech-requirements-demo.docx',
    markdownFile: 'vehicle-refrigerator-tech-requirements-demo.md',
    summary: '温控、能耗、噪声、低压保护与验证方案'
  },
  {
    id: 'evaporator-frost-capacity',
    title: '家用电冰箱蒸发器容霜性能技术要求',
    industry: '家电 / 制冷',
    defaultTemplateId: 'qbt-8144-evaporator-frost-capacity',
    fileName: 'evaporator-frost-capacity-tech-requirements-demo.docx',
    markdownFile: 'evaporator-frost-capacity-tech-requirements-demo.md',
    summary: '容霜质量、送风衰减、化霜和排水性能'
  },
  {
    id: 'automotive-cabin-air-filter',
    title: '汽车空调滤清器性能技术要求',
    industry: '汽车零部件',
    defaultTemplateId: 'automotive-cabin-air-filter',
    fileName: 'automotive-cabin-air-filter-tech-requirements-demo.docx',
    markdownFile: 'automotive-cabin-air-filter-tech-requirements-demo.md',
    summary: '阻力、过滤效率、容尘、密封与振动验证'
  },
  {
    id: 'central-air-conditioning-cleaning',
    title: '公共场所集中空调通风系统清洗消毒技术要求',
    industry: '建筑运维 / 公共卫生',
    defaultTemplateId: 'wst-10005-central-air-conditioning',
    fileName: 'central-air-conditioning-cleaning-disinfection-tech-requirements-demo.docx',
    markdownFile: 'central-air-conditioning-cleaning-disinfection-tech-requirements-demo.md',
    summary: '现场勘查、清洗消毒、效果评价和记录归档'
  }
];

const referenceTemplateCatalog = [
  {
    id: 'automotive-cabin-air-filter',
    title: '汽车空调滤清器产品参考模板',
    code: '用户提供 · 998',
    industry: '汽车零部件',
    fileName: 'automotive-cabin-air-filter-reference.pdf',
    downloadName: '998 汽车空调滤清器.pdf',
    textFile: 'automotive-cabin-air-filter-reference.md',
    pages: 24,
    extraction: '扫描件章节骨架',
    summary: '阻力、过滤效率、容尘、密封与安装接口'
  },
  {
    id: 'vehicle-refrigerator',
    title: '车载冰箱产品参考模板',
    code: '用户提供 · 1196',
    industry: '车载电器 / 制冷',
    fileName: 'vehicle-refrigerator-reference.pdf',
    downloadName: '1196 车载冰箱 一清.pdf',
    textFile: 'vehicle-refrigerator-reference.md',
    pages: 32,
    extraction: '扫描件章节骨架',
    summary: '温控、制冷性能、电源保护、能耗与可靠性'
  },
  {
    id: 'gbt-46274-washing-machine',
    title: '二手家用电器产品品质鉴定规范 洗衣机',
    code: 'GB/T 46274-2025',
    industry: '二手家电 / 品质鉴定',
    fileName: 'gbt-46274-washing-machine.pdf',
    downloadName: 'GB-T 46274-2025.pdf',
    textFile: 'gbt-46274-washing-machine.md',
    pages: 15,
    extraction: '原生文本已提取',
    summary: '鉴定流程、作业条件、技术要求、分级与报告'
  },
  {
    id: 'qbt-8144-evaporator-frost-capacity',
    title: '家用电冰箱蒸发器容霜能力要求和评价方法',
    code: 'QB/T 8144-2025',
    industry: '家电 / 制冷',
    fileName: 'qbt-8144-evaporator-frost-capacity.pdf',
    downloadName: 'QB-T 8144-2025 FDIS.pdf',
    textFile: 'qbt-8144-evaporator-frost-capacity.md',
    pages: 8,
    extraction: '原生文本已提取',
    summary: '容霜能力等级、测试条件与评价方法'
  },
  {
    id: 'wst-10005-central-air-conditioning',
    title: '公共场所集中空调通风系统清洗消毒规范',
    code: 'WS/T 10005-2023',
    industry: '建筑运维 / 公共卫生',
    fileName: 'wst-10005-central-air-conditioning.pdf',
    downloadName: 'WS-T 10005-2023 FDIS.pdf',
    textFile: 'wst-10005-central-air-conditioning.md',
    pages: 9,
    extraction: '原生文本已提取',
    summary: '现场准备、清洗消毒、效果、安全与档案管理'
  }
];

const standardTemplateOutline = `# 参考标准模板（演示）

## 常见章节结构
1. 封面
2. 前言
3. 范围
4. 规范性引用文件
5. 术语和定义
6. 分类与型号
7. 技术要求
8. 试验方法
9. 检验规则
10. 标志、包装、运输和贮存
11. 附录

## 映射约束
- 每条技术指标必须包含对象、条件、限值、单位和判定方式。
- 每项指标应能定位到至少一个试验步骤和数据记录。
- 未确认的标准编号、限值、起草单位、法规和引用关系不得由模型补造。
- 输入中标记为“演示目标，待确认”的数值必须原样保留。`;

await mkdir(runtimeRoot, { recursive: true });
const runtimeConfig = await loadRuntimeConfig({ root: projectRoot });
await kb.init();
const { server: serverConfig, mineru: { token }, llm, feishu, smtp } = runtimeConfig;
const { host, port } = serverConfig;
const { baseUrl: llmBaseUrl, apiKey: llmApiKey, model: llmModel } = llm;
const policyModelConfig = { baseUrl: llmBaseUrl, apiKey: llmApiKey, model: llmModel };
const { appId: feishuAppId, appSecret: feishuAppSecret, documentUrl: feishuDocumentUrl, approvalCode: feishuApprovalCode, initiatorOpenId: feishuInitiatorOpenId } = feishu;
const { host: smtpHost, port: smtpPort, secure: smtpSecure, user: smtpUser, pass: smtpPass, from: smtpFrom, recipients: notificationRecipients, testAccessToken: notificationTestAccessToken, testRecipientLimit: notificationTestRecipientLimit, cooldownMs: notificationCooldownMs } = smtp;
const notificationTestRecipientsPath = join(runtimeRoot, 'notification-test-recipients.json');
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

const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.md': 'text/markdown; charset=utf-8' };
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

function mergedPdfKnowledgeText(result) {
  if (!result.nativeText?.trim()) return result.markdown;
  return `${result.markdown}\n\n# 原始 PDF 文本（数值与表格校验）\n\n${result.nativeText}`;
}

function questionIntent(question) {
  if (/环境|温度|摄氏|湿度|鉴定条件/.test(question)) return '鉴定环境与数值范围';
  if (/试验|测试|检测/.test(question)) return '试验或检测要求';
  if (/引用|标准号/.test(question)) return '规范性引用文件';
  return '标准内容问答';
}

function findDirectEvidence(question, hits) {
  if (!/环境|温度|摄氏/.test(question)) return null;
  const range = /环境温度\s*[:：]?\s*(?:为|在|应为)?\s*(-?\d+(?:\.\d+)?\s*(?:℃|°\s*C|摄氏度))\s*(?:~|～|至|到|-|—)\s*(-?\d+(?:\.\d+)?\s*(?:℃|°\s*C|摄氏度))/m;
  for (const [index, hit] of hits.entries()) {
    const match = hit.text.match(range);
    if (!match) continue;
    const low = match[1].replace(/\s+/g, ' ');
    const high = match[2].replace(/\s+/g, ' ');
    const start = Math.max(0, match.index - 90);
    const end = Math.min(hit.text.length, match.index + match[0].length + 130);
    return {
      citationId: index + 1,
      excerpt: `${start ? '...' : ''}${hit.text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < hit.text.length ? '...' : ''}`,
      answer: `二手洗衣机产品鉴定应在室内进行，环境温度为 ${low}~${high}。`
    };
  }
  return null;
}

function retrievalTrace(question, hits, directEvidence) {
  const selected = hits.slice(0, 3).map((hit, index) => `证据 [${hit.id || index + 1}]：${hit.title}${hit.heading ? ` / ${hit.heading}` : ''}`).join('；');
  const trace = [
    `问题识别：${questionIntent(question)}`,
    `检索范围：命中 ${hits.length} 个相关片段${selected ? `；${selected}` : ''}`
  ];
  trace.push(directEvidence ? `数值核验：在证据 [${directEvidence.citationId}] 中找到可直接引用的温度范围。` : '答案生成：仅使用命中片段中的可引用内容。');
  return trace;
}

function parseStructuredAnswer(content) {
  const candidate = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const result = JSON.parse(candidate);
    return typeof result.answer === 'string' && result.answer.trim() ? result : null;
  } catch {
    return null;
  }
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

async function generateGroundedAnswer(question, hits, directEvidence, responseMode = 'llm') {
  if (!hits.length) {
    return {
      mode: 'not-found',
      answer: '知识库中没有找到能够支撑该问题的内容。请上传相关标准、编写材料或政策原文后再提问。'
    };
  }
  if (directEvidence && responseMode === 'evidence') return { mode: 'evidence', answer: directEvidence.answer };
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
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是标准化知识库问答助手。只能依据提供的知识库片段作答，不能补充片段外事实。先给用户可直接使用的结论，再给必要条件。不得把知识库中存在的数值说成缺失。只返回 JSON：{"answer":"中文回答，结论后使用 [1]、[2] 标注依据","evidenceIds":[1,2]}。evidenceIds 必须与 answer 中实际出现的引用编号完全一致。不要输出内部推理过程。'
          },
          { role: 'user', content: `问题：${question}\n\n知识库片段：\n${sources}` }
        ]
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || `LLM HTTP ${response.status}`);
    const structured = parseStructuredAnswer(body.choices?.[0]?.message?.content);
    if (!structured) throw new Error('LLM 未返回结构化回答');
    const declaredEvidenceIds = [...new Set((Array.isArray(structured.evidenceIds) ? structured.evidenceIds : [])
      .map(Number)
      .filter(id => Number.isInteger(id) && id >= 1 && id <= hits.length))];
    const markedEvidenceIds = [...new Set([...structured.answer.matchAll(/\[(\d+)\]/g)]
      .map(match => Number(match[1]))
      .filter(id => Number.isInteger(id) && id >= 1 && id <= hits.length))];
    const evidenceIds = markedEvidenceIds.length ? markedEvidenceIds : declaredEvidenceIds;
    if (!evidenceIds.length) throw new Error('LLM 未返回可核验的引用编号');
    return { mode: 'llm', answer: structured.answer, evidenceIds };
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
        text: mergedPdfKnowledgeText(result),
        source: { type: result.nativeText ? 'mineru-pdf+native-text' : 'mineru-pdf', title: job.fileName.replace(/\.pdf$/i, ''), fileHash: job.originalHash }
      });
      job.kb = { document: publicDocument(indexed.document), reused: indexed.reused, replaced: indexed.replaced === true, indexedAt: new Date().toISOString() };
      Object.assign(job, { state: 'done', message: indexed.reused ? '解析完成，知识库已有相同文本' : indexed.replaced ? '解析完成，已替换同名文档索引' : '解析完成，知识库索引已更新' });
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

async function createPdfParseJob({ body, fileName, kbModule }) {
  if (!token) throw new Error('服务端未配置 MINERU_TOKEN');
  if (body.subarray(0, 5).toString() !== '%PDF-') throw new Error('文件内容不是有效 PDF');
  const id = randomUUID();
  const outputDir = join(runtimeRoot, id);
  const originalPath = join(outputDir, 'original.pdf');
  await mkdir(outputDir, { recursive: true });
  await writeFile(originalPath, body);
  const job = {
    id,
    fileName: safeName(fileName),
    size: body.length,
    outputDir,
    originalPath,
    originalHash: createHash('sha256').update(body).digest('hex'),
    kbModule,
    state: 'queued',
    message: '任务已创建',
    createdAt: new Date().toISOString()
  };
  jobs.set(id, job);
  void startParse(job);
  return job;
}

async function importKnowledgeFile({ module, fileName, body }) {
  const extension = extname(fileName).toLowerCase();
  if (!['.txt', '.md', '.markdown', '.csv', '.docx'].includes(extension)) {
    throw new Error('知识库直接上传支持 TXT、Markdown、CSV 和 DOCX；PDF 将自动进入解析队列');
  }
  if (!body.length) throw new Error('上传文件为空');
  const importId = randomUUID();
  const stagingPath = join(runtimeRoot, `${importId}-${fileName}`);
  try {
    await writeFile(stagingPath, body);
    const indexed = await kb.importFile({
      module,
      filePath: stagingPath,
      fileName,
      source: { type: 'upload', title: fileName.replace(/\.[^.]+$/, ''), fileHash: createHash('sha256').update(body).digest('hex') }
    });
    const text = await readFile(resolve(kb.root, indexed.document.textPath), 'utf8');
    return { ...indexed, text };
  } finally {
    await unlink(stagingPath).catch(() => {});
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

async function sendInline(request, response, path, contentType) {
  const fileStat = await stat(path);
  const headers = {
    'Content-Type': contentType,
    'Content-Disposition': 'inline',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes'
  };
  const range = request.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), fileStat.size - 1) : fileStat.size - 1;
    if (!match || start > end || start >= fileStat.size) {
      response.writeHead(416, { ...headers, 'Content-Range': `bytes */${fileStat.size}` });
      return response.end();
    }
    response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${fileStat.size}`, 'Content-Length': end - start + 1 });
    if (request.method === 'HEAD') return response.end();
    return createReadStream(path, { start, end }).pipe(response);
  }
  response.writeHead(200, { ...headers, 'Content-Length': fileStat.size });
  if (request.method === 'HEAD') return response.end();
  createReadStream(path).pipe(response);
}

function getDemoInput(id) {
  return demoInputCatalog.find(item => item.id === id);
}

function getReferenceTemplate(id) {
  return referenceTemplateCatalog.find(item => item.id === id);
}

function fallbackDraftDocuments({ sourceName, sourceText, templateName }) {
  const sourceTitle = sourceName.replace(/\.(docx|pdf|md|markdown|txt)$/i, '');
  const excerpt = sourceText.trim().slice(0, 5200);
  const templateLabel = templateName || 'GB/T 1.1 常见章节结构（演示）';
  return {
    standardDraft: `# ${sourceTitle}（标准草案演示稿）\n\n> 模板：${templateLabel}\n> 状态：演示草案，待标准化人员审查\n\n## 前言\n本文件根据研发技术要求整理生成。标准编号、归口单位、起草单位、发布日期及规范性引用关系待确认。\n\n## 1 范围\n本文件规定相关产品或服务的功能、性能、试验方法和验收要求。适用范围以输入材料为准，正式发布前需核验产品边界。\n\n## 2 规范性引用文件\n输入材料提及的参考文件仅作为编制线索，现行有效性和适用条款待人工确认。\n\n## 3 术语和定义\n术语应以产品对象、测量对象和判定规则为边界整理；未在输入中定义的术语不由模型擅自扩展。\n\n## 4 技术要求\n${sourceText.match(/## 3[\\s\\S]*?(?=## 4|$)/)?.[0] || '根据输入材料提取功能、安全和性能指标。'}\n\n## 5 试验方法\n试验方法应逐项对应技术指标，明确样品、环境、仪器、测点、步骤、计算和结果判定。输入材料中尚未确认的条件保留为“待确认”。\n\n## 6 检验规则\n样品数量、抽样、复测和合格判定按输入材料整理，正式批量检验规则待质量部门确认。\n\n## 7 标志、包装、运输和贮存\n根据产品交付要求补充铭牌、警示、包装、运输和贮存内容；输入未提供的字段标记为待确认。\n\n### 附录 A（资料性）试验记录表\n建议字段：样品编号、仪器编号、环境条件、原始数据、计算结果、异常和结论。\n\n### 来源输入摘录\n${excerpt}`,
    compilationNotes: `# ${sourceTitle} 编制说明（演示稿）\n\n## 1 编制目的和意义\n将研发技术要求转换为可评审、可验证、可追溯的标准条款，减少邮件和表格流转中的信息损失。\n\n## 2 编制依据\n- 输入研发技术要求：${sourceName}\n- 参考模板：${templateLabel}\n- 参考文件、法规和指标有效性：待人工确认\n\n## 3 主要技术内容\n围绕范围、术语、技术要求、试验方法和检验规则建立条款结构；每个指标保留来源和待确认状态。\n\n## 4 与现行标准关系\n本演示仅依据输入材料和模板结构建立映射，未宣称替代、修改或等同任何现行标准。\n\n## 5 待确认事项\n请研发、质量、法规和标准化人员确认数值阈值、试验复现条件、引用文件及发布属性。`,
    preResearchReport: `# ${sourceTitle} 预研报告（演示稿）\n\n## 1 立项必要性\n输入材料包含明确的产品或服务场景及性能问题，可作为建立统一技术要求的预研起点。\n\n## 2 国内外现状\n当前仅基于用户提供的输入和参考模板进行结构化演示，外部标准检索和对比需在正式预研阶段补充。\n\n## 3 技术路线\n研发输入解析 → 字段缺口检查 → 模板条款映射 → 试验验证 → 专家评审 → 版本发布。\n\n## 4 关键风险\n演示指标、法规适用性、样品抽样、设备精度和判定规则均需人工确认，模型不得替代试验或合规审查。\n\n## 5 预期效益\n形成可编辑、可追溯、可同步协同的标准草案及配套编制材料。`
  };
}

function parseJsonObject(content) {
  const candidate = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const value = JSON.parse(candidate);
    if (value && typeof value.standardDraft === 'string' && typeof value.compilationNotes === 'string' && typeof value.preResearchReport === 'string') return value;
  } catch { /* fall through to deterministic demo output */ }
  return null;
}

async function generateDraftDocuments({ sourceName, sourceText, templateName, templateText }) {
  const fallback = fallbackDraftDocuments({ sourceName, sourceText, templateName });
  if (!llmBaseUrl || !llmApiKey || !llmModel) return { ...fallback, mode: 'fallback', model: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${llmApiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: llmModel,
        temperature: 0.15,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是标准化工程师。请将研发技术要求映射为标准草案、编制说明、预研报告。只能改写和重组输入事实，不能创造标准编号、法规、起草单位或指标。所有“演示目标，待确认”必须保留。按常见 GB/T 1.1 章节组织标准草案。只返回 JSON：{"standardDraft":"Markdown","compilationNotes":"Markdown","preResearchReport":"Markdown"}。'
          },
          {
            role: 'user',
            content: `研发输入文件：${sourceName}\n参考模板：${templateName || 'GB/T 1.1 常见章节结构'}\n\n模板结构：\n${(templateText || standardTemplateOutline).slice(0, 16_000)}\n\n研发技术要求：\n${sourceText.slice(0, 28_000)}`
          }
        ]
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || `LLM HTTP ${response.status}`);
    const result = parseJsonObject(body.choices?.[0]?.message?.content);
    if (!result) throw new Error('LLM 未返回完整三类文档');
    return { ...result, mode: 'llm', model: llmModel };
  } catch (error) {
    console.error('Draft generation fallback:', error.message);
    return { ...fallback, mode: 'fallback', model: null, warning: `LLM 暂不可用，已使用演示映射：${error.message}` };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/v1/health') {
    const configHealth = getRuntimeConfigHealth(runtimeConfig);
    return json(response, 200, success({
      service: 'stdforge-api',
      knowledgeBase: kb.stats(),
      integrations: configHealth.checks
    }, {
      requestId: String(response.getHeader('X-Request-ID')),
      mode: 'live',
      source: [{ type: 'runtime-config', configured: configHealth.configured, missing: configHealth.missing }]
    }));
  }
  if (request.method === 'POST' && url.pathname === '/api/crawl/miit') {
    try {
      const input = await readJsonRequest(request);
      const result = await crawlMiitPolicies(input);
      return json(response, 200, result);
    } catch (error) {
      return json(response, 502, { error: error.message || '工信部政策采集失败' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/classify/policies') {
    try {
      const input = await readJsonRequest(request);
      const policies = await hydrateMiitPolicies(input.policies);
      const result = await analyzePolicies(policies, { config: policyModelConfig });
      return json(response, 200, result);
    } catch (error) {
      return json(response, 502, { error: error.message || '政策分类失败' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/interpret/policy') {
    try {
      const input = await readJsonRequest(request);
      const policy = await hydrateMiitPolicyDetails(input.policy);
      const result = await interpretPolicy({ ...input, policy }, { config: policyModelConfig });
      return json(response, 200, result);
    } catch (error) {
      return json(response, 502, { error: error.message || '政策解读失败' });
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(response, 200, {
      ok: true,
      mineruConfigured: Boolean(token),
      llmConfigured: Boolean(llmBaseUrl && llmApiKey && llmModel),
      knowledgeBase: kb.stats(),
      feishuConfigured: Boolean(feishuAppId && feishuAppSecret),
      feishuDocumentConfigured: Boolean(feishuDocumentUrl),
      feishuApprovalConfigured: Boolean(feishuApprovalCode && feishuInitiatorOpenId),
      smtpConfigured,
      smtpTestManagementConfigured: Boolean(notificationTestAccessToken)
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/demo-inputs') {
    return json(response, 200, {
      inputs: demoInputCatalog.map(item => ({
        ...item,
        downloadUrl: `/api/demo-inputs/${item.id}/download`,
        previewUrl: `/api/demo-inputs/${item.id}/preview`
      })),
      template: { name: 'GB/T 1.1 常见章节结构（演示）', text: standardTemplateOutline }
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/reference-templates') {
    return json(response, 200, {
      templates: referenceTemplateCatalog.map(item => ({
        ...item,
        previewUrl: `/api/reference-templates/${item.id}/preview`,
        downloadUrl: `/api/reference-templates/${item.id}/download`,
        textUrl: `/api/reference-templates/${item.id}/text`
      }))
    });
  }
  const referenceTemplateMatch = url.pathname.match(/^\/api\/reference-templates\/([a-z0-9-]+)\/(preview|text|download)$/);
  if (referenceTemplateMatch) {
    const item = getReferenceTemplate(referenceTemplateMatch[1]);
    if (!item) return json(response, 404, { error: '参考模板不存在' });
    const templatePath = join(root, '../reference-templates', item.fileName);
    if (referenceTemplateMatch[2] === 'preview') {
      try { await stat(templatePath); } catch { return json(response, 404, { error: '参考模板原件不存在' }); }
      if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: '不支持的请求方法' });
      return sendInline(request, response, templatePath, 'application/pdf');
    }
    if (referenceTemplateMatch[2] === 'text') {
      try {
        return json(response, 200, {
          id: item.id,
          title: item.title,
          text: await readFile(join(root, '../reference-templates', item.textFile), 'utf8'),
          extraction: item.extraction
        });
      } catch { return json(response, 404, { error: '参考模板文本不存在' }); }
    }
    try { await stat(templatePath); } catch { return json(response, 404, { error: '参考模板原件不存在' }); }
    return sendDownload(response, templatePath, item.downloadName, 'application/pdf');
  }
  const demoPreviewMatch = url.pathname.match(/^\/api\/demo-inputs\/([a-z0-9-]+)\/(preview|download)$/);
  if (demoPreviewMatch) {
    const item = getDemoInput(demoPreviewMatch[1]);
    if (!item) return json(response, 404, { error: '演示输入不存在' });
    const markdownPath = join(root, '../demo-inputs', item.markdownFile);
    if (demoPreviewMatch[2] === 'preview') {
      try {
        return json(response, 200, { id: item.id, title: item.title, markdown: await readFile(markdownPath, 'utf8') });
      } catch { return json(response, 404, { error: '演示输入预览文件不存在' }); }
    }
    const docxPath = join(root, '../demo-inputs', item.fileName);
    try { await stat(docxPath); } catch { return json(response, 404, { error: '演示输入文件不存在' }); }
    return sendDownload(response, docxPath, item.fileName, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }
  if (request.method === 'POST' && url.pathname === '/api/drafts/generate') {
    try {
      const payload = await readJsonRequest(request);
      if (!payload.sourceName || !payload.sourceText) throw new Error('缺少研发输入文档内容');
      const result = await generateDraftDocuments({
        sourceName: String(payload.sourceName).slice(0, 240),
        sourceText: String(payload.sourceText).slice(0, 36_000),
        templateName: String(payload.templateName || '').slice(0, 240),
        templateText: String(payload.templateText || '').slice(0, 18_000)
      });
      return json(response, 200, { ok: true, ...result, generatedAt: new Date().toISOString() });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/drafts/sync/feishu') {
    if (!feishuAppId || !feishuAppSecret) return json(response, 503, { error: '服务端未配置飞书应用凭证' });
    if (!feishuDocumentUrl) return json(response, 503, { error: '服务端未配置 FEISHU_DOCUMENT_URL 目标飞书文档链接' });
    if (!/^https:\/\/[^/]*feishu\.cn\/(wiki|docx)\//.test(feishuDocumentUrl)) return json(response, 503, { error: 'FEISHU_DOCUMENT_URL 不是有效的飞书知识库或 Docx 链接' });
    try {
      const payload = await readJsonRequest(request);
      const markdown = String(payload.markdown || '').trim();
      if (!markdown) throw new Error('缺少待同步的标准草案内容');
      const sourceName = String(payload.sourceName || '未命名研发输入').slice(0, 240);
      const templateName = String(payload.templateName || '未命名模板').slice(0, 240);
      const marker = createHash('sha256').update(`${feishuDocumentUrl}\n${markdown}`).digest('hex').slice(0, 16);
      const content = `## StdForge 模块一标准草案 · ${marker}\n\n- 研发输入：${sourceName}\n- 参考模板：${templateName}\n- 同步时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}\n- 同步方式：追加写入，不覆盖飞书内既有内容\n\n${markdown.slice(0, 36_000)}`;
      const result = await appendToFeishuDocument({ appId: feishuAppId, appSecret: feishuAppSecret, docUrl: feishuDocumentUrl, markdown: content });
      return json(response, 200, { ok: true, docUrl: feishuDocumentUrl, marker, syncedAt: new Date().toISOString(), ...result });
    } catch (error) {
      return json(response, 502, { error: error.message });
    }
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
    try {
      const module = parseKbModule(url.searchParams.get('module'));
      const fileName = safeDocumentName(url.searchParams.get('filename'));
      const body = await readRequestBody(request);
      const indexed = await importKnowledgeFile({ module, fileName, body });
      return json(response, indexed.reused ? 200 : 201, { ok: true, reused: indexed.reused, document: publicDocument(indexed.document), text: indexed.text, stats: kb.stats() });
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/kb/ingest') {
    try {
      const module = parseKbModule(url.searchParams.get('module'));
      const fileName = safeDocumentName(url.searchParams.get('filename'));
      const body = await readRequestBody(request);
      if (extname(fileName).toLowerCase() === '.pdf') {
        const job = await createPdfParseJob({ body, fileName, kbModule: module });
        return json(response, 202, { ok: true, kind: 'pdf-job', job: publicJob(job) });
      }
      const indexed = await importKnowledgeFile({ module, fileName, body });
      return json(response, indexed.reused ? 200 : 201, { ok: true, kind: 'document', reused: indexed.reused, document: publicDocument(indexed.document), text: indexed.text, stats: kb.stats() });
    } catch (error) {
      const isPdfConfigError = error.message === '服务端未配置 MINERU_TOKEN';
      return json(response, isPdfConfigError ? 503 : 400, { error: error.message });
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
      const startedAt = performance.now();
      const { question, module } = await readJsonRequest(request);
      const selectedMode = 'llm';
      const hits = kb.search(question, { module: module || undefined, limit: 6 });
      const retrievalMs = performance.now() - startedAt;
      const directEvidence = findDirectEvidence(question, hits);
      const generationStartedAt = performance.now();
      const result = await generateGroundedAnswer(question, hits, directEvidence, selectedMode);
      const generationMs = performance.now() - generationStartedAt;
      const citedHitIndexes = result.mode === 'llm'
        ? result.evidenceIds
        : hits.length ? [1] : [];
      const citations = citedHitIndexes.map(citationId => {
        const hit = hits[citationId - 1];
        if (!hit) return null;
        const { text, ...publicHit } = hit;
        return {
          id: citationId,
          ...publicHit,
          excerpt: directEvidence?.citationId === citationId ? directEvidence.excerpt : hit.excerpt
        };
      }).filter(Boolean);
      return json(response, 200, {
        question,
        ...result,
        execution: {
          strategy: result.mode === 'evidence' ? 'evidence' : result.mode === 'llm' ? 'llm' : 'extractive',
          retrievalMs: Math.round(retrievalMs),
          generationMs: Math.round(generationMs),
          totalMs: Math.round(performance.now() - startedAt),
          llmRequested: true,
          llmUsed: result.mode === 'llm'
        },
        trace: retrievalTrace(question, citations, result.mode === 'evidence' ? directEvidence : null),
        citations
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
      const job = await createPdfParseJob({ body, fileName: url.searchParams.get('filename'), kbModule });
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
  const requestId = createRequestId();
  response.setHeader('X-Request-ID', requestId);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(request, response, url);
    else await serveStatic(response, url.pathname);
  } catch (error) {
    if (url.pathname.startsWith('/api/v1/')) {
      json(response, 500, failure('INTERNAL_ERROR', '服务内部错误', { requestId, retryable: false }));
    } else {
      json(response, 500, { error: error.message });
    }
  }
});

server.listen(port, host, () => {
  console.log(`StdForge PDF Parser: http://${host}:${port}`);
  console.log(`MinerU: ${token ? 'configured' : 'missing MINERU_TOKEN'}`);
  console.log(`Feishu MCP: ${feishuAppId && feishuAppSecret ? 'configured' : 'missing FEISHU_APP_ID or FEISHU_APP_SECRET'}`);
  console.log(`SMTP notifications: ${smtpConfigured ? 'configured' : 'missing SMTP configuration'}`);
});
