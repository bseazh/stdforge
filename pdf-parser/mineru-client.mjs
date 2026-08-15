import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);
const API_BASE = 'https://mineru.net/api/v4';

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0) throw new Error(body.msg || `MinerU HTTP ${response.status}`);
  return body;
}

export async function parsePdf({ token, pdfPath, fileName, outputDir, onStatus = () => {} }) {
  if (!token) throw new Error('MINERU_TOKEN is not configured');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const dataId = `${Date.now()}-${fileName}`.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 128);

  onStatus({ state: 'uploading', message: '正在申请安全上传地址' });
  const submitted = await requestJson(`${API_BASE}/file-urls/batch`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ files: [{ name: fileName, data_id: dataId }], model_version: 'vlm' })
  });
  const batchId = submitted.data.batch_id;
  const uploadUrl = submitted.data.file_urls?.[0];
  if (!batchId || !uploadUrl) throw new Error('MinerU did not return an upload URL');

  const pdf = await readFile(pdfPath);
  const upload = await fetch(uploadUrl, { method: 'PUT', body: pdf });
  if (!upload.ok) throw new Error(`PDF upload failed: HTTP ${upload.status}`);
  onStatus({ state: 'pending', message: '文件已上传，等待解析', batchId });

  let resultItem;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    await new Promise(resolveTimer => setTimeout(resolveTimer, 2000));
    const result = await requestJson(`${API_BASE}/extract-results/batch/${batchId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    resultItem = result.data.extract_result?.[0] ?? result.data.extract_results?.[0] ?? result.data.extract_result;
    if (!resultItem) throw new Error('MinerU returned an empty task result');
    onStatus({
      state: resultItem.state,
      message: resultItem.state === 'running' ? '正在识别版面、表格和正文' : '正在等待 MinerU 处理',
      progress: resultItem.extract_progress,
      batchId
    });
    if (resultItem.state === 'done') break;
    if (resultItem.state === 'failed') throw new Error(resultItem.err_msg || 'MinerU parsing failed');
  }
  if (resultItem?.state !== 'done' || !resultItem.full_zip_url) throw new Error('MinerU parsing timed out');

  onStatus({ state: 'converting', message: '正在整理解析结果', batchId });
  await mkdir(outputDir, { recursive: true });
  const archiveResponse = await fetch(resultItem.full_zip_url);
  if (!archiveResponse.ok) throw new Error(`Result download failed: HTTP ${archiveResponse.status}`);
  const archivePath = join(outputDir, 'mineru-result.zip');
  await writeFile(archivePath, Buffer.from(await archiveResponse.arrayBuffer()));
  await execFileAsync('/usr/bin/unzip', ['-oq', archivePath, '-d', outputDir]);
  const markdownPath = join(outputDir, 'full.md');
  const markdown = await readFile(markdownPath, 'utf8');
  onStatus({ state: 'done', message: '解析完成', batchId });

  return { batchId, markdown, markdownPath, archivePath };
}
