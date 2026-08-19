import { getTenantAccessToken } from '../packages/integrations/feishu/tenant-access-token.mjs';

const MCP_URL = 'https://mcp.feishu.cn/mcp';

function contentText(response) {
  return response.result?.content?.map(item => item.text || '').join('\n') || '';
}

function parseToolResponse(response) {
  if (response.error) throw new Error(response.error.message || 'Feishu MCP request failed');
  if (response.result?.isError) throw new Error(contentText(response) || 'Feishu MCP tool execution failed');
  const text = contentText(response);
  try { return JSON.parse(text); } catch { return { message: text }; }
}

async function callTool({ token, toolName, arguments: toolArguments, id }) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Lark-MCP-TAT': token,
      'X-Lark-MCP-Allowed-Tools': toolName
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: toolName, arguments: toolArguments } })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || `Feishu MCP HTTP ${response.status}`);
  return parseToolResponse(body);
}

export async function appendToFeishuDocument({ appId, appSecret, docUrl, markdown }) {
  const token = await getTenantAccessToken(appId, appSecret);
  const fetched = await callTool({ token, toolName: 'fetch-doc', arguments: { doc_id: docUrl }, id: 101 });
  const updated = await callTool({ token, toolName: 'update-doc', arguments: { doc_id: docUrl, mode: 'append', markdown }, id: 102 });
  const fetchData = fetched.data || fetched;
  const updateData = updated.data || updated;
  return {
    docId: updateData.doc_id || fetchData.doc_id || null,
    title: fetchData.title || null,
    message: updateData.message || '文档已更新'
  };
}
