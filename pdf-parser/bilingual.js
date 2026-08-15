const sampleText = `# 家用和类似用途制冷器具技术要求

## 1 范围
本文件规定了家用和类似用途制冷器具的术语、性能要求、试验方法和检验规则。

## 2 性能要求
蒸发器应在额定工况下保持稳定换热能力，化霜过程不应影响冷藏室食品安全。

## 3 隔热要求
箱体隔热层应具备足够的隔热性能，并满足能效等级要求。`;

const initialTerms = [
  ['蒸发器', 'evaporator'],
  ['化霜', 'defrost'],
  ['隔热', 'thermal insulation'],
  ['制冷剂', 'refrigerant'],
  ['冷凝器', 'condenser'],
  ['压缩机', 'compressor'],
  ['冷藏室', 'refrigerator compartment'],
  ['冷冻室', 'freezer compartment'],
  ['能效等级', 'energy efficiency class'],
  ['额定功率', 'rated power']
].map(([zh, en], index) => ({ id: `term-${index + 1}`, zh, en }));

const elements = {
  title: document.querySelector('#documentTitle'),
  source: document.querySelector('#sourceText'),
  generate: document.querySelector('#generateButton'),
  termZh: document.querySelector('#termZh'),
  termEn: document.querySelector('#termEn'),
  addTerm: document.querySelector('#addTerm'),
  termTable: document.querySelector('#termTable'),
  termCount: document.querySelector('#termCount'),
  empty: document.querySelector('#emptyOutput'),
  parallelEditor: document.querySelector('#parallelEditor'),
  englishEditor: document.querySelector('#englishEditor'),
  segmentList: document.querySelector('#segmentList'),
  versionInfo: document.querySelector('#versionInfo'),
  outputTitle: document.querySelector('#outputTitle'),
  refreshTranslation: document.querySelector('#refreshTranslation'),
  saveZh: document.querySelector('#saveZh'),
  saveEn: document.querySelector('#saveEn'),
  downloadZh: document.querySelector('#downloadZh'),
  downloadEn: document.querySelector('#downloadEn'),
  downloadParallel: document.querySelector('#downloadParallel'),
  toast: document.querySelector('#toast')
};

let mode = 'parallel';
let view = 'parallel';
let terms = JSON.parse(localStorage.getItem('stdforge.bilingual.terms') || 'null') || initialTerms;
let translation = null;
let zhVersion = 0;
let enVersion = 0;
let englishStale = false;

elements.source.value = sampleText;

function notify(message) {
  elements.toast.querySelector('span').textContent = message;
  elements.toast.classList.add('visible');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => elements.toast.classList.remove('visible'), 2300);
}

function persistTerms() {
  localStorage.setItem('stdforge.bilingual.terms', JSON.stringify(terms));
}

function markEnglishStale() {
  if (!translation) return;
  englishStale = true;
  elements.versionInfo.textContent = `中文 v${zhVersion} · 英文 v${enVersion} · 英文待更新`;
}

