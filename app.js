const state = {
  issues: [
    { severity: '高风险', title: '7.4.2 缺少判定依据', description: '条款包含检查要求，但未给出符合与不符合的判断条件，结果不可复现。', suggestion: '补充“检查结果应符合附录 A 表 A.1 的要求；任一安全项目不符合时，判定为不合格”。' },
    { severity: '建议修改', title: '5.2 表述存在模糊词', description: '“至少应满足”后的部分条件未给出可量化要求。', suggestion: '将模糊表述替换为明确的环境温度、湿度或设施要求。' },
    { severity: '建议修改', title: '引用文件版本待核验', description: 'GB/T 21667 的引用版本需要与标准库中的现行版本交叉核验。', suggestion: '保留日期引用并写入版本核验记录。' },
    { severity: '提示', title: '附录 A 表格字段不完整', description: '鉴定表中建议补充鉴定人员、日期和复核结论字段。', suggestion: '在附录 A 增加记录与复核字段。' }
  ]
};

function hydrateParsedStandard() {
  const parsed = window.STDFORGE_STANDARD?.standard;
  if (!parsed) return;
  document.querySelectorAll('[data-standard-number]').forEach(element => { element.textContent = parsed.number; });
  document.querySelectorAll('[data-standard-title]').forEach(element => { element.textContent = parsed.title; });
  document.querySelectorAll('[data-page-count]').forEach(element => { element.textContent = parsed.pageCount; });
  document.querySelectorAll('[data-block-count]').forEach(element => { element.textContent = parsed.blocks; });
}

const toast = document.querySelector('#toast');
function notify(message) {
  toast.querySelector('span').textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove('visible'), 2600);
}

function showView(id) {
  if (id === 'announcements') {
    window.location.assign('module2/index.html');
    return;
  }
  if (id === 'policies') {
    window.location.assign('module3/dist/index.html');
    return;
  }
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === id));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === id));
  document.querySelectorAll('.module-tab').forEach(item => item.classList.toggle('active', item.dataset.view === id));
  if (window.location.hash !== `#${id}`) window.history.replaceState(null, '', `#${id}`);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showPolicyStage(stage) {
  document.querySelectorAll('.policy-stage-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.policyStage === stage));
  document.querySelectorAll('.policy-stage').forEach(panel => panel.classList.toggle('active', panel.dataset.policyStagePanel === stage));
  document.querySelector('#policies').scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character]);
}

let moduleOneSourceText = '';
let moduleOneSourceName = '';
let moduleOneSourceItem = null;
let moduleOneTemplateText = '';
let moduleOneTemplateName = 'GB/T 1.1 常见章节结构（演示）';
let moduleOneTemplates = [];
let moduleOneDemoInputs = [];
let moduleOneTemplateItem = null;
let moduleOneUploadedTemplateUrl = '';
let moduleOnePdfPreviewRequest = 0;
let moduleOneDrafts = {};
let moduleOneActiveOutput = 'standardDraft';
let moduleOneFeishuUrl = '';
let moduleOneGenerationTimer = null;
let moduleOneGenerationStartedAt = 0;
let moduleOneGenerationActive = false;
let moduleOneBilingualReady = false;
let activeEditorSection = 'safety';

const editorOutlineSections = {
  preface: { label: '前言', title: '前言', body: '本文件按照 GB/T 1.1—2020 给出的规则起草。本演示稿由车载冰箱研发技术要求和 QC/T 1196—2023 参考模板自动整理后形成，后续由标准化工程师确认。', subheading: '协同重点', detail: '确认起草单位、标准属性、首次发布说明及专利提示。' },
  scope: { label: '1 范围', title: '1 范围', body: '本文件规定了车载冰箱的术语和定义、技术要求、试验方法、检验规则及标志、包装、运输和贮存。', subheading: '适用边界', detail: '重点确认是否仅覆盖压缩式制冷车载冰箱，以及是否排除医用冷链和吸收式产品。' },
  references: { label: '2 规范性引用文件', title: '2 规范性引用文件', body: '引用 GB/T 2423、GB/T 8059、GB/T 18655、GB/T 28046、GB/T 30512、QC/T 413、QC/T 29106 等文件。', subheading: '协同重点', detail: '法规与标准化人员需核验引用文件版本、日期引用策略和现行有效性。' },
  terms: { label: '3 术语和定义', title: '3 术语和定义', body: '车载冰箱、稳定运行状态、保温时间、储藏温度、特性温度、制冷速度和容积等术语适用于本文件。', subheading: '术语校对', detail: '英文译法优先采用术语库：vehicle refrigerator、stable operating conditions、storage temperature。' },
  process: { label: '4 技术要求', title: '4 技术要求', body: '冰箱应满足一般要求、总容积、密封性、耐久性、机械强度、制冷性能、凝露、材料、噪声、振动、冲击、腐蚀、电磁兼容、电气性能和环境适应性要求。', subheading: '条款拆分', detail: '建议研发负责人按指标来源确认每个限值是否来自原始技术要求或参考标准。' },
  conditions: { label: '5 试验方法', title: '5 试验方法', body: '试验方法包括一般试验条件、总容积测定、密封性试验、门盖抽屉耐久性、制冷性能、材料噪声环境试验、气候负荷和防倒保护试验。', subheading: '验证路径', detail: '质量实验室需确认仪器精度、环境条件、温度传感器布置和试验持续时间。' },
  organization: { label: '6 检验规则', title: '6 检验规则', body: '出厂检验项目包括外形、安装尺寸、标志和性能参数；型式检验应从出厂检验合格的同批产品中随机抽样。', subheading: '抽样确认', detail: '需补充样本数量、复检规则和不合格批判定路径。' },
  requirements: { label: '7 标志包装', title: '7 标志、包装、贮存和保管', body: '每台冰箱应在明显位置设置耐久铭牌和电路图，铭牌应标明产品名称、型号、总容积、额定电压、功率或电流、耗电量、制冷剂、制造商、日期编号和净重。', subheading: '协同重点', detail: '确认铭牌必填项、包装运输要求和 QC/T 413 对齐情况。' },
  safety: { label: '4 技术要求', title: '4.6 制冷性能', body: '在环境温度 32 ℃、相对湿度 45%～75% 条件下，冰箱空载运行，箱内几何中心温度从 32 ℃ 达到 0 ℃ 的时间应不大于 45 min；从 0 ℃ 回升到 20 ℃ 的时间应不小于 90 min。', subheading: '4.6.1 检查方法', detail: '请研发、质量和标准化人员确认 45 min、90 min 阈值是否适用于当前产品系列。', editable: true, alert: true },
  performance: { label: '4 技术要求', title: '4.15 电磁兼容性能', body: '冰箱的传导发射、电压瞬态发射、瞬态传导抗扰性、电磁辐射抗扰性和静电放电应满足相关标准规定的等级要求。', subheading: '协同重点', detail: 'EMC 测试人员需确认 GB/T 18655、GB/T 21437.2、GB/T 33014 和 GB/T 19951 的适用等级。' },
  appendix: { label: '附录 A / B', title: '附录 A 冰箱储藏温度试验方法、附录 B 气味性试验方法', body: '附录 A 规定储藏温度档位设定和温度传感器布置；附录 B 规定非金属材料和整机气味性试验方法。', subheading: '记录要求', detail: '协同人员需补充测点示意图、记录表字段和气味等级评价记录。' }
};

