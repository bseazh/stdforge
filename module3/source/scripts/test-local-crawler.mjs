const response = await fetch('http://127.0.0.1:5173/api/crawl/miit', {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    keywords: ['冰箱', '白色家电'],
    startDate: '2020-01-01',
    endDate: new Date().toISOString().slice(0, 10),
    maxPages: 2,
    pageSize: 10,
  }),
})

const body = await response.json()
if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)

const invalidOfficialUrls = body.policies.filter((policy) => {
  const hostname = new URL(policy.url).hostname
  return !hostname.endsWith('miit.gov.cn')
})

console.log(JSON.stringify({
  status: response.status,
  keywordStats: body.keywordStats,
  policyCount: body.policies.length,
  policiesWithContent: body.policies.filter((policy) => policy.contentPreview).length,
  invalidOfficialUrlCount: invalidOfficialUrls.length,
  samplePolicies: body.policies.slice(0, 10).map((policy) => ({
    title: policy.title,
    publishedAt: policy.publishedAt,
    documentNumber: policy.documentNumber,
    publisher: policy.publisher,
    url: policy.url,
  })),
}, null, 2))
