import assert from 'node:assert/strict';
import { getRuntimeConfigHealth, loadRuntimeConfig } from '../packages/config/runtime-config.mjs';
import { failure, success } from '../packages/contracts/api-envelope.mjs';

const config = await loadRuntimeConfig({
  root: process.cwd(),
  loadLocalFiles: false,
  env: {
    PORT: '4175',
    LLM_BASE_URL: 'https://llm.example/v1/',
    LLM_API_KEY: 'test-key',
    LLM_MODEL: 'test-model',
    FEISHU_APP_ID: 'cli_test',
    FEISHU_APP_SECRET: 'test-secret',
    FEISHU_DOCUMENT_URL: 'https://example.feishu.cn/wiki/test',
    FEISHU_APPROVAL_CODE: 'approval_test',
    FEISHU_INITIATOR_OPEN_ID: 'ou_test',
    SMTP_HOST: 'smtp.example.com',
    SMTP_USER: 'sender@example.com',
    SMTP_PASS: 'test-pass',
    NOTIFICATION_RECIPIENTS: 'reviewer-a@example.com, reviewer-b@example.com'
  }
});

assert.equal(config.server.port, 4175);
assert.equal(config.llm.baseUrl, 'https://llm.example/v1');
assert.equal(config.smtp.recipients.length, 2);
assert.deepEqual(getRuntimeConfigHealth(config).missing, ['mineru', 'smtpTestManagement']);
assert.equal(success({ id: 'draft_1' }, { requestId: 'req_1', mode: 'mock' }).meta.mode, 'mock');
assert.equal(failure('BAD_REQUEST', 'invalid', { requestId: 'req_2' }).error.retryable, false);

console.log('P1 foundation checks passed');