const moduleOneVehicleBilingual = {
  zh: `# QC/T 1196—2023 车载冰箱

ICS 43.040.10
CCS T 36

## 前言
本文件按照 GB/T 1.1—2020《标准化工作导则 第 1 部分：标准化文件的结构和起草规则》的规定起草。

本文件由全国汽车标准化技术委员会提出并归口。本文件为首次发布。

## 1 范围
本文件规定了车载冰箱的术语和定义、技术要求、试验方法、检验规则及标志、包装、运输和贮存。

本文件适用于压缩式制冷的车载冰箱，以下简称“冰箱”。

## 2 规范性引用文件
下列文件中的内容通过文中的规范性引用而构成本文件必不可少的条款。

GB/T 2423.10 环境试验 第 2 部分：试验方法 试验 Fc：振动（正弦）

GB/T 8059 家用和类似用途制冷器具

GB/T 18655—2018 车辆、船和内燃机无线电骚扰特性

GB/T 28046.1～28046.5 道路车辆 电气及电子设备的环境条件和试验

QC/T 413 汽车电气设备基本技术条件

QC/T 29106 汽车电线束技术条件

## 3 术语和定义
车载冰箱是由一个或多个间室组成且间室能够控制温度，具有适合车用的容积和结构，以自然对流或强制对流方式获取冷量的隔热箱体。

稳定运行状态是指冰箱设定到相应温度档位后，制冷系统连续运行，各测点平均温度与开始阶段对应点平均温度偏差不超过 0.5 K 的状态。

保温时间是指冰箱制冷系统空载运行中断后，箱内几何中心温度从 0 ℃ 回升到 20 ℃ 所需要的时间。

## 4 技术要求
冰箱应符合本文件要求，并按照经规定程序批准的产品图样和技术文件进行制造。标志、标签应清晰、完整、永久。

冰箱在车内使用环境下，下限工作温度为 -10 ℃，上限工作温度为 50 ℃；下限贮存温度为 -40 ℃，上限贮存温度为 80 ℃。

标称电压为 12 V 时，最低工作电压为 10.5 V，最高工作电压为 16.0 V；标称电压为 24 V 时，最低工作电压为 22 V，最高工作电压为 32 V。

冰箱总容积的实测值应不小于标称值的 97%。当冰箱门关闭后，应无外部空气进入箱内。

经过 10 000 次开合或抽拉测试后，冰箱的外门、盖或抽屉应无变形、脱落、裂纹和阻滞现象。

在环境温度 32 ℃、相对湿度 45%～75% 条件下，冰箱空载运行，箱内几何中心温度从 32 ℃ 达到 0 ℃ 的时间应不大于 45 min。

冰箱空载运行到 0 ℃ 后断电，箱内几何中心温度从 0 ℃ 回升到 20 ℃ 的时间应不小于 90 min。

冰箱使用的材料应符合汽车禁用物质、阻燃、散发物、食品接触和气味性要求。冰箱噪声值应不大于 45 dB(A)。

冰箱应满足振动、机械冲击、盐雾、涂层附着力、耐化学、电磁兼容、电气性能、低温、高温、温度循环、耐久性和防倒保护要求。

## 5 试验方法
如未标明特殊要求，所有试验均在环境温度 23 ℃±5 ℃、相对湿度 45%～75%、大气压力 86 kPa～106 kPa 条件下进行。

标称电压为 12 V 的冰箱试验电压为 14 V±0.2 V；标称电压为 24 V 的冰箱试验电压为 28 V±0.2 V。

储藏温度试验按照附录 A 进行。制冷速度试验应记录箱内温度达到 0 ℃ 所需时间。保温时间试验应记录箱内平均温度从 0 ℃ 回升到 20 ℃ 所需时间。

材料试验、噪声试验、振动试验、机械冲击试验、盐雾试验、涂层附着力试验、耐化学性能试验、电磁兼容性能试验和电性能试验应按相应引用标准进行。

## 6 检验规则
冰箱须经制造厂质量检验部门检验合格后方能出厂，并附有质量检验合格证、使用说明书、保修单和装箱清单等。

出厂检验项目包括冰箱的外形、安装尺寸、标志和性能参数。型式检验样品应从出厂检验合格的同批产品中随机抽样。

## 7 标志、包装、贮存和保管
每台冰箱应在适当和明显位置处设置耐久性的铭牌和电路图，铭牌应清晰标出产品名称、型号、总容积、额定电压、额定功率或电流、耗电量、制冷剂、制造商、制造日期和编号、净重等内容。

冰箱的包装、贮存和保管应符合 QC/T 413 的规定。

## 附录 A 冰箱储藏温度试验方法
在环境温度 32 ℃、相对湿度 45%～75% 条件下进行储藏温度试验。温度传感器布置在储藏室代表性位置，分别记录上部、中部和下部测点温度。

## 附录 B 气味性试验方法
冰箱使用的非金属材料和整机气味性试验应在规定时间内完成。样品在运输过程中应包装完好，所用包装材料不得破损且不得产生二次污染。`,
  en: `# QC/T 1196—2023 Vehicle Refrigerator

ICS 43.040.10
CCS T 36

## Foreword
This document has been drafted in accordance with GB/T 1.1—2020 Directives for standardization — Part 1: Rules for the structure and drafting of standardizing documents.

This document was proposed by and is under the jurisdiction of the National Technical Committee of Auto Standardization. This document is issued for the first time.

## 1 Scope
This document specifies the terms and definitions, technical requirements, test methods, inspection rules, marking, packaging, transportation and storage of vehicle refrigerators.

This document applies to compression-type vehicle refrigerators, hereinafter referred to as “refrigerators”.

## 2 Normative references
The contents of the following documents constitute indispensable provisions of this document through normative references in the text.

GB/T 2423.10 Environmental testing — Part 2: Test methods — Test Fc: Vibration (sinusoidal)

GB/T 8059 Household and similar refrigerating appliances

GB/T 18655—2018 Vehicles, boats and internal combustion engines — Radio disturbance characteristics

GB/T 28046.1 to 28046.5 Road vehicles — Environmental conditions and testing for electrical and electronic equipment

QC/T 413 Basic technical requirements for automotive electrical equipment

QC/T 29106 Technical specifications for automotive wiring harnesses

## 3 Terms and definitions
A vehicle refrigerator is an insulated cabinet consisting of one or more compartments whose temperature can be controlled, having capacity and structure suitable for vehicle use, and obtaining cooling capacity by natural convection or forced convection.

Stable operating conditions refer to the state in which the refrigerator is set to the corresponding temperature position and the refrigeration system operates continuously, and the deviation between each measuring point and its corresponding initial-stage average temperature does not exceed 0.5 K.

Temperature recovery time refers to the time required for the geometric-center temperature inside the cabinet to rise from 0 ℃ to 20 ℃ after the unloaded refrigeration system stops operating.

## 4 Technical requirements
The refrigerator shall comply with this document and shall be manufactured according to product drawings and technical documents approved through the prescribed procedures. Its marks and labels shall be clear, complete and permanent.

For in-vehicle use, the lower operating temperature is -10 ℃, the upper operating temperature is 50 ℃, the lower storage temperature is -40 ℃, and the upper storage temperature is 80 ℃.

For a nominal voltage of 12 V, the minimum operating voltage is 10.5 V and the maximum operating voltage is 16.0 V. For a nominal voltage of 24 V, the minimum operating voltage is 22 V and the maximum operating voltage is 32 V.

The measured total volume of the refrigerator shall be not less than 97% of the rated value. When the refrigerator door is closed, no external air shall enter the cabinet.

After 10 000 opening-closing or pulling tests, the external door, lid or drawer shall show no deformation, detachment, cracking or jamming.

At an ambient temperature of 32 ℃ and relative humidity of 45% to 75%, the unloaded refrigerator shall reduce the geometric-center temperature from 32 ℃ to 0 ℃ within not more than 45 min.

After the unloaded refrigerator operates to 0 ℃ and is powered off, the time for the geometric-center temperature to rise from 0 ℃ to 20 ℃ shall be not less than 90 min.

The materials used in the refrigerator shall meet the requirements for prohibited substances, flame retardancy, emissions, food contact and odour. The noise value shall not exceed 45 dB(A).

The refrigerator shall meet requirements for vibration, mechanical shock, salt mist, coating adhesion, chemical resistance, electromagnetic compatibility, electrical performance, low temperature, high temperature, temperature cycling, durability and anti-tip protection.

## 5 Test methods
Unless otherwise specified, all tests shall be conducted at an ambient temperature of 23 ℃ ± 5 ℃, relative humidity of 45% to 75%, and atmospheric pressure of 86 kPa to 106 kPa.

The test voltage shall be 14 V ± 0.2 V for a refrigerator with a nominal voltage of 12 V, and 28 V ± 0.2 V for a refrigerator with a nominal voltage of 24 V.

The storage temperature test shall be conducted in accordance with Annex A. The refrigeration speed test shall record the time required for the internal temperature to reach 0 ℃. The temperature recovery time test shall record the time required for the internal average temperature to rise from 0 ℃ to 20 ℃.

Material tests, noise tests, vibration tests, mechanical shock tests, salt-mist tests, coating adhesion tests, chemical resistance tests, electromagnetic compatibility tests and electrical performance tests shall be conducted according to the corresponding referenced standards.

## 6 Inspection rules
The refrigerator may leave the factory only after passing inspection by the manufacturer’s quality inspection department, and shall be accompanied by a quality certificate, operating instructions, warranty card and packing list.

Factory inspection items include appearance, installation dimensions, marking and performance parameters. Samples for type inspection shall be randomly taken from the same batch of products that have passed factory inspection.

## 7 Marking, packaging, storage and safekeeping
Each refrigerator shall have a durable nameplate and circuit diagram in an appropriate and obvious position. The nameplate shall clearly indicate product name, model, total volume, rated voltage, rated power or current, energy consumption, refrigerant, manufacturer, manufacturing date and number, net weight and other information.

Packaging, storage and safekeeping of the refrigerator shall comply with QC/T 413.

## Annex A Test method for refrigerator storage temperature
The storage temperature test shall be conducted at an ambient temperature of 32 ℃ and relative humidity of 45% to 75%. Temperature sensors shall be arranged at representative positions in the storage compartment, and temperatures at upper, middle and lower measuring points shall be recorded.

## Annex B Odour test method
The odour test for non-metallic materials and the complete refrigerator shall be completed within the specified time. Samples shall be well packaged during transportation, and packaging materials shall not be damaged or cause secondary contamination.`
};

