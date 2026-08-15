import { createServer } from 'node:http'
import { interpretPolicy } from '../server/policy-interpreter.mjs'

const requests = []
const mockServer = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    requests.push({ authorization: request.headers.authorization, body: JSON.parse(body) })
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      choices: [{ message: { content: '# 政策分析报告\n\n面向标准化管理组的测试报告。' } }],
    }))
  })
})

await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
const { port } = mockServer.address()
const policy = {
  id: 'policy-test',
  title: '工业和信息化部办公厅关于开展冰箱能效提升工作的通知',
  publisher: '工业和信息化部办公厅',
  publishedAt: '2026-08-15',
  documentNumber: '工信厅节函〔2026〕1号',
  documentType: '通知',
  theme: '节能与综合利用',
  source: '工业和信息化部政策文件库',
  url: 'https://www.miit.gov.cn/example.html',
  content: '为推动冰箱行业节能降碳，企业应按照国家标准开展产品能效测试。各地工业和信息化主管部门负责监督检查。',
}
const config = {
  baseUrl: `http://127.0.0.1:${port}/v1`,
  model: 'mock-model',
  apiKey: 'mock-secret',
}

const expert = await interpretPolicy({
  policy,
  skillId: 'policy-expert-interpretation',
  audience: '标准化管理组',
}, { config })
const clause = await interpretPolicy({
  policy,
  skillId: 'policy-clause-analysis',
  audience: '法务与合规组',
}, { config })
await new Promise((resolve, reject) => mockServer.close((error) => error ? reject(error) : resolve()))

if (expert.skillId !== 'policy-expert-interpretation') throw new Error('专家解读 Skill 路由失败')
if (clause.skillId !== 'policy-clause-analysis') throw new Error('条款拆解 Skill 路由失败')
if (!expert.report.startsWith('# 政策分析报告')) throw new Error('Markdown 报告解析失败')
if (requests.some((item) => item.authorization !== 'Bearer mock-secret')) throw new Error('模型鉴权头错误')
if (!requests[0].body.messages[1].content.includes('七个部分')) throw new Error('专家解读 Skill 指令未加载')
if (!requests[1].body.messages[1].content.includes('逐条拆解')) throw new Error('条款拆解 Skill 指令未加载')
if (!requests[1].body.messages[1].content.includes('法务与合规组')) throw new Error('分析主体未传入模型')
if (!requests[0].body.messages[1].content.includes(policy.content)) throw new Error('政策正文未传入模型')
if (!requests[0].body.messages[1].content.includes('日期约束')) throw new Error('政策日期约束未传入模型')
if (requests.some((item) => item.body.thinking?.type !== 'disabled')) throw new Error('政策报告未关闭模型思考模式')

console.log(JSON.stringify({
  expertSkill: expert.skillId,
  clauseSkill: clause.skillId,
  requestCount: requests.length,
  reportIsMarkdown: expert.report.startsWith('# '),
  audienceIncluded: requests[1].body.messages[1].content.includes('法务与合规组'),
  policyContentIncluded: requests[0].body.messages[1].content.includes(policy.content),
  dateConstraintIncluded: requests[0].body.messages[1].content.includes('日期约束'),
  thinkingDisabled: requests.every((item) => item.body.thinking?.type === 'disabled'),
}, null, 2))
