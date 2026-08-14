#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

const [inputPath, ...args] = process.argv.slice(2);
const outputFlag = args.indexOf('--output');
const outputDir = outputFlag >= 0 ? args[outputFlag + 1] : 'data/mineru';
const token = process.env.MINERU_TOKEN;

if (!inputPath || !token) {
  console.error('Usage: MINERU_TOKEN=<token> node scripts/mineru-parse.mjs <file.pdf> --output data/mineru/<name>');
  process.exit(1);
}

const apiBase = 'https://mineru.net/api/v4';
const fileName = basename(inputPath);
const dataId = fileName.replace(/[^A-Za-z0-9_.-]/g, '-');
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(body.msg || `HTTP ${response.status}`);
  return body;
}

const submitted = await requestJson(`${apiBase}/file-urls/batch`, {
  method: 'POST', headers,
  body: JSON.stringify({ files: [{ name: fileName, data_id: dataId }], model_version: 'vlm' })
});
const { batch_id: batchId, file_urls: fileUrls } = submitted.data;
const fileBytes = await readFile(inputPath);
const upload = await fetch(fileUrls[0], { method: 'PUT', body: fileBytes });
if (!upload.ok) throw new Error(`Upload failed: HTTP ${upload.status}`);

console.log(`MinerU task submitted: ${batchId}`);
let resultItem;
for (let attempt = 0; attempt < 90; attempt += 1) {
  await new Promise(resolveTimer => setTimeout(resolveTimer, 2000));
  const result = await requestJson(`${apiBase}/extract-results/batch/${batchId}`, { headers: { Authorization: `Bearer ${token}` } });
  resultItem = result.data.extract_result?.[0] ?? result.data.extract_results?.[0] ?? result.data.extract_result;
  console.log(`MinerU state: ${resultItem.state}`);
  if (resultItem.state === 'done') break;
  if (resultItem.state === 'failed') throw new Error(resultItem.err_msg || 'MinerU parsing failed');
}
if (resultItem?.state !== 'done' || !resultItem.full_zip_url) throw new Error('Timed out waiting for MinerU result');

await mkdir(outputDir, { recursive: true });
const archive = await fetch(resultItem.full_zip_url);
if (!archive.ok) throw new Error(`Result download failed: HTTP ${archive.status}`);
await writeFile(resolve(outputDir, 'mineru-result.zip'), Buffer.from(await archive.arrayBuffer()));
console.log(`Result archive saved to ${resolve(outputDir, 'mineru-result.zip')}`);
