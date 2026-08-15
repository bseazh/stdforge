import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBilingualService } from '../server/bilingual-translation.mjs'

const runtimePath = await mkdtemp(join(tmpdir(), 'stdforge-bilingual-'))
const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    choices: [{ message: { content: JSON.stringify([
      { id: 'segment-1', text: 'The evaporator shall comply with the requirements.' },
      { id: 'segment-2', text: 'Defrost performance shall be verified.' },
    ]) } }],
  }),
})
const service = createBilingualService({
  storePath: join(runtimePath, 'store.json'),
  config: { baseUrl: 'https://translation.invalid', model: 'test-model', apiKey: 'test-key' },
})

try {
  const initialTerms = await service.listGlossary()
  assert.ok(initialTerms.some((term) => term.source === '蒸发器' && term.target === 'evaporator'))

  const createdTerm = await service.createGlossaryTerm({ source: '结霜', target: 'frost formation', domain: 'refrigeration' })
  const updatedTerm = await service.updateGlossaryTerm(createdTerm.id, { ...createdTerm, target: 'frost accumulation' })
  assert.equal(updatedTerm.target, 'frost accumulation')
  await service.deleteGlossaryTerm(createdTerm.id)

  const stored = await service.createTranslation({
    document: { title: '制冷器具要求', content: '蒸发器应符合规定。\n\n化霜性能应进行验证。' },
    mode: 'parallel',
    author: 'tester',
  })
  assert.equal(stored.segments.length, 2)
  assert.equal(stored.versions.zh.length, 1)
  assert.equal(stored.versions.en.length, 1)

  const revised = await service.reviseTranslation(stored.id, {
    language: 'en',
    author: 'reviewer',
    reason: '术语校对',
    segments: [{ id: 'segment-1', text: 'The evaporator shall meet the specified requirements.' }],
  })
  assert.equal(revised.segments[0].status, 'reviewed')
  assert.equal(revised.versions.zh.length, 1)
  assert.equal(revised.versions.en.length, 2)

  const parallel = await service.getDownload(stored.id, 'parallel')
  const english = await service.getDownload(stored.id, 'en')
  assert.match(parallel.content, /中文 \| English/)
  assert.match(english.content, /specified requirements/)
  console.log('Bilingual API contract checks passed: glossary CRUD, aligned versions, and downloads.')
} finally {
  globalThis.fetch = originalFetch
  await rm(runtimePath, { recursive: true, force: true })
}
