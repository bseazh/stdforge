const sampleText = `# 家用和类似用途制冷器具技术要求

ICS 97.040.30
CCS Y 61

## 前言
本文件按照 GB/T 1.1—2020《标准化工作导则 第1部分：标准化文件的结构和起草规则》的规定起草。

本文件用于家用和类似用途制冷器具技术要求的预研、编制说明和标准草案同步输出。

## 1 范围
本文件规定了家用和类似用途制冷器具的术语、性能要求、试验方法和检验规则。

本文件适用于额定电压不超过 250 V 的家用电冰箱、冷藏冷冻箱和类似用途制冷器具。

## 2 规范性引用文件
下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。

GB/T 8059 家用和类似用途制冷器具
IEC 62552 Household refrigerating appliances — Characteristics and test methods

## 3 术语和定义
蒸发器是使制冷剂吸收热量并产生制冷效应的换热部件。

化霜是去除蒸发器表面霜层以恢复换热能力的过程。

## 4 性能要求
蒸发器应在额定工况下保持稳定换热能力，化霜过程不应影响冷藏室食品安全。

制冷系统应在规定环境温度下稳定运行，压缩机、冷凝器和控制器不应出现异常噪声、过热或失效。

## 5 隔热要求
箱体隔热层应具备足够的隔热性能，并满足能效等级要求。

门封结构应保持良好密封性能，正常使用过程中不应产生影响使用的凝露。

## 6 试验方法
试验前，器具应在规定环境条件下放置不少于 12 h。

温度测量点应布置在冷藏室和冷冻室代表性位置，记录稳定运行期间的温度波动。

## 7 标志、包装和说明书
产品铭牌应至少标明额定电压、额定功率、制冷剂种类、气候类型和制造商信息。

说明书应包含安装、使用、维护、化霜和安全警示等内容。`;

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

function segmentsToText(language) {
  if (!translation) return '';
  return translation.segments.map(segment => segment[language]).join('\n\n');
}

function textToSegments(text, language) {
  if (!translation) return;
  const parts = splitSegments(text);
  const nextLength = Math.max(parts.length, translation.segments.length);
  translation.segments = Array.from({ length: nextLength }, (_, index) => ({
    id: translation.segments[index]?.id || `segment-${index + 1}`,
    zh: language === 'zh' ? (parts[index] || '') : (translation.segments[index]?.zh || ''),
    en: language === 'en' ? (parts[index] || '') : (translation.segments[index]?.en || '')
  })).filter(segment => segment.zh || segment.en);
}