const moduleOneChapterReviews = [
  ['前言', '待确认起草单位、归口单位、首次发布说明和专利提示。', '标准化工程师'],
  ['1 范围', '确认适用压缩式车载冰箱，排除吸收式、医用冷链和仅保温储物箱。', '产品经理 / 法规'],
  ['2 规范性引用文件', '核验 GB/T 8059、GB/T 28046、QC/T 413 等引用文件版本。', '法规专员'],
  ['3 术语和定义', '锁定 vehicle refrigerator、storage temperature 等英文术语。', '标准化工程师'],
  ['4 技术要求', '确认工作温度、电压范围、容积偏差、制冷速度和保温时间阈值。', '研发 / 质量'],
  ['5 试验方法', '确认环境条件、传感器布置、仪器精度和试验持续时间。', '实验室'],
  ['6 检验规则', '补充出厂检验、型式检验、复检和不合格批判定规则。', '质量'],
  ['7 标志包装', '确认铭牌字段、制冷剂标识、包装贮存和 QC/T 413 对齐情况。', '制造 / 品质'],
  ['附录 A/B', '补充储藏温度试验记录表和气味性评价记录。', '实验室 / 标准化']
];

function moduleOneMarkdownHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const next = lines[index + 1] || '';
    if (/^\|/.test(line) && /^\|?\s*:?-{3,}/.test(next)) {
      const header = line.split('|').slice(1, -1).map(value => '<th>' + escapeHtml(value.trim()) + '</th>').join('');
      output.push('<table><thead><tr>' + header + '</tr></thead><tbody>');
      index += 2;
      while (index < lines.length && /^\|/.test(lines[index])) {
        const cells = lines[index].split('|').slice(1, -1).map(value => '<td>' + escapeHtml(value.trim()) + '</td>').join('');
        output.push('<tr>' + cells + '</tr>');
        index += 1;
      }
      output.push('</tbody></table>');
      index -= 1;
    } else if (/^### /.test(line)) output.push('<h3>' + escapeHtml(line.slice(4)) + '</h3>');
    else if (/^## /.test(line)) output.push('<h2>' + escapeHtml(line.slice(3)) + '</h2>');
    else if (/^# /.test(line)) output.push('<h1>' + escapeHtml(line.slice(2)) + '</h1>');
    else if (line.trim()) output.push('<p>' + escapeHtml(line) + '</p>');
  }
  return output.join('');
}

function setModuleOneMode(mode) {
  const ai = mode === 'ai';
  const bilingual = mode === 'bilingual';
  document.querySelector('#moduleOneDraft').classList.toggle('hidden', !ai);
  document.querySelector('#moduleOneBilingualWorkbench').classList.toggle('hidden', !bilingual);
  document.querySelector('#clauseEditorWorkbench').classList.toggle('hidden', mode !== 'editor');
  document.querySelector('#standardEditorActions').classList.toggle('hidden', ai);
  document.querySelectorAll('[data-drafting-mode]').forEach(button => button.classList.toggle('active', button.dataset.draftingMode === mode));
  if (mode === 'bilingual') renderModuleOneBilingual();
  if (mode === 'editor') renderChapterReviewList();
}

function shouldAutoGenerateBilingual() {
  return moduleOneSourceItem?.id === 'vehicle-refrigerator' && moduleOneTemplateItem?.id === 'vehicle-refrigerator';
}

function renderModuleOneBilingual() {
  const spread = document.querySelector('#moduleOneBilingualSpread');
  if (!moduleOneBilingualReady) {
    spread.innerHTML = '<div class="module-one-bilingual-empty"><i data-lucide="languages"></i><strong>等待生成车载冰箱中英对照稿</strong><span>请在第一步选择“车载冰箱温控与性能技术要求”和“车载冰箱产品参考模板”，点击生成草案。</span></div>';
  } else {
    spread.innerHTML = '<div class="module-one-bilingual-heading"><span>中文标准草案</span><i></i><span>English Draft</span></div><div class="module-one-bilingual-pages"><article><b>中文</b><div>' + escapeHtml(moduleOneVehicleBilingual.zh) + '</div></article><i></i><article><b>ENGLISH</b><div>' + escapeHtml(moduleOneVehicleBilingual.en) + '</div></article></div>';
  }
  lucide.createIcons();
  bindModuleOneBilingualScroll();
}

function bindModuleOneBilingualScroll() {
  const blocks = document.querySelectorAll('.module-one-bilingual-pages article div');
  if (blocks.length !== 2) return;
  let syncing = false;
  const sync = (source, target) => {
    if (syncing) return;
    const maxSource = source.scrollHeight - source.clientHeight;
    const maxTarget = target.scrollHeight - target.clientHeight;
    if (maxSource <= 0 || maxTarget <= 0) return;
    syncing = true;
    target.scrollTop = (source.scrollTop / maxSource) * maxTarget;
    window.requestAnimationFrame(() => { syncing = false; });
  };
  blocks[0].addEventListener('scroll', () => sync(blocks[0], blocks[1]));
  blocks[1].addEventListener('scroll', () => sync(blocks[1], blocks[0]));
}

function renderChapterReviewList() {
  const list = document.querySelector('#chapterReviewList');
  if (!list) return;
  list.innerHTML = '<h3>章节协同清单</h3>' + moduleOneChapterReviews.map(([chapter, focus, owner], index) => '<article><span>' + String(index + 1).padStart(2, '0') + '</span><div><strong>' + escapeHtml(chapter) + '</strong><p>' + escapeHtml(focus) + '</p></div><em>' + escapeHtml(owner) + '</em></article>').join('');
}

function updateModuleOneDraftState() {
  const ready = Boolean(moduleOneSourceText);
  document.querySelector('#moduleOneGenerate').disabled = !ready;
  document.querySelector('#moduleOneDraftState').textContent = ready
    ? '已选择：' + moduleOneSourceName + ' · 模板：' + moduleOneTemplateName
    : '选择输入后会自动匹配行业模板，也可手动切换。';
  updateModuleOneComparison();
}

function previewMarkdownExcerpt(markdown, maxLength = 720) {
  const plain = String(markdown || '').replace(/^>.*$/gm, '').trim();
  return moduleOneMarkdownHtml(plain.slice(0, maxLength) + (plain.length > maxLength ? '\n\n…' : ''));
}

function updateModuleOneComparison() {
  const input = document.querySelector('#moduleOneInputComparison');
  const template = document.querySelector('#moduleOneTemplateComparison');
  const output = document.querySelector('#moduleOneOutputComparison');
  if (moduleOneSourceItem) {
    input.innerHTML = '<span class="comparison-type">DOCX 输入</span><strong>' + escapeHtml(moduleOneSourceItem.title) + '</strong><small>' + escapeHtml(moduleOneSourceItem.industry) + ' · ' + escapeHtml(moduleOneSourceItem.fileName) + '</small><article class="comparison-excerpt">' + previewMarkdownExcerpt(moduleOneSourceText) + '</article><button class="text-button" type="button" id="moduleOneOpenInputPreview"><i data-lucide="scan-text"></i>预览完整 DOCX 内容</button>';
    document.querySelector('#moduleOneOpenInputPreview').addEventListener('click', () => openModuleOnePreview(moduleOneSourceItem, moduleOneSourceText));
  }
  if (moduleOneTemplateItem) {
    template.innerHTML = '<span class="comparison-type">PDF 模板</span><strong>' + escapeHtml(moduleOneTemplateItem.title) + '</strong><small>' + escapeHtml(moduleOneTemplateItem.code || '上传模板') + ' · ' + escapeHtml(moduleOneTemplateItem.extraction || '已解析') + '</small><article class="comparison-excerpt">' + previewMarkdownExcerpt(moduleOneTemplateText) + '</article><button class="text-button" type="button" id="moduleOneOpenTemplatePreview"><i data-lucide="file-search"></i>预览原始 PDF</button>';
    document.querySelector('#moduleOneOpenTemplatePreview').addEventListener('click', () => openModuleOnePdfPreview(moduleOneTemplateItem));
  }
  if (moduleOneDrafts[moduleOneActiveOutput]) {
    const labels = { standardDraft: '标准草案', compilationNotes: '编制说明', preResearchReport: '预研报告' };
    output.innerHTML = '<span class="comparison-type">生成输出</span><strong>' + labels[moduleOneActiveOutput] + '</strong><small>基于已选输入与模板生成 · 待专家审核</small><article class="comparison-excerpt">' + previewMarkdownExcerpt(moduleOneDrafts[moduleOneActiveOutput]) + '</article><button class="text-button" type="button" id="moduleOneOpenOutput"><i data-lucide="arrow-down"></i>查看完整输出</button>';
    document.querySelector('#moduleOneOpenOutput').addEventListener('click', () => document.querySelector('#moduleOneOutput').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
  lucide.createIcons();
}

async function selectModuleOneDemo(item, markdown, { syncTemplate = true } = {}) {
  moduleOneSourceText = markdown;
  moduleOneSourceName = item.fileName;
  moduleOneSourceItem = item;
  document.querySelectorAll('.module-one-demo-card').forEach(card => {
    const selected = card.dataset.demoId === item.id;
    card.classList.toggle('active', selected);
    card.setAttribute('aria-pressed', String(selected));
    const button = card.querySelector('[data-demo-select]');
    if (button) button.textContent = selected ? '已选中' : '选择';
  });
  if (syncTemplate && item.defaultTemplateId && moduleOneTemplateItem?.id !== 'uploaded') await selectModuleOneReferenceTemplate(item.defaultTemplateId, { silent: true });
  updateModuleOneDraftState();
  notify('已选择研发输入：' + item.title);
}

function openModuleOnePreview(item, markdown) {
  document.querySelector('#moduleOnePreviewTitle').textContent = item.title;
  document.querySelector('#moduleOnePreviewBody').innerHTML = moduleOneMarkdownHtml(markdown);
  const download = document.querySelector('#moduleOnePreviewDownload');
  download.href = item.downloadUrl;
  download.download = item.fileName;
  document.querySelector('#moduleOnePreviewDialog').showModal();
  lucide.createIcons();
}

async function openModuleOnePdfPreview(item) {
  const dialog = document.querySelector('#moduleOnePdfPreviewDialog');
  const frame = document.querySelector('#moduleOnePdfPreviewFrame');
  const status = document.querySelector('#moduleOnePdfPreviewStatus');
  const requestId = ++moduleOnePdfPreviewRequest;
  document.querySelector('#moduleOnePdfPreviewTitle').textContent = item.title;
  const download = document.querySelector('#moduleOnePdfPreviewDownload');
  download.href = item.downloadUrl || item.previewUrl;
  download.download = item.downloadName || item.fileName || 'reference-template.pdf';
  frame.removeAttribute('src');
  frame.hidden = true;
  status.hidden = false;
  status.innerHTML = '<i data-lucide="loader-circle"></i><div><strong>正在加载原始 PDF</strong><span>正在检查文件是否可用…</span></div>';
  dialog.showModal();
  lucide.createIcons();
  try {
    const response = await fetch(item.previewUrl, { method: 'HEAD', cache: 'no-store' });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/pdf')) throw new Error('原始 PDF 当前不可用');
    if (requestId !== moduleOnePdfPreviewRequest || !dialog.open) return;
    frame.src = item.previewUrl + '#view=FitH';
    frame.hidden = false;
    status.hidden = true;
  } catch (error) {
    if (requestId !== moduleOnePdfPreviewRequest || !dialog.open) return;
    status.innerHTML = '<i data-lucide="triangle-alert"></i><div><strong>无法加载原始 PDF</strong><span>' + escapeHtml(error.message) + '。请下载文件后查看，或稍后重试。</span></div>';
    lucide.createIcons();
  }
}

function renderModuleOneTemplateLibrary() {
  const library = document.querySelector('#moduleOneTemplateLibrary');
  library.innerHTML = moduleOneTemplates.map(item => {
    const selected = moduleOneTemplateItem?.id === item.id;
    return '<article class="module-one-template-card' + (selected ? ' active' : '') + '" data-template-id="' + escapeHtml(item.id) + '" tabindex="0" aria-pressed="' + selected + '"><small>' + escapeHtml(item.industry) + ' · ' + escapeHtml(item.pages) + ' 页</small><span class="template-selection-state' + (selected ? ' selected' : '') + '">' + (selected ? '当前生成模板' : '可作为生成模板') + '</span><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.summary) + '</p><div class="module-one-template-meta"><span>' + escapeHtml(item.code) + '</span><span>' + escapeHtml(item.extraction) + '</span></div><div class="module-one-demo-actions"><button class="button secondary" type="button" data-template-preview>预览 PDF</button><button class="button primary" type="button" data-template-select>' + (selected ? '已用作模板' : '用作模板') + '</button></div></article>';
  }).join('');
  library.querySelectorAll('.module-one-template-card').forEach(card => {
    const item = moduleOneTemplates.find(candidate => candidate.id === card.dataset.templateId);
    card.querySelector('[data-template-preview]').addEventListener('click', () => void openModuleOnePdfPreview(item));
    card.querySelector('[data-template-select]').addEventListener('click', () => void selectModuleOneReferenceTemplate(item.id));
    card.addEventListener('click', event => { if (!event.target.closest('button')) void selectModuleOneReferenceTemplate(item.id); });
    card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void selectModuleOneReferenceTemplate(item.id); } });
  });
  lucide.createIcons();
}

