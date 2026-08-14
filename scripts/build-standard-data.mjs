#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const sourceDir = process.argv[2] || 'data/mineru/GBT46274-2025';
const outputPath = process.argv[3] || 'data/standard-data.js';
const fileNames = await readdir(sourceDir);
const contentFile = fileNames.find(name => name.endsWith('_content_list.json'));
if (!contentFile) throw new Error(`No MinerU content list found in ${sourceDir}`);

const items = JSON.parse(await readFile(join(sourceDir, contentFile), 'utf8'));
const markdown = await readFile(join(sourceDir, 'full.md'), 'utf8');
const text = items.map(item => item.text || '').join('\n');
const title = (markdown.match(/^# 二手家用电器产品品质鉴定规范.*$/m)?.[0] || '二手家用电器产品品质鉴定规范 洗衣机').replace(/^#\s*/, '');
const standardNo = (text.match(/GB\/T\s*46274[—-]?\s*2025/)?.[0] || 'GB/T 46274-2025').replace(/\s*/g, '').replace('GB/T', 'GB/T ').replace('—', '-');
const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)].map(match => match[1].trim());
const normalizeNumber = rawNo => {
  if (rawNo.length === 1 || rawNo === '10') return rawNo;
  if (rawNo.length === 2) return `${rawNo[0]}.${rawNo[1]}`;
  return rawNo.startsWith('10') ? `10.${rawNo[2]}` : rawNo.split('').join('.');
};
const clauses = [];
for (let index = 0; index < headings.length; index += 1) {
  const heading = headings[index];
  if (heading === '目 次') continue;
  const inline = heading.match(/^(\d{1,3})\s+(.+)/);
  const bare = heading.match(/^(\d+(?:\.\d+)*)$/);
  if (inline) {
    clauses.push({ no: normalizeNumber(inline[1]), title: inline[2] });
  } else if (bare) {
    const nextHeading = headings[index + 1];
    if (nextHeading && !/^\d/.test(nextHeading)) clauses.push({ no: bare[1], title: nextHeading });
  } else if (heading.startsWith('附') || heading === '参考文献') {
    clauses.push({ no: heading, title: heading });
  }
}
const payload = {
  source: 'MinerU v4 parsing result',
  parsedAt: new Date().toISOString(),
  standard: {
    number: standardNo,
    title,
    pageCount: 15,
    blocks: items.length,
    clauses,
    references: ['GB/T 4706.1-2024', 'GB/T 21667-2024']
  }
};

await writeFile(outputPath, `window.STDFORGE_STANDARD = ${JSON.stringify(payload, null, 2)};\n`);
console.log(`Generated ${resolve(outputPath)} with ${clauses.length} parsed section headings.`);