function demoTranslate(text) {
  const glossaryHit = terms.find(term => text.includes(term.zh));
  let result = text
    .replace(/^#\s*/, '# ')
    .replace(/^##\s*/, '## ')
    .replace(/前言/g, 'Foreword')
    .replace(/本文件按照 GB\/T 1.1—2020《标准化工作导则 第1部分：标准化文件的结构和起草规则》的规定起草/g, 'This document has been drafted in accordance with GB/T 1.1—2020 Directives for standardization — Part 1: Rules for the structure and drafting of standardizing documents')
    .replace(/本文件用于家用和类似用途制冷器具技术要求的预研、编制说明和标准草案同步输出/g, 'This document is used for synchronized output of preliminary research, drafting notes, and standard drafts for technical requirements of household and similar refrigerating appliances')
    .replace(/本文件规定了/g, 'This document specifies ')
    .replace(/本文件适用于额定电压不超过 250 V 的家用电冰箱、冷藏冷冻箱和类似用途制冷器具/g, 'This document applies to household refrigerators, refrigerator-freezers, and similar refrigerating appliances with a rated voltage not exceeding 250 V')
    .replace(/规范性引用文件/g, 'Normative references')
    .replace(/下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款/g, 'The contents of the following documents constitute indispensable provisions of this document through normative references in the text')
    .replace(/术语和定义/g, 'Terms and definitions')
    .replace(/蒸发器是使制冷剂吸收热量并产生制冷效应的换热部件/g, 'An evaporator is a heat exchange component that enables the refrigerant to absorb heat and produce a cooling effect')
    .replace(/化霜是去除蒸发器表面霜层以恢复换热能力的过程/g, 'Defrost is the process of removing frost from the evaporator surface to restore heat exchange capacity')
    .replace(/家用和类似用途制冷器具/g, 'household and similar refrigerating appliances')
    .replace(/术语、性能要求、试验方法和检验规则/g, 'terms, performance requirements, test methods, and inspection rules')
    .replace(/应在额定工况下保持稳定换热能力/g, 'shall maintain stable heat exchange capacity under rated operating conditions')
    .replace(/过程不应影响/g, 'process shall not affect')
    .replace(/食品安全/g, 'food safety')
    .replace(/制冷系统应在规定环境温度下稳定运行/g, 'The refrigerating system shall operate stably at the specified ambient temperature')
    .replace(/不应出现异常噪声、过热或失效/g, 'shall not show abnormal noise, overheating, or failure')
    .replace(/箱体隔热层/g, 'cabinet thermal insulation layer')
    .replace(/应具备足够的/g, 'shall have sufficient ')
    .replace(/性能，并满足/g, ' performance and meet ')
    .replace(/门封结构应保持良好密封性能/g, 'The door gasket structure shall maintain good sealing performance')
    .replace(/正常使用过程中不应产生影响使用的凝露/g, 'condensation affecting normal use shall not occur during normal operation')
    .replace(/试验方法/g, 'Test methods')
    .replace(/试验前，器具应在规定环境条件下放置不少于 12 h/g, 'Before testing, the appliance shall be placed under the specified ambient conditions for not less than 12 h')
    .replace(/温度测量点应布置在冷藏室和冷冻室代表性位置，记录稳定运行期间的温度波动/g, 'Temperature measuring points shall be arranged at representative positions in the refrigerator compartment and freezer compartment, and temperature fluctuation during stable operation shall be recorded')
    .replace(/标志、包装和说明书/g, 'Marking, packaging, and instructions')
    .replace(/产品铭牌应至少标明额定电压、额定功率、制冷剂种类、气候类型和制造商信息/g, 'The product nameplate shall at least indicate the rated voltage, rated power, refrigerant type, climate class, and manufacturer information')
    .replace(/说明书应包含安装、使用、维护、化霜和安全警示等内容/g, 'The instructions shall include installation, use, maintenance, defrost, and safety warnings')
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
  elements.segmentList.innerHTML = `
    <article class="parallel-row doc-row">
      <section class="doc-page zh-doc" aria-label="中文 Markdown 文档">
        <span class="doc-page-label">中文</span>
        <div class="doc-block full-doc-block" data-lang="zh" contenteditable="true" spellcheck="false">${escapeHtml(segmentsToText('zh'))}</div>
      </section>
      <i aria-hidden="true"></i>
      <section class="doc-page en-doc" aria-label="English Markdown document">
        <span class="doc-page-label">English</span>
        <div class="doc-block full-doc-block" data-lang="en" contenteditable="true" spellcheck="false">${escapeHtml(segmentsToText('en'))}</div>
      </section>
    </article>
  `;
  elements.englishEditor.innerHTML = `
    <section class="doc-page english-only-page">
      <div class="doc-block full-doc-block" data-lang="en" contenteditable="true" spellcheck="false">${escapeHtml(segmentsToText('en'))}</div>
    </section>
  `;
  bindSegmentInputs();
}

function bindSegmentInputs() {
  elements.segmentList.querySelectorAll('[data-lang]').forEach(block => {
    block.addEventListener('input', event => {
      const language = block.dataset.lang;
      textToSegments(event.currentTarget.innerText.trim(), language);
      if (language === 'zh') markEnglishStale();
    });
  });
  elements.englishEditor.querySelectorAll('[data-lang="en"]').forEach(block => {
    block.addEventListener('input', event => {
      textToSegments(event.currentTarget.innerText.trim(), 'en');
    });
  });
}

function generateTranslation(silent = false) {
  const title = elements.title.value.trim();
  const parts = splitSegments(elements.source.value);
  if (!title || !parts.length) return notify('请先填写文档标题和中文正文');
  if (translation) {
    translation.title = title;
    translation.segments = parts.map((zh, index) => ({
      id: translation.segments[index]?.id || `segment-${index + 1}`,
      zh,
      en: demoTranslate(zh)
    }));
    enVersion += 1;
  } else {
    translation = {
      title,
      mode,
      segments: parts.map((zh, index) => ({ id: `segment-${index + 1}`, zh, en: demoTranslate(zh) }))
    };
    zhVersion = 1;
    enVersion = 1;
  }
  englishStale = false;
  view = 'parallel';
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('selected', button.dataset.view === view));
  renderTranslation();
  if (!silent) notify('英文版本已生成，术语已按术语库优先替换');
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
  const zh = segmentsToText('zh');
  const en = segmentsToText('en');
  const escapeMarkdownCell = value => value.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const parallel = [
    `# ${translation.title}`,
    '',
    '| 中文 Markdown | English Markdown |',
    '| --- | --- |',
    `| ${escapeMarkdownCell(zh)} | ${escapeMarkdownCell(en)} |`
  ].join('\n');
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

document.querySelectorAll('[data-workspace-tab]').forEach(button => {
  button.addEventListener('click', () => {
    const tab = button.dataset.workspaceTab;
    document.querySelectorAll('[data-workspace-tab]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('[data-workspace-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.workspacePanel === tab));
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
generateTranslation(true);
lucide.createIcons();
