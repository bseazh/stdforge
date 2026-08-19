import { getTenantAccessToken } from '../packages/integrations/feishu/tenant-access-token.mjs';

const API_BASE = 'https://open.feishu.cn/open-apis';

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.code !== 0) throw new Error(body.msg || `Feishu HTTP ${response.status}`);
  return body.data;
}

async function getApprovalDefinition(token, approvalCode) {
  return requestJson(`${API_BASE}/approval/v4/approvals/${encodeURIComponent(approvalCode)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function resolveDocumentToken(token, definition, docUrl) {
  const wikiToken = new URL(docUrl).pathname.match(/\/wiki\/([^/?]+)/)?.[1];
  if (!wikiToken) throw new Error('审批模板的标准草案必须使用飞书知识库文档链接');
  // A document control may be configured with an archive folder in a different
  // Wiki space. Resolve the selected document from its own node instead of
  // assuming that configuration is the document's actual parent space.
  const data = await requestJson(`${API_BASE}/wiki/v2/spaces/get_node?token=${encodeURIComponent(wikiToken)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (data.node?.obj_type !== 'docx' || !data.node?.obj_token) throw new Error('标准草案必须关联飞书 Docx 文档');
  return data.node.obj_token;
}

function findControl(definition, name) {
  const form = typeof definition.form === 'string' ? JSON.parse(definition.form) : definition.form;
  const control = form.find(item => item.name === name);
  if (!control) throw new Error(`审批模板缺少控件：${name}`);
  return control;
}

function selfChosenApproverNodes(definition) {
  return (definition.node_list || []).filter(node => {
    if (!node.need_approver || !Array.isArray(node.approver_chosen_range)) return false;
    return node.approver_chosen_range.some(range => range.approver_range_type === 0 && !(range.approver_range_ids || []).length);
  });
}

export async function createApprovalInstance({ appId, appSecret, approvalCode, initiatorOpenId, docUrl, jobId, fileName, standardNo, standardName, reviewNote, publishDate, publishMode = 'Demo 模拟发布' }) {
  const token = await getTenantAccessToken(appId, appSecret);
  const definition = await getApprovalDefinition(token, approvalCode);
  if (definition.status !== 'ACTIVE') throw new Error('审批模板未启用');
  const documentToken = await resolveDocumentToken(token, definition, docUrl);
  const radio = findControl(definition, '发布方式');
  const publishOption = radio.option?.find(option => option.text === publishMode) || radio.option?.[0];
  if (!publishOption) throw new Error('审批模板未配置发布方式选项');
  const planDate = new Date(publishDate || Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const form = [
    { id: findControl(definition, '标准编号').id, type: 'input', value: standardNo || fileName.replace(/\.pdf$/i, '') },
    { id: findControl(definition, '标准名称').id, type: 'input', value: standardName || fileName.replace(/\.pdf$/i, '') },
    { id: findControl(definition, '标准草案（飞书文档）').id, type: 'document', value: { token: documentToken, type: 'docx' } },
    { id: findControl(definition, '预审说明 / 审查重点').id, type: 'textarea', value: reviewNote || '请重点审查适用范围、技术指标、引用文件、表格内容及格式规范，并提出修改意见。' },
    { id: findControl(definition, 'StdForge 解析任务 ID').id, type: 'input', value: jobId },
    { id: findControl(definition, '计划发布日期').id, type: 'date', value: planDate },
    { id: radio.id, type: 'radioV2', value: publishOption.value }
  ];
  // Demo templates use a self-chosen approver node. Without this list Feishu
  // treats the node as empty and immediately auto-passes the instance.
  const nodeApproverOpenIdList = selfChosenApproverNodes(definition).map(node => ({
    key: node.node_id,
    value: [initiatorOpenId]
  }));
  const data = await requestJson(`${API_BASE}/approval/v4/instances`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      approval_code: approvalCode,
      open_id: initiatorOpenId,
      form: JSON.stringify(form),
      ...(nodeApproverOpenIdList.length ? { node_approver_open_id_list: nodeApproverOpenIdList } : {}),
      uuid: `stdforge-${jobId}`,
      allow_resubmit: true
    })
  });
  if (!data.instance_code) throw new Error('飞书未返回审批实例编号');
  return {
    instanceCode: data.instance_code,
    approvalUrl: null,
    approvalEntry: '请在飞书客户端的“工作台 → 审批”中查看待办或已发起事项。'
  };
}

export async function getApprovalInstance({ appId, appSecret, instanceCode }) {
  const token = await getTenantAccessToken(appId, appSecret);
  return requestJson(`${API_BASE}/approval/v4/instances/${encodeURIComponent(instanceCode)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}
