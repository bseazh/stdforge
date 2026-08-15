// LLM 结构化提取 + 显式键值解析测试
// 运行：node test-llm-extract.mjs
import { createServer } from 'node:http'
import { extractStandardWithLlm, parseSamrDetailKeyValues } from './crawl-samr.mjs'

const sampleHtml = `
<div class="basic-info cmn-clearfix">
  <dl class="basicInfo-block basicInfo-left">
    <dt class="basicInfo-item name">标准号</dt>
    <dd class="basicInfo-item value">GB/T 44494-2024</dd>
    <dt class="basicInfo-item name">发布日期</dt>
    <dd class="basicInfo-item value">2024-09-29</dd>
    <dt class="basicInfo-item name">实施日期</dt>
    <dd class="basicInfo-item value">2025-04-01</dd>
    <dt class="basicInfo-item name">标准类别</dt>
    <dd class="basicInfo-item value">方法</dd>
    <dt class="basicInfo-item name">归口单位</dt>
    <dd class="basicInfo-item value">全国家用电器标准化技术委员会</dd>
    <dt class="basicInfo-item name">主管部门</dt>
    <dd class="basicInfo-item value">中国轻工业联合会</dd>
  </dl>
</div>
<div class="para-title"><h2 class="title-text">起草单位</h2></div>
<div class="basic-info cmn-clearfix">
  <dl class="basicInfo-block basicInfo-left">
    <dd class="basicInfo-item value"><a href=""><span class="glyphicon glyphicon-link"></span>青岛海尔电冰箱有限公司</a></dd>
    <dd class="basicInfo-item value"><a href=""><span class="glyphicon glyphicon-link"></span>海信冰箱有限公司</a></dd>
  </dl>
</div>
<div class="para-title"><h2 class="title-text">起草人</h2></div>
<p>张三、李四</p>
`

const keyValues = parseSamrDetailKeyValues(sampleHtml)
if (keyValues['标准号'] !== 'GB/T 44494-2024') throw new Error('标准号键值解析失败')
if (keyValues['归口单位'] !== '全国家用电器标准化技术委员会') throw new Error('归口单位键值解析失败')
if (!keyValues['起草单位']?.includes('海信冰箱有限公司')) throw new Error('起草单位 dd 列表解析失败')
if (!keyValues['起草人']?.includes('张三')) throw new Error('起草人 p 值解析失败')
console.log('显式键值解析 OK:', JSON.stringify(keyValues, null, 2))

const baseStandard = {
  id: 'sample',
  standardNo: 'GB/T 44494-2024',
  title: '家用和类似用途制冷器具 食品保鲜',
  rawType: 'gb',
  url: 'https://std.samr.gov.cn/gb/search/gbDetailed?id=sample',
  draftUnits: [],
  draftStaff: [],
  tc: '',
  issuer: '',
  standardType: '',
  status: '现行',
  publishedAt: '',
  effectiveAt: '',
  replaces: '',
  ics: '',
  ccs: '',
  detailKeyValues: keyValues,
  detailText: '家用和类似用途制冷器具 食品保鲜 主要起草单位 青岛海尔电冰箱有限公司、海信冰箱有限公司。',
}

const unconfigured = await extractStandardWithLlm(baseStandard)
if (unconfigured.llmStatus !== 'model_unconfigured') throw new Error('无配置降级状态错误')
if (!unconfigured.draftUnits.length || !unconfigured.draftUnits.includes('海信冰箱有限公司')) {
  throw new Error('无模型时未使用显式键值兜底')
}
console.log('无配置降级 OK：显式键值兜底 draftUnits =', unconfigured.draftUnits)

let receivedBody = null
const mockServer = createServer((request, response) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    receivedBody = JSON.parse(body)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            draftUnits: ['青岛海尔电冰箱有限公司', '海信冰箱有限公司', '珠海格力电器股份有限公司'],
            draftStaff: ['张三', '李四'],
            tc: '全国家用电器标准化技术委员会',
            sc: '全国家用电器标准化技术委员会制冷空调器具分会',
            issuer: '中国轻工业联合会',
            standardType: '方法标准',
            techAreas: ['保鲜', '控温'],
            scope: '规定了家用制冷器具食品保鲜性能的试验方法。',
            status: '现行',
            publishedAt: '2024-09-29',
            effectiveAt: '2025-04-01',
            replaces: '',
            ics: '97.040.30',
            ccs: 'Y61',
            confidence: 0.93,
            reasoning: '起草单位来自详情页显式键值，技术领域依据标准名称与 ICS。',
            evidence: ['起草单位：海信冰箱有限公司', '标准名称含“食品保鲜”'],
          }),
        },
      }],
    }))
  })
})
await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
const address = mockServer.address()
const configured = await extractStandardWithLlm(baseStandard, {
  config: {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    model: 'mock-std-model',
    apiKey: 'test-secret',
  },
})
await new Promise((resolve, reject) => mockServer.close((error) => error ? reject(error) : resolve()))

if (configured.llmStatus !== 'completed') throw new Error('模型提取未完成')
if (configured.llmExtraction.techAreas?.join(',') !== '保鲜,控温') throw new Error('技术领域提取失败')
if (configured.llmExtraction.standardType !== '方法标准') throw new Error('标准类型提取失败')
if (configured.tc !== '全国家用电器标准化技术委员会') throw new Error('LLM 结果未合并到 tc')
if (configured.publishedAt !== '2024-09-29') throw new Error('LLM 结果未合并到 publishedAt')
if (receivedBody?.model !== 'mock-std-model') throw new Error('模型名传递失败')
if (!receivedBody?.messages?.[1]?.content?.includes('detailKeyValues')) throw new Error('提示词未携带显式键值')

console.log(JSON.stringify({
  configuredModel: receivedBody.model,
  llmStatus: configured.llmStatus,
  llmExtraction: configured.llmExtraction,
  mergedTc: configured.tc,
  mergedPublishedAt: configured.publishedAt,
}, null, 2))
console.log('全部断言通过')
