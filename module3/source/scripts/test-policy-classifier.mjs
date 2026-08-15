import { analyzePolicies, preprocessPolicy } from '../server/policy-classifier.mjs'
import { createServer } from 'node:http'

const samplePolicy = {
  id: 'sample-policy',
  title: '工业和信息化部办公厅关于开展冰箱能效提升工作的通知',
  publisher: '节能与综合利用司',
  source: '工业和信息化部政策文件库',
  sourceDomain: 'miit.gov.cn',
  documentNumber: '工信厅节函〔2026〕1号',
  documentType: '通知',
  theme: '节能与综合利用',
  publishedAt: '2026-08-15',
  url: 'https://www.miit.gov.cn/example.html',
  content: '为推动冰箱行业节能降碳，现开展能效提升工作。一、适用范围。面向冰箱生产企业和相关检测机构。二、工作要求。企业应当按照国家标准开展产品能效测试，不得使用淘汰设备。三、实施程序。各地工业和信息化主管部门负责组织申报和监督检查。',
}

const preprocessing = preprocessPolicy(samplePolicy)
if (preprocessing.title.issuingLocation !== '中央部门') throw new Error('发布位置识别失败')
if (!preprocessing.title.documentName.includes('冰箱能效提升')) throw new Error('文件名称拆解失败')
if (!preprocessing.content.summary.includes('冰箱')) throw new Error('内容摘要生成失败')
if (preprocessing.content.sourceCharacterCount < 50) throw new Error('正文长度统计失败')

const analysis = await analyzePolicies([samplePolicy])
if (analysis.configured !== false) throw new Error('无配置状态判断失败')
if (analysis.results[0]?.status !== 'model_unconfigured') throw new Error('无模型降级状态失败')
if (!analysis.results[0]?.preprocessing?.content?.summary) throw new Error('无模型时未保留结构化 JSON')

let receivedAuthorization = ''
let receivedRequestBody = null
const mockServer = createServer((request, response) => {
  receivedAuthorization = request.headers.authorization || ''
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    receivedRequestBody = JSON.parse(body)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            administrativeLevel: '国家级',
            policyCategory: '产业政策',
            confidence: 0.92,
            reasoning: '发布主体为中央部委，内容明确面向冰箱行业。',
            evidence: ['工业和信息化部办公厅', '面向冰箱生产企业'],
          }),
        },
      }],
    }))
  })
})
await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
const address = mockServer.address()
const configuredAnalysis = await analyzePolicies([samplePolicy], {
  config: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: 'mock-policy-model',
    apiKey: 'test-secret',
  },
})
await new Promise((resolve, reject) => mockServer.close((error) => error ? reject(error) : resolve()))

const modelResult = configuredAnalysis.results[0]
if (configuredAnalysis.configured !== true) throw new Error('模型配置状态判断失败')
if (modelResult?.status !== 'completed') throw new Error('模型调用未完成')
if (modelResult?.classification?.administrativeLevel !== '国家级') throw new Error('政策层级解析失败')
if (modelResult?.classification?.policyCategory !== '产业政策') throw new Error('政策分类解析失败')
if (receivedAuthorization !== 'Bearer test-secret') throw new Error('API Key 请求头错误')
if (receivedRequestBody?.model !== 'mock-policy-model') throw new Error('模型名称传递失败')

console.log(JSON.stringify({
  configured: analysis.configured,
  status: analysis.results[0].status,
  configuredModelStatus: modelResult.status,
  configuredModelResult: modelResult.classification,
  titleJson: preprocessing.title,
  contentJson: preprocessing.content,
}, null, 2))