async function selectModuleOneReferenceTemplate(id, { silent = false, selectMatchedInput = !silent } = {}) {
  const item = moduleOneTemplates.find(candidate => candidate.id === id);
  if (!item) return;
  try {
    const response = await fetch(item.textUrl);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '模板文本读取失败');
    moduleOneTemplateText = result.text;
    moduleOneTemplateName = item.code + '《' + item.title + '》';
    moduleOneTemplateItem = item;
    renderModuleOneTemplateLibrary();
    updateModuleOneDraftState();
    const matchedDemo = selectMatchedInput && !moduleOneSourceText
      ? moduleOneDemoInputs.find(candidate => candidate.id === id || candidate.defaultTemplateId === id)
      : null;
    if (matchedDemo) {
      const sourceResponse = await fetch(matchedDemo.previewUrl);
      const sourceResult = await sourceResponse.json();
      if (!sourceResponse.ok) throw new Error(sourceResult.error || '研发输入读取失败');
      await selectModuleOneDemo(matchedDemo, sourceResult.markdown, { syncTemplate: false });
      if (!silent) notify('已关联研发输入：' + matchedDemo.title);
      return;
    }
    if (!silent) notify('已选参考模板：' + item.code);
  } catch (error) {
    notify(error.message);
  }
}

async function loadModuleOneTemplates() {
  const library = document.querySelector('#moduleOneTemplateLibrary');
  try {
    const response = await fetch('/api/reference-templates');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '参考模板加载失败');
    moduleOneTemplates = payload.templates || [];
    renderModuleOneTemplateLibrary();
  } catch (error) {
    library.innerHTML = '<p class="draft-loading">参考模板加载失败：' + escapeHtml(error.message) + '</p>';
  }
}

