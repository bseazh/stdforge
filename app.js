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
document.querySelectorAll('.issue-row').forEach(row => row.addEventListener('click', () => { showView('standards'); renderIssue(Number(row.dataset.issue)); }));
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
document.querySelector('#saveClause').addEventListener('click', () => notify('条款 v0.3 已保存，修订留痕已更新'));
document.querySelector('#applySuggestion').addEventListener('click', () => { document.querySelector('#clauseEditor').value += ' 检查结果应符合附录 A 表 A.1 的要求。'; notify('已应用 AI 建议，请人工确认后保存'); });

const dialog = document.querySelector('#importDialog');
document.querySelector('#openImport').addEventListener('click', () => dialog.showModal());
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

document.querySelector('#runFlow').addEventListener('click', () => {
  let stage = 0;
  const messages = ['已采集公开标准元数据', '已解析为 24 个结构单元', '已完成规则审核', '已发起专家评审', '已生成发布归档包'];
  const timer = window.setInterval(() => {
    setFlowStage(stage);
    notify(messages[stage]);
    stage += 1;
    if (stage === messages.length) window.clearInterval(timer);
  }, 750);
});

hydrateParsedStandard();
const initialView = window.location.hash.slice(1);
if (['workspace', 'standards', 'announcements', 'policies'].includes(initialView)) showView(initialView);
lucide.createIcons();