function renderTerms() {
  elements.termCount.textContent = `${terms.length} 个术语`;
  elements.termTable.innerHTML = terms.map(term => `
    <div class="term-row" data-id="${term.id}">
      <input data-field="zh" value="${escapeHtml(term.zh)}" aria-label="中文术语" />
      <input data-field="en" value="${escapeHtml(term.en)}" aria-label="英文译法" />
      <button class="button secondary" data-action="save" title="保存术语"><i data-lucide="save"></i></button>
      <button class="button secondary" data-action="delete" title="删除术语"><i data-lucide="trash-2"></i></button>
    </div>
  `).join('');
  elements.termTable.querySelectorAll('.term-row').forEach(row => {
    row.querySelector('[data-action="save"]').addEventListener('click', () => {
      const term = terms.find(item => item.id === row.dataset.id);
      term.zh = row.querySelector('[data-field="zh"]').value.trim();
      term.en = row.querySelector('[data-field="en"]').value.trim();
      terms = terms.filter(item => item.zh && item.en);
      persistTerms();
      renderTerms();
      markEnglishStale();
      notify('术语已保存');
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', () => {
      terms = terms.filter(item => item.id !== row.dataset.id);
      persistTerms();
      renderTerms();
      markEnglishStale();
      notify('术语已删除');
    });
  });
  lucide.createIcons();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

function splitSegments(text) {
  return String(text || '').trim().split(/\n{2,}/).map(item => item.trim()).filter(Boolean);
}

function demoTranslate(text) {
  const glossaryHit = terms.find(term => text.includes(term.zh));
  let result = text
    .replace(/^#\s*/, '# ')
    .replace(/^##\s*/, '## ')
    .replace(/本文件规定了/g, 'This document specifies ')
    .replace(/家用和类似用途制冷器具/g, 'household and similar refrigerating appliances')
    .replace(/术语、性能要求、试验方法和检验规则/g, 'terms, performance requirements, test methods, and inspection rules')
    .replace(/应在额定工况下保持稳定换热能力/g, 'shall maintain stable heat exchange capacity under rated operating conditions')
    .replace(/过程不应影响/g, 'process shall not affect')
    .replace(/食品安全/g, 'food safety')
    .replace(/箱体隔热层/g, 'cabinet thermal insulation layer')
    .replace(/应具备足够的/g, 'shall have sufficient ')
    .replace(/性能，并满足/g, ' performance and meet ')
    .replace(/要求/g, ' requirements')
    .replace(/范围/g, 'Scope')
    .replace(/性能/g, 'Performance')
    .replace(/隔热/g, 'Thermal insulation');
  terms.forEach(term => { result = result.replaceAll(term.zh, term.en); });
  if (glossaryHit && !result.includes(glossaryHit.en)) result += ` (${glossaryHit.en})`;
  return result.replace(/。/g, '.').replace(/，/g, ', ').replace(/；/g, ';').replace(/\s+/g, ' ').replace(/# /g, '# ').trim();
}

function renderTranslation() {
  if (!translation) return;
  elements.outputTitle.textContent = translation.title;
  elements.empty.classList.add('hidden');
  elements.parallelEditor.classList.toggle('hidden', view !== 'parallel');
  elements.englishEditor.classList.toggle('hidden', view !== 'english');
  elements.versionInfo.textContent = `中文 v${zhVersion} · 英文 v${enVersion}${englishStale ? ' · 英文待更新' : ''}`;
  elements.segmentList.innerHTML = translation.segments.map(segment => `
    <article class="parallel-row doc-row" data-id="${segment.id}">
      <section class="doc-page zh-doc" aria-label="中文段落">
        <span class="doc-page-label">中文</span>
        <div class="doc-block" data-lang="zh" contenteditable="true" spellcheck="false">${escapeHtml(segment.zh)}</div>
      </section>
      <i aria-hidden="true"></i>
      <section class="doc-page en-doc" aria-label="英文段落">
        <span class="doc-page-label">English</span>
        <div class="doc-block" data-lang="en" contenteditable="true" spellcheck="false">${escapeHtml(segment.en)}</div>
      </section>
    </article>
  `).join('');
  elements.englishEditor.innerHTML = translation.segments.map(segment => `
    <section class="doc-page english-only-page">
      <div class="doc-block" data-id="${segment.id}" contenteditable="true" spellcheck="false">${escapeHtml(segment.en)}</div>
    </section>
  `).join('');
  bindSegmentInputs();
}

function bindSegmentInputs() {
  elements.segmentList.querySelectorAll('.parallel-row').forEach(row => {
    row.querySelector('[data-lang="zh"]').addEventListener('input', event => {
      translation.segments.find(segment => segment.id === row.dataset.id).zh = event.currentTarget.innerText.trim();
      markEnglishStale();
    });
    row.querySelector('[data-lang="en"]').addEventListener('input', event => {
      translation.segments.find(segment => segment.id === row.dataset.id).en = event.currentTarget.innerText.trim();
    });
  });
  elements.englishEditor.querySelectorAll('[contenteditable]').forEach(block => {
    block.addEventListener('input', event => {
      translation.segments.find(segment => segment.id === block.dataset.id).en = event.currentTarget.innerText.trim();
    });
  });
}

function generateTranslation() {
  const title = elements.title.value.trim();
  const parts = splitSegments(elements.source.value);
  if (!title || !parts.length) return notify('请先填写文档标题和中文正文');
  translation = {
    title,
    mode,
    segments: parts.map((zh, index) => ({ id: `segment-${index + 1}`, zh, en: demoTranslate(zh) }))
  };
  zhVersion = 1;
  enVersion = 1;
  englishStale = false;
  view = mode === 'english' ? 'english' : 'parallel';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('selected', button.dataset.view === view));
  renderTranslation();
  notify('英文版本已生成，术语已按术语库优先替换');
}

function refreshEnglishFromChinese() {
  if (!translation) return notify('请先生成英文版本');
  translation.segments = translation.segments.map(segment => ({
    ...segment,
    en: demoTranslate(segment.zh)
  }));
  enVersion += 1;
  englishStale = false;
  renderTranslation();
  notify('英文已按当前中文和术语库重新更新');
}

function downloadFile(kind) {
  if (!translation) return notify('请先生成英文版本');
  const safeTitle = translation.title.replace(/[\\/:*?"<>|]/g, '-');
  const zh = translation.segments.map(segment => segment.zh).join('\n\n');
  const en = translation.segments.map(segment => segment.en).join('\n\n');
  const parallel = [`# ${translation.title}`, '', '| 中文 | English |', '| --- | --- |', ...translation.segments.map(segment => `| ${segment.zh.replace(/\|/g, '\\|').replace(/\n/g, '<br>')} | ${segment.en.replace(/\|/g, '\\|').replace(/\n/g, '<br>')} |`)].join('\n');
  const content = kind === 'zh' ? zh : kind === 'en' ? en : parallel;
  const suffix = kind === 'zh' ? '中文' : kind === 'en' ? 'English' : '中英对照';
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${safeTitle}-${suffix}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

document.querySelectorAll('[data-mode]').forEach(button => {
  button.addEventListener('click', () => {
    mode = button.dataset.mode;
    document.querySelectorAll('[data-mode]').forEach(item => item.classList.toggle('selected', item === button));
  });
});

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('selected', item === button));
    renderTranslation();
  });
});

elements.addTerm.addEventListener('click', () => {
  const zh = elements.termZh.value.trim();
  const en = elements.termEn.value.trim();
  if (!zh || !en) return notify('请填写中文术语和英文译法');
  terms.push({ id: `term-${Date.now()}`, zh, en });
  elements.termZh.value = '';
  elements.termEn.value = '';
  persistTerms();
  renderTerms();
  markEnglishStale();
  notify('术语已加入术语库');
});
elements.generate.addEventListener('click', generateTranslation);
elements.refreshTranslation.addEventListener('click', refreshEnglishFromChinese);
elements.saveZh.addEventListener('click', () => { if (translation) { zhVersion += 1; renderTranslation(); notify('中文版本已单独保存'); } });
elements.saveEn.addEventListener('click', () => { if (translation) { enVersion += 1; renderTranslation(); notify('英文版本已单独保存'); } });
elements.downloadZh.addEventListener('click', () => downloadFile('zh'));
elements.downloadEn.addEventListener('click', () => downloadFile('en'));
elements.downloadParallel.addEventListener('click', () => downloadFile('parallel'));

renderTerms();
lucide.createIcons();
