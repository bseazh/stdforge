import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const KB_MODULES = new Set(['standard-drafting', 'standards', 'policies']);
const MAX_CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 120;

function cleanFileName(value) {
  return basename(value || 'untitled').replace(/[^\p{L}\p{N}_. -]/gu, '_');
}

function normaliseText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function shortExcerpt(value, limit = 220) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function cjkBigrams(value) {
  const compact = value.replace(/[^\u3400-\u9fff]/g, '');
  return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2));
}

function tokens(value) {
  const latin = value.toLocaleLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_.\-/]{1,}/gu) || [];
  return [...new Set([...latin, ...cjkBigrams(value)])];
}

function chunkText(text) {
  const sections = normaliseText(text).split(/\n{2,}/).filter(Boolean);
  const chunks = [];
  let current = '';
  let heading = '';

  const push = () => {
    const content = current.trim();
    if (!content) return;
    chunks.push({ ordinal: chunks.length + 1, heading, text: content });
    current = content.slice(-CHUNK_OVERLAP);
  };

  for (const section of sections) {
    const isHeading = /^#{1,6}\s+/.test(section) || /^(第[一二三四五六七八九十\d]+[章节]|\d+(?:\.\d+){0,4}\s+)/.test(section);
    if (isHeading) heading = section.replace(/^#{1,6}\s+/, '').slice(0, 120);
    if (current && current.length + section.length + 2 > MAX_CHUNK_SIZE) push();
    current += `${current ? '\n\n' : ''}${section}`;
    while (current.length > MAX_CHUNK_SIZE * 1.35) push();
  }
  push();
  return chunks.map(chunk => ({ ...chunk, terms: tokens(chunk.text) }));
}

function rankChunk(chunk, query, queryTerms) {
  const text = chunk.text.toLocaleLowerCase();
  let score = 0;
  if (query && text.includes(query.toLocaleLowerCase())) score += 18;
  for (const term of queryTerms) {
    let offset = 0;
    let occurrences = 0;
    while (occurrences < 6) {
      const found = text.indexOf(term, offset);
      if (found < 0) break;
      occurrences += 1;
      offset = found + term.length;
    }
    score += Math.min(occurrences, 3) * (term.length >= 4 ? 3 : 1);
  }
  if (chunk.heading && queryTerms.some(term => chunk.heading.toLocaleLowerCase().includes(term))) score += 4;
  return score;
}

function xmlToText(xml) {
  return xml
    .replace(/<w:tab\s*\/?\s*>/g, '\t')
    .replace(/<w:br\s*\/?\s*>/g, '\n')
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export async function extractSupportedText(filePath, fileName = filePath) {
  const extension = extname(fileName).toLowerCase();
  if (['.txt', '.md', '.markdown', '.csv'].includes(extension)) {
    return normaliseText(await readFile(filePath, 'utf8'));
  }
  if (extension === '.docx') {
    const { stdout } = await execFileAsync('/usr/bin/unzip', ['-p', filePath, 'word/document.xml'], { maxBuffer: 24 * 1024 * 1024 });
    return normaliseText(xmlToText(stdout));
  }
  throw new Error('仅支持 TXT、Markdown、CSV、DOCX 或已解析的 PDF 文本入库');
}

export class KnowledgeBase {
  constructor(kbRoot) {
    this.root = resolve(kbRoot);
    this.systemDir = join(this.root, '.system');
    this.catalogPath = join(this.systemDir, 'catalog.json');
    this.catalog = { version: 1, updatedAt: null, documents: [] };
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await Promise.all([
      mkdir(this.systemDir, { recursive: true }),
      ...[...KB_MODULES].flatMap(module => [mkdir(join(this.root, module, 'text'), { recursive: true }), mkdir(join(this.root, module, 'source'), { recursive: true })])
    ]);
    try {
      const parsed = JSON.parse(await readFile(this.catalogPath, 'utf8'));
      if (Array.isArray(parsed.documents)) this.catalog = { version: 1, updatedAt: parsed.updatedAt || null, documents: parsed.documents };
    } catch {
      await this.persist();
    }
  }

  assertModule(module) {
    if (!KB_MODULES.has(module)) throw new Error('知识库分区必须是 standard-drafting、standards 或 policies');
  }

  async persist() {
    this.catalog.updatedAt = new Date().toISOString();
    const temporary = `${this.catalogPath}.${process.pid}.tmp`;
    this.writeQueue = this.writeQueue.then(async () => {
      await writeFile(temporary, `${JSON.stringify(this.catalog, null, 2)}\n`, 'utf8');
      await rename(temporary, this.catalogPath);
    });
    return this.writeQueue;
  }

  async upsertText({ module, fileName, text, source = {} }) {
    this.assertModule(module);
    const normalised = normaliseText(text);
    if (!normalised) throw new Error('未从文档中提取到可入库文本');
    const sourceHash = createHash('sha256').update(normalised).digest('hex');
    const existing = this.catalog.documents.find(document => document.sourceHash === sourceHash && document.module === module);
    if (existing) return { document: existing, reused: true };

    const id = randomUUID();
    const storedName = `${id}.md`;
    const textPath = join(this.root, module, 'text', storedName);
    const relativeTextPath = relative(this.root, textPath);
    await writeFile(textPath, `${normalised}\n`, 'utf8');
    const document = {
      id,
      module,
      fileName: cleanFileName(fileName),
      title: source.title || cleanFileName(fileName).replace(/\.[^.]+$/, ''),
      sourceType: source.type || 'upload',
      sourceUrl: source.url || null,
      sourceHash,
      textPath: relativeTextPath,
      importedAt: new Date().toISOString(),
      charCount: normalised.length,
      chunks: chunkText(normalised)
    };
    this.catalog.documents.unshift(document);
    await this.persist();
    return { document, reused: false };
  }

  async importFile({ module, filePath, fileName, source }) {
    const text = await extractSupportedText(filePath, fileName);
    return this.upsertText({ module, fileName, text, source });
  }

  list({ module, limit = 100 } = {}) {
    if (module) this.assertModule(module);
    return this.catalog.documents
      .filter(document => !module || document.module === module)
      .slice(0, Math.max(1, Math.min(limit, 200)))
      .map(({ chunks, ...document }) => ({ ...document, chunkCount: chunks.length }));
  }

  stats() {
    const modules = Object.fromEntries([...KB_MODULES].map(module => [module, { documents: 0, chunks: 0, characters: 0 }]));
    for (const document of this.catalog.documents) {
      const stat = modules[document.module];
      stat.documents += 1;
      stat.chunks += document.chunks.length;
      stat.characters += document.charCount;
    }
    return { root: this.root, updatedAt: this.catalog.updatedAt, documents: this.catalog.documents.length, modules };
  }

  search(query, { module, limit = 6 } = {}) {
    if (module) this.assertModule(module);
    const cleanedQuery = normaliseText(query);
    if (!cleanedQuery) throw new Error('请输入要检索的问题或关键词');
    const queryTerms = tokens(cleanedQuery);
    const hits = [];
    for (const document of this.catalog.documents) {
      if (module && document.module !== module) continue;
      for (const chunk of document.chunks) {
        const score = rankChunk(chunk, cleanedQuery, queryTerms);
        if (!score) continue;
        hits.push({
          documentId: document.id,
          fileName: document.fileName,
          title: document.title,
          module: document.module,
          sourceUrl: document.sourceUrl,
          chunk: chunk.ordinal,
          heading: chunk.heading || null,
          score,
          excerpt: shortExcerpt(chunk.text),
          text: chunk.text
        });
      }
    }
    return hits.sort((left, right) => right.score - left.score).slice(0, Math.max(1, Math.min(limit, 12)));
  }

  async rebuildIndex() {
    for (const document of this.catalog.documents) {
      const text = await readFile(resolve(this.root, document.textPath), 'utf8');
      document.chunks = chunkText(text);
      document.charCount = normaliseText(text).length;
    }
    await this.persist();
    return this.stats();
  }
}

export const knowledgeModules = [...KB_MODULES];
