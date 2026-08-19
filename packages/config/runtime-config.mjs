import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function readPositiveInteger(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function readRecipients(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

async function loadEnvFile(filePath, env) {
  try {
    const content = await readFile(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match && !env[match[1]]) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch {
    // Local configuration is optional. Production normally receives Secrets as environment variables.
  }
}

export async function loadRuntimeConfig({ root, env = process.env, loadLocalFiles = true } = {}) {
  if (loadLocalFiles) {
    await loadEnvFile(join(root, '.env.local'), env);
    await loadEnvFile(join(root, '.env.smtp.local'), env);
  }

  const smtp = {
    host: env.SMTP_HOST,
    port: readPositiveInteger(env.SMTP_PORT, 465, { min: 1, max: 65535 }),
    secure: env.SMTP_SECURE !== 'false',
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: env.SMTP_FROM || env.SMTP_USER,
    recipients: readRecipients(env.NOTIFICATION_RECIPIENTS),
    testAccessToken: env.NOTIFICATION_TEST_ACCESS_TOKEN,
    testRecipientLimit: readPositiveInteger(env.NOTIFICATION_TEST_RECIPIENT_LIMIT, 10, { min: 1, max: 20 }),
    cooldownMs: readPositiveInteger(env.NOTIFICATION_COOLDOWN_MS, 60_000, { min: 0, max: 3_600_000 })
  };
  const llm = {
    baseUrl: String(env.LLM_BASE_URL || '').replace(/\/$/, ''),
    apiKey: env.LLM_API_KEY,
    model: env.LLM_MODEL
  };
  const feishu = {
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    documentUrl: env.FEISHU_DOCUMENT_URL,
    approvalCode: env.FEISHU_APPROVAL_CODE,
    initiatorOpenId: env.FEISHU_INITIATOR_OPEN_ID
  };

  return Object.freeze({
    server: Object.freeze({
      host: env.HOST || '127.0.0.1',
      port: readPositiveInteger(env.PORT, 4173, { min: 1, max: 65535 })
    }),
    mineru: Object.freeze({ token: env.MINERU_TOKEN }),
    llm: Object.freeze(llm),
    feishu: Object.freeze(feishu),
    smtp: Object.freeze(smtp)
  });
}

export function getRuntimeConfigHealth(config) {
  const checks = {
    mineru: Boolean(config.mineru.token),
    llm: Boolean(config.llm.baseUrl && config.llm.apiKey && config.llm.model),
    feishuDocument: Boolean(config.feishu.appId && config.feishu.appSecret && config.feishu.documentUrl),
    feishuApproval: Boolean(config.feishu.appId && config.feishu.appSecret && config.feishu.approvalCode && config.feishu.initiatorOpenId),
    smtp: Boolean(config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from && config.smtp.recipients.length),
    smtpTestManagement: Boolean(config.smtp.testAccessToken)
  };
  return {
    checks,
    configured: Object.entries(checks).filter(([, configured]) => configured).map(([name]) => name),
    missing: Object.entries(checks).filter(([, configured]) => !configured).map(([name]) => name)
  };
}