async function loadModuleOneDemos() {
  const grid = document.querySelector('#moduleOneDemoGrid');
  try {
    const response = await fetch('/api/demo-inputs');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || '演示输入加载失败');
    moduleOneDemoInputs = payload.inputs || [];
    moduleOneTemplateText = payload.template?.text || '';
    moduleOneTemplateName = payload.template?.name || moduleOneTemplateName;
    grid.innerHTML = moduleOneDemoInputs.map(item => '<article class="module-one-demo-card" data-demo-id="' + escapeHtml(item.id) + '" tabindex="0" aria-pressed="false"><small>' + escapeHtml(item.industry) + '</small><strong>' + escapeHtml(item.title) + '</strong><p>' + escapeHtml(item.summary) + '</p><div class="module-one-demo-actions"><button class="button secondary" type="button" data-demo-preview>预览</button><button class="button primary" type="button" data-demo-select>选择</button></div></article>').join('');
    grid.querySelectorAll('.module-one-demo-card').forEach(card => {
      const item = moduleOneDemoInputs.find(candidate => candidate.id === card.dataset.demoId);
      const readPreview = async () => {
        const response = await fetch(item.previewUrl);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '文档预览读取失败');
        return result.markdown;
      };
      card.querySelector('[data-demo-preview]').addEventListener('click', async () => {
        try { openModuleOnePreview(item, await readPreview()); } catch (error) { notify(error.message); }
      });
      card.querySelector('[data-demo-select]').addEventListener('click', async () => {
        try { await selectModuleOneDemo(item, await readPreview()); } catch (error) { notify(error.message); }
      });
      card.addEventListener('click', async event => {
        if (event.target.closest('button')) return;
        try { await selectModuleOneDemo(item, await readPreview()); } catch (error) { notify(error.message); }
      });
      card.addEventListener('keydown', async event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        try { await selectModuleOneDemo(item, await readPreview()); } catch (error) { notify(error.message); }
      });
    });
    if (moduleOneTemplateItem && !moduleOneSourceText) {
      await selectModuleOneReferenceTemplate(moduleOneTemplateItem.id, { silent: true, selectMatchedInput: true });
    }
    updateModuleOneDraftState();
  } catch (error) {
    grid.innerHTML = '<p class="draft-loading">演示输入加载失败：' + escapeHtml(error.message) + '</p>';
  }
}

async function pollModuleOneTemplate(jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await new Promise(resolve => window.setTimeout(resolve, 1500));
    const response = await fetch('/api/jobs/' + jobId);
    const job = await response.json();
    if (job.state === 'done') return job.markdown || '';
    if (job.state === 'failed') throw new Error(job.error || '参考 PDF 解析失败');
    document.querySelector('#moduleOneTemplateStatus').textContent = job.message || '正在解析参考 PDF…';
  }
  throw new Error('参考 PDF 解析超时');
}

