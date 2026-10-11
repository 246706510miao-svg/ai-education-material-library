import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareAxisVerse } from './axisverse-start.mjs'

test('requires both credentials without writing a partial connection file', async t => {
  const root = await mkdtemp(join(tmpdir(), 'axisverse-start-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, '.env'), 'DEEPSEEK_API_KEY=fixture-model\n')
  await assert.rejects(prepareAxisVerse(root, {}), /AXISVERSE_MCP_KEY/)
  await assert.rejects(readFile(join(root, 'axisverse-course-mcp.local.json')), { code: 'ENOENT' })
})

test('fresh installation generates connection config and uses the shipped dsh profile', async t => {
  const root = await mkdtemp(join(tmpdir(), 'axisverse-start-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, '.env'), 'DEEPSEEK_API_KEY=fixture-model\nAXISVERSE_MCP_KEY=fixture-material\n')
  const result = await prepareAxisVerse(root, {})
  const connection = JSON.parse(await readFile(join(root, 'axisverse-course-mcp.local.json'), 'utf8'))
  assert.equal(connection.headers.Authorization, 'Bearer fixture-material')
  assert.equal(result.environment.DEEPSEEK_API_KEY, 'fixture-model')
  assert.deepEqual(result.args, ['dsh', 'web', '--patch', 'apps/web/axisverse-study.patch.yml', '--patch', 'axisverse-team.patch.yml', '--port', '3082', '--no-open'])
  assert.equal(result.environment.AXISVERSE_COURSE_MCP_CONFIG, join(root, 'axisverse-course-mcp.local.json'))
})

test('existing private connection stays intact and placeholder model keys fail', async t => {
  const root = await mkdtemp(join(tmpdir(), 'axisverse-start-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'axisverse-course-mcp.local.json')
  const saved = JSON.stringify({ url: 'https://example.org/mcp', headers: { Authorization: 'Bearer retained' } })
  await writeFile(path, saved)
  await prepareAxisVerse(root, { DEEPSEEK_API_KEY: 'fixture-model' })
  assert.equal(await readFile(path, 'utf8'), saved)
  await assert.rejects(prepareAxisVerse(root, { DEEPSEEK_API_KEY: 'REPLACE_WITH_YOUR_OWN_MODEL_KEY' }), /DEEPSEEK_API_KEY/)
})

test('rotated env credential replaces the generated default connection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'axisverse-start-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'axisverse-course-mcp.local.json'), JSON.stringify({ url: 'https://example.org/mcp', headers: { Authorization: 'Bearer expired' } }))
  await prepareAxisVerse(root, { DEEPSEEK_API_KEY: 'fixture-model', AXISVERSE_MCP_KEY: 'renewed' })
  const saved = JSON.parse(await readFile(join(root, 'axisverse-course-mcp.local.json'), 'utf8'))
  assert.equal(saved.headers.Authorization, 'Bearer renewed')
})