async function parseModuleOneTemplate() {
  const file = document.querySelector('#moduleOneTemplateFile').files?.[0];
  if (!file) return;
  const button = document.querySelector('#moduleOneParseTemplate');
  button.disabled = true;
  document.querySelector('#moduleOneTemplateStatus').textContent = '正在提交 MinerU 解析…';
  try {
    const response = await fetch('/api/parse?module=standards&filename=' + encodeURIComponent(file.name), { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: file });
    const job = await response.json();
    if (!response.ok) throw new Error(job.error || '参考 PDF 解析失败');
    moduleOneTemplateText = await pollModuleOneTemplate(job.id);
    moduleOneTemplateName = file.name;
    moduleOneTemplateItem = { id: 'uploaded', title: file.name, code: '本次上传', extraction: 'MinerU 已解析', previewUrl: moduleOneUploadedTemplateUrl || URL.createObjectURL(file), downloadUrl: moduleOneUploadedTemplateUrl || URL.createObjectURL(file), downloadName: file.name };
    document.querySelector('#moduleOneTemplateStatus').textContent = '模板已提取：' + file.name + '，生成时将按其章节结构组织输出。';
    updateModuleOneComparison();
    updateModuleOneDraftState();
    notify('参考 PDF 已解析为模板');
  } catch (error) {
    document.querySelector('#moduleOneTemplateStatus').textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderModuleOneOutput() {
  document.querySelector('#moduleOneMarkdown').innerHTML = moduleOneMarkdownHtml(moduleOneDrafts[moduleOneActiveOutput] || '');
  document.querySelectorAll('[data-module-one-output]').forEach(button => button.classList.toggle('active', button.dataset.moduleOneOutput === moduleOneActiveOutput));
  document.querySelector('#moduleOneSyncFeishu').disabled = !moduleOneDrafts.standardDraft;
  document.querySelector('#moduleOneSyncFeishuFromEditor').disabled = !moduleOneDrafts.standardDraft;
  updateModuleOneComparison();
}

const moduleOneGenerationSteps = [
  { title: '第 1 章 范围与适用边界', detail: '识别产品对象、型号与使用场景' },
  { title: '第 2 章 规范性引用文件', detail: '保留待核验的引用与依据' },
  { title: '第 3 章 术语和定义', detail: '整理温控、制冷与测温术语' },
  { title: '第 4 章 技术要求', detail: '映射温度、能耗、噪声与保护指标' },
  { title: '第 5 章 试验方法', detail: '对应试验条件、步骤和判定方式' },
  { title: '第 6 章 检验规则', detail: '标记抽样、复测和待确认项' },
  { title: '生成草案', detail: '生成可审阅的标准草案' }
];

function renderModuleOneGenerationProgress(activeStep = 0, percent = 0, state = 'running') {
  document.querySelector('#moduleOneGenerationSteps').innerHTML = moduleOneGenerationSteps.map((step, index) => {
    const complete = state === 'complete' || index < activeStep;
    const active = state === 'running' && index === activeStep;
    const failed = state === 'failed' && index === activeStep;
    const icon = complete ? 'check' : failed ? 'triangle-alert' : active ? 'loader-circle' : 'circle';
    return '<li class="' + (complete ? ' complete' : '') + (active ? ' active' : '') + (failed ? ' failed' : '') + '"><i data-lucide="' + icon + '"></i><span><strong>' + step.title + '</strong><em>' + step.detail + '</em></span><small>' + (complete ? '已完成' : failed ? '未完成' : active ? '处理中' : '等待') + '</small></li>';
  }).join('');
  document.querySelector('#moduleOneGenerationBar').style.width = percent + '%';
  document.querySelector('#moduleOneGenerationPercent').textContent = percent + '%';
  lucide.createIcons();
}

function openModuleOneGenerationProgress() {
  const dialog = document.querySelector('#moduleOneGenerationDialog');
  moduleOneGenerationActive = true;
  moduleOneGenerationStartedAt = Date.now();
  document.querySelector('#moduleOneGenerationTitle').textContent = '正在生成' + (moduleOneTemplateItem?.title || '标准') + '草案';
  document.querySelector('#moduleOneGenerationDescription').textContent = '正在按参考模板组织章节，完成后将自动进入草案审阅。';
  document.querySelector('#moduleOneGenerationStatus').textContent = '正在准备生成任务…';
  document.querySelector('#moduleOneGenerationClose').classList.add('hidden');
  dialog.classList.remove('has-error');
  renderModuleOneGenerationProgress(0, 4);
  if (!dialog.open) dialog.showModal();
  let activeStep = 0;
  let percent = 4;
  window.clearInterval(moduleOneGenerationTimer);
  moduleOneGenerationTimer = window.setInterval(() => {
    activeStep = Math.min(moduleOneGenerationSteps.length - 1, activeStep + 1);
    percent = Math.min(88, percent + 12);
    renderModuleOneGenerationProgress(activeStep, percent);
    document.querySelector('#moduleOneGenerationStatus').textContent = '正在处理：' + moduleOneGenerationSteps[activeStep].title;
  }, 420);
}

async function finishModuleOneGenerationProgress() {
  window.clearInterval(moduleOneGenerationTimer);
  const wait = Math.max(0, 1600 - (Date.now() - moduleOneGenerationStartedAt));
  if (wait) await new Promise(resolve => window.setTimeout(resolve, wait));
  renderModuleOneGenerationProgress(moduleOneGenerationSteps.length, 100, 'complete');
  document.querySelector('#moduleOneGenerationStatus').textContent = '草案已生成，正在进入草案审阅。';
  await new Promise(resolve => window.setTimeout(resolve, 450));
  moduleOneGenerationActive = false;
  document.querySelector('#moduleOneGenerationDialog').close();
}

function failModuleOneGenerationProgress(error) {
  window.clearInterval(moduleOneGenerationTimer);
  moduleOneGenerationActive = false;
  document.querySelector('#moduleOneGenerationStatus').textContent = '生成失败：' + error.message;
  document.querySelector('#moduleOneGenerationTitle').textContent = '草案生成未完成';
  document.querySelector('#moduleOneGenerationDescription').textContent = '请检查输入文件、模板解析结果或生成服务后重试。';
  document.querySelector('#moduleOneGenerationDialog').classList.add('has-error');
  document.querySelector('#moduleOneGenerationClose').classList.remove('hidden');
}

function enterModuleOneReview() {
  setModuleOneMode('editor');
  document.querySelector('#editorSectionLabel').textContent = (moduleOneTemplateItem?.title || '参考模板') + ' · 草案 v0.1';
  document.querySelector('#editorSectionTitle').textContent = '标准草案审阅与条款协同';
  document.querySelector('#clauseEditor').value = moduleOneDrafts.standardDraft || '';
  document.querySelector('#editorSubheading').textContent = 'AI 生成与人工审阅';
  document.querySelector('#editorPlaceholder').textContent = '已进入第二阶段：可直接修订草案，或在飞书文档中继续协同编辑。';
  document.querySelector('#editorAlert').classList.remove('hidden');
  document.querySelector('#editorAlert').querySelector('strong').textContent = '草案已生成，等待规范性审核';
  document.querySelector('#editorAlert').querySelector('p').textContent = '请核验引用文件、指标阈值、试验条件与判定规则后保存修订。';
  lucide.createIcons();
}

async function generateModuleOneDrafts() {
  if (!moduleOneSourceText) return notify('请先选择一份研发技术要求');
  const button = document.querySelector('#moduleOneGenerate');
  button.disabled = true;
  document.querySelector('#moduleOneProgress').classList.remove('hidden');
  openModuleOneGenerationProgress();
  try {
    const response = await fetch('/api/drafts/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceName: moduleOneSourceName, sourceText: moduleOneSourceText, templateName: moduleOneTemplateName, templateText: moduleOneTemplateText })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '草案生成失败');
    moduleOneDrafts = { standardDraft: result.standardDraft, compilationNotes: result.compilationNotes, preResearchReport: result.preResearchReport };
    moduleOneActiveOutput = 'standardDraft';
    moduleOneBilingualReady = shouldAutoGenerateBilingual();
    moduleOneFeishuUrl = '';
    document.querySelector('#moduleOneOpenFeishu').classList.add('hidden');
    document.querySelector('#moduleOneOpenFeishuFromEditor').classList.add('hidden');
    document.querySelector('#moduleOneOutput').classList.remove('hidden');
    renderModuleOneOutput();
    await finishModuleOneGenerationProgress();
    if (moduleOneBilingualReady) {
      setModuleOneMode('bilingual');
      setFlowStage(2);
      document.querySelector('#moduleOneBilingualWorkbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
      notify('已生成草案，并同步生成车载冰箱中英对照稿');
      return;
    }
    enterModuleOneReview();
    setFlowStage(2);
    document.querySelector('#clauseEditorWorkbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
    notify(result.mode === 'llm' ? 'LLM 已生成草案' : '已生成演示草案');
  } catch (error) {
    failModuleOneGenerationProgress(error);
    notify(error.message);
  } finally {
    document.querySelector('#moduleOneProgress').classList.add('hidden');
    updateModuleOneDraftState();
  }
}

function downloadModuleOneDraft() {
  const content = moduleOneDrafts[moduleOneActiveOutput];
  if (!content) return;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = moduleOneActiveOutput + '-' + moduleOneSourceName.replace(/\.[^.]+$/, '') + '.md';
  link.click();
  URL.revokeObjectURL(url);
}

async function syncModuleOneDraftToFeishu(event) {
  const markdown = moduleOneDrafts.standardDraft;
  if (!markdown) return notify('请先生成标准草案');
  const button = event?.currentTarget || document.querySelector('#moduleOneSyncFeishu');
  button.disabled = true;
  const originalContent = button.innerHTML;
  button.innerHTML = '<i data-lucide="loader-circle"></i>正在同步到飞书';
  lucide.createIcons();
  try {
    const response = await fetch('/api/drafts/sync/feishu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceName: moduleOneSourceName, templateName: moduleOneTemplateName, markdown })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '同步飞书失败');
    moduleOneFeishuUrl = result.docUrl;
    const link = document.querySelector('#moduleOneOpenFeishu');
    link.href = moduleOneFeishuUrl;
    link.classList.remove('hidden');
    const editorLink = document.querySelector('#moduleOneOpenFeishuFromEditor');
    editorLink.href = moduleOneFeishuUrl;
    editorLink.classList.remove('hidden');
    setFlowStage(3);
    notify('草案已追加到飞书文档，可打开后在线协同编辑');
  } catch (error) {
    notify(error.message || '同步飞书失败');
  } finally {
    document.querySelector('#moduleOneSyncFeishu').disabled = !moduleOneDrafts.standardDraft;
    document.querySelector('#moduleOneSyncFeishuFromEditor').disabled = !moduleOneDrafts.standardDraft;
    button.innerHTML = originalContent;
    lucide.createIcons();
  }
}

function renderEditorSection(sectionId) {
  const section = editorOutlineSections[sectionId];
  if (!section) return;
  activeEditorSection = sectionId;
  document.querySelectorAll('[data-editor-section]').forEach(button => button.classList.toggle('active', button.dataset.editorSection === sectionId));
  document.querySelector('#editorSectionLabel').textContent = section.label;
  document.querySelector('#editorSectionTitle').textContent = section.title;
  const editor = document.querySelector('#clauseEditor');
  editor.value = section.body;
  editor.readOnly = !section.editable;
  document.querySelector('#editorSubheading').textContent = section.subheading;
  document.querySelector('#editorPlaceholder').textContent = section.detail;
  document.querySelector('#editorAlert').classList.toggle('hidden', !section.alert);
  document.querySelector('#applySuggestion').classList.toggle('hidden', !section.editable);
  document.querySelector('#editorReadonlyNote').classList.toggle('hidden', Boolean(section.editable));
}

function renderIssue(index) {
  const issue = state.issues[index];
  if (!issue) return;
  document.querySelectorAll('.issue-row').forEach(row => row.classList.toggle('selected', Number(row.dataset.issue) === index));
  document.querySelector('#issueDetail').innerHTML = `
    <span class="status ${issue.severity === '高风险' ? 'red' : 'amber'}">${issue.severity}</span>
    <h3>${issue.title}</h3>
    <p>${issue.description}</p>
    <div class="proposal"><span>AI 建议</span><p>${issue.suggestion}</p></div>
    <div class="source-ref"><i data-lucide="link"></i><span>依据：GB/T 1.1—2020，技术要求应可验证</span></div>
    <button class="button primary full" id="resolveIssue"><i data-lucide="check"></i>采纳并关闭问题</button>`;
  lucide.createIcons();
  document.querySelector('#resolveIssue').addEventListener('click', resolveIssue);
}

function resolveIssue() {
  const selected = document.querySelector('.issue-row.selected');
  if (selected) selected.remove();
  const count = Math.max(0, Number(document.querySelector('#issueCount').textContent) - 1);
  document.querySelector('#issueCount').textContent = count;
  document.querySelector('.review-tabs button b').textContent = count;
  document.querySelector('#issueDetail').innerHTML = `<span class="status teal">已关闭</span><h3>问题已纳入修订</h3><p>系统已将建议写入修订草稿，并记录采纳人、时间和依据。可继续处理下一条审核意见。</p><div class="source-ref"><i data-lucide="git-compare-arrows"></i><span>已生成 1 条修订留痕</span></div>`;
  lucide.createIcons();
  notify('已采纳建议并生成修订留痕');
}

function setFlowStage(stage) {
  const steps = document.querySelectorAll('.flow-step');
  const lines = document.querySelectorAll('.flow-line');
  steps.forEach((step, index) => {
    step.classList.toggle('complete', index < stage);
    step.classList.toggle('current', index === stage);
  });
  lines.forEach((line, index) => line.classList.toggle('complete', index < stage));
}

document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('.module-tab').forEach(item => item.addEventListener('click', () => showView(item.dataset.view)));
document.querySelectorAll('#showStandard').forEach(button => button.addEventListener('click', () => showView('standards')));
document.querySelectorAll('#showAnnouncements').forEach(button => button.addEventListener('click', () => showView('announcements')));
document.querySelectorAll('#showPolicies').forEach(button => button.addEventListener('click', () => showView('policies')));
document.querySelectorAll('.issue-row').forEach(row => row.addEventListener('click', () => { showView('standards'); setModuleOneMode('editor'); renderIssue(Number(row.dataset.issue)); }));
document.querySelectorAll('[data-drafting-mode]').forEach(button => button.addEventListener('click', () => setModuleOneMode(button.dataset.draftingMode)));
document.querySelector('#moduleOneTemplateFile').addEventListener('change', event => {
  const file = event.target.files?.[0];
  document.querySelector('#moduleOneParseTemplate').disabled = !file;
  if (file) {
    if (moduleOneUploadedTemplateUrl) URL.revokeObjectURL(moduleOneUploadedTemplateUrl);
    moduleOneUploadedTemplateUrl = URL.createObjectURL(file);
    moduleOneTemplateItem = { id: 'uploaded', title: file.name, code: '本次上传', extraction: '等待解析', previewUrl: moduleOneUploadedTemplateUrl, downloadUrl: moduleOneUploadedTemplateUrl, downloadName: file.name };
    document.querySelector('#moduleOneTemplateStatus').textContent = '已选择模板：' + file.name + '，点击“解析上传模板”。';
    updateModuleOneComparison();
  }
});
document.querySelector('#moduleOneParseTemplate').addEventListener('click', parseModuleOneTemplate);
document.querySelector('#moduleOneGenerate').addEventListener('click', generateModuleOneDrafts);
document.querySelector('#moduleOneGenerationClose').addEventListener('click', () => document.querySelector('#moduleOneGenerationDialog').close());
document.querySelector('#moduleOneGenerationDialog').addEventListener('cancel', event => {
  if (moduleOneGenerationActive) event.preventDefault();
});
document.querySelector('#moduleOneDownload').addEventListener('click', downloadModuleOneDraft);
document.querySelector('#moduleOneSyncFeishu').addEventListener('click', syncModuleOneDraftToFeishu);
document.querySelector('#moduleOneSyncFeishuFromEditor').addEventListener('click', syncModuleOneDraftToFeishu);
document.querySelector('#moduleOneGoCollaboration').addEventListener('click', () => {
  enterModuleOneReview();
  setFlowStage(3);
  document.querySelector('#clauseEditorWorkbench').scrollIntoView({ behavior: 'smooth', block: 'start' });
  notify('已进入第三步：先同步到飞书进行条款协同，再回到平台运行审查');
});
document.querySelectorAll('[data-module-one-output]').forEach(button => button.addEventListener('click', () => {
  moduleOneActiveOutput = button.dataset.moduleOneOutput;
  renderModuleOneOutput();
}));
document.querySelectorAll('[data-editor-section]').forEach(button => button.addEventListener('click', () => renderEditorSection(button.dataset.editorSection)));
function bindModuleOnePreviewDismiss(dialogId, closeIds, onClose) {
  const dialog = document.querySelector(dialogId);
  const content = dialog.querySelector('.modal');
  closeIds.forEach(id => document.querySelector(id).addEventListener('click', () => dialog.close()));
  document.addEventListener('pointerdown', event => {
    if (!dialog.open || !content) return;
    const bounds = content.getBoundingClientRect();
    const outsideContent = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
    if (outsideContent) dialog.close();
  });
  if (onClose) dialog.addEventListener('close', onClose);
}

function bindModuleOnePreviewResize(dialogId) {
  const dialog = document.querySelector(dialogId);
  const sizes = ['compact', 'wide', 'full'];
  dialog.querySelectorAll('[data-preview-resize]').forEach(button => button.addEventListener('click', () => {
    const current = Math.max(0, sizes.indexOf(dialog.dataset.previewSize || 'wide'));
    const action = button.dataset.previewResize;
    const next = action === 'smaller' ? Math.max(0, current - 1)
      : action === 'larger' ? Math.min(sizes.length - 1, current + 1)
        : (dialog.dataset.previewSize === 'full' ? 'wide' : 'full');
    dialog.dataset.previewSize = typeof next === 'number' ? sizes[next] : next;
    dialog.querySelector('[data-preview-resize="smaller"]').disabled = dialog.dataset.previewSize === 'compact';
    dialog.querySelector('[data-preview-resize="larger"]').disabled = dialog.dataset.previewSize === 'full';
    lucide.createIcons();
  }));
}

bindModuleOnePreviewResize('#moduleOnePreviewDialog');
bindModuleOnePreviewResize('#moduleOnePdfPreviewDialog');
bindModuleOnePreviewDismiss('#moduleOnePreviewDialog', ['#moduleOnePreviewClose', '#moduleOnePreviewDismiss']);
bindModuleOnePreviewDismiss('#moduleOnePdfPreviewDialog', ['#moduleOnePdfPreviewClose', '#moduleOnePdfPreviewDismiss'], () => {
  moduleOnePdfPreviewRequest += 1;
  document.querySelector('#moduleOnePdfPreviewFrame').removeAttribute('src');
});
document.querySelector('#runAudit').addEventListener('click', () => { setFlowStage(2); notify('规范性审核完成：发现 4 个待处理问题'); });
document.querySelector('#refreshSignals').addEventListener('click', () => notify('已同步 12 条标准公告与组织信息'));
document.querySelector('#collectSource').addEventListener('click', () => notify('已采集公开元数据并写入来源留痕'));
document.querySelectorAll('.policy-stage-tab').forEach(tab => tab.addEventListener('click', () => showPolicyStage(tab.dataset.policyStage)));
document.querySelector('#startPolicyCollection').addEventListener('click', () => {
  showPolicyStage('discover');
  notify('已开始从工信部等官方来源采集政策（演示数据）');
});
document.querySelector('#goToClassification').addEventListener('click', () => {
  showPolicyStage('classify');
  notify('已确认 3 条候选政策，等待人工确认分类');
});
document.querySelector('#backToDiscover').addEventListener('click', () => showPolicyStage('discover'));
document.querySelector('#confirmClassification').addEventListener('click', () => {
  showPolicyStage('interpret');
  notify('政策分类已确认：国家级 · 产业政策');
});
document.querySelectorAll('.analysis-type').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.analysis-type').forEach(item => item.classList.toggle('active', item === button));
}));
document.querySelector('#generatePolicyReport').addEventListener('click', () => {
  const audience = escapeHtml(document.querySelector('#analysisAudience').value.trim() || '标准化管理组');
  const clauseMode = document.querySelector('.analysis-type.active').dataset.reportType === 'clause';
  const report = document.querySelector('#analysisReport');
  report.innerHTML = clauseMode
    ? `<div class="report-content"><span class="status teal">条款拆解型 · 已生成</span><h3>绿色智能家电消费实施方案</h3><p>政策将绿色智能家电纳入消费升级重点，要求以旧换新与能效提升协同推进。与现有标准工作直接相关的内容已提取为可复核条目。</p><div class="report-points"><div><span>关联要求</span><strong>绿色产品供给</strong></div><div><span>标准影响</span><strong>能效与品质分级</strong></div><div><span>建议动作</span><strong>补充关联矩阵</strong></div></div><div class="report-evidence"><strong>原文依据</strong><br>“推进绿色智能家电以旧换新，鼓励高效节能产品消费。”</div></div>`
    : `<div class="report-content"><span class="status teal">专家解读型 · 已生成</span><h3>面向 ${audience} 的政策解读</h3><p>政策为绿色智能家电的品质升级、能效提升与循环流通提出明确导向。建议将政策要求映射到鉴定、分级和回收记录，形成标准修订评估依据。</p><div class="report-points"><div><span>适用对象</span><strong>家电生产、回收与鉴定企业</strong></div><div><span>主要机会</span><strong>绿色智能产品消费升级</strong></div><div><span>建议动作</span><strong>建立政策-条款映射</strong></div></div><div class="report-evidence"><strong>原文依据 · 3 处</strong><br>“推进绿色智能家电以旧换新，鼓励高效节能产品消费。”</div></div>`;
  lucide.createIcons();
  notify('已生成带原文依据的政策分析报告');
});
document.querySelector('#backToInterpret').addEventListener('click', () => showPolicyStage('interpret'));
document.querySelector('#sendPolicyReport').addEventListener('click', () => notify('报告已推送至 3 位已选接收人，并生成发送记录'));
document.querySelector('#openPolicySchedule').addEventListener('click', () => notify('定时更新计划：每周一 09:00（演示配置）'));
document.querySelector('#addComment').addEventListener('click', async event => {
  const button = event.currentTarget;
  if (button.disabled) return;
  button.disabled = true;
  const originalContent = button.innerHTML;
  button.innerHTML = '<i data-lucide="loader-circle"></i>发送通知中';
  lucide.createIcons();
  try {
    const response = await fetch('/api/notifications/review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '邮件通知发送失败');
    setFlowStage(3);
    notify(`已发起专家评审，邮件通知已投递至 ${result.accepted} 个配置收件人`);
  } catch (error) {
    notify(error.message || '邮件通知发送失败，请检查服务端配置');
  } finally {
    button.disabled = false;
    button.innerHTML = originalContent;
    lucide.createIcons();
  }
});
document.querySelector('#saveClause').addEventListener('click', () => {
  if (!editorOutlineSections[activeEditorSection].editable) return notify('当前章节为固定演示文案，无需保存修订');
  notify('条款 v0.3 已保存，修订留痕已更新');
});
document.querySelector('#applySuggestion').addEventListener('click', () => {
  if (!editorOutlineSections[activeEditorSection].editable) return;
  document.querySelector('#clauseEditor').value += ' 检查结果应符合附录 A 表 A.1 的要求。';
  notify('已应用 AI 建议，请人工确认后保存');
});

const dialog = document.querySelector('#importDialog');
document.querySelector('#standardFile').addEventListener('change', event => {
  const label = document.querySelector('.dropzone strong');
  if (event.target.files[0]) label.textContent = event.target.files[0].name;
});
document.querySelector('#importStandard').addEventListener('click', event => {
  event.preventDefault();
  dialog.close();
  setFlowStage(1);
  notify('文件已入库：正在识别目录、条款、表格和引用文件');
});

hydrateParsedStandard();
setModuleOneMode('ai');
renderEditorSection(activeEditorSection);
loadModuleOneTemplates();
loadModuleOneDemos();
const initialView = window.location.hash.slice(1);
if (['workspace', 'standards', 'announcements', 'policies'].includes(initialView)) showView(initialView);
lucide.createIcons();
