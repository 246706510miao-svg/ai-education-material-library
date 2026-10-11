/** Isolated route checks use no shared ports, credentials, or remote writes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { apply, extractCourseOutline } from '../course-library.mjs'

async function fixture(t, rejection, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), 'axisverse-library-'))
  const connectionFile = join(root, 'connection.json'), receipt = join(root, 'receipt.json')
  await writeFile(connectionFile, JSON.stringify({ url: 'https://materials.example/mcp', headers: { Authorization: 'Bearer fixture-only' } }))
  await writeFile(receipt, JSON.stringify({ status: 'success', searchable: true, document_id: 'doc_own' }))
  let handler
  const disposers = []
  const pdfAssetsDirectory = fileURLToPath(new URL('../../../../packages/client/ui-sidebar-documentpreview/node_modules/pdfjs-dist', import.meta.url))
  const ctx = { connection: { requestRejection: () => rejection }, effect: fn => { disposers.push(fn()) }, webServer: { register: route => { handler = route.handler; return () => {} } } }
  const config = { connectionFile, receiptFiles: [receipt], school: 'School', major: 'Major', course: 'Calculus', timeoutMs: 1000, pdfAssetsDirectory, uploadReceiptsDirectory: join(root, 'uploads'), uploadCourse: 'Personal materials', uploadUnit: 'User upload', maxUploadBytes: 1024, uploadTimeoutMs: 1000, ocrIdleTimeoutMs: 60000, uploadPollMs: 1, ocrCommand: ['axisverse-missing-ocr-fixture'] }
  Object.assign(config, { maxRemotePages: 500, splitCommand: ['missing-fixture-split'] }, overrides)
  await apply(ctx, config)
  t.after(async () => {
    try { for (const dispose of disposers.reverse()) await dispose() }
    finally { await rm(root, { recursive: true, force: true, maxRetries: 3 }) }
  })
  const route = async (url, method = 'GET', bytes, headers = {}) => {
    const chunks = []
    const res = new Writable({ write(chunk, _encoding, done) { chunks.push(Buffer.from(chunk)); done() },
      final(done) { if (res.body === undefined) res.body = Buffer.concat(chunks); done() } })
    const end = res.end.bind(res)
    Object.assign(res, { headersSent: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true },
      end(body) { if (body !== undefined) this.body = body; return end(body) } })
    const req = Readable.from(bytes ? [bytes] : [])
    Object.assign(req, { url, method, headers })
    await handler(req, res)
    return res
  }
  route.restart = async () => {
    for (const dispose of disposers.splice(0).reverse()) await dispose()
    await apply(ctx, config)
  }
  route.root = join(root, 'uploads', 'originals')
  return route
}

async function finished(route, receipt) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const res = await route(`/api/axisverse/materials/uploads/${receipt.uploadId}`)
    const value = JSON.parse(res.body)
    if (value.phase === 'ready' || value.phase === 'failed') return value
    await delay(10)
  }
  throw new Error('Material processing did not settle')
}

test('authentication and own-document checks run before any remote fetch', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected network') })
  const unauthenticated = await fixture(t, 401)
  assert.equal((await unauthenticated('/api/axisverse/materials')).status, 401)
  const allowed = await fixture(t)
  assert.equal((await allowed('/api/axisverse/materials/doc_other/file')).status, 404)
  assert.equal((await allowed('/api/axisverse/materials/doc_other/outline')).status, 404)
  assert.equal((await allowed('/api/axisverse/materials', 'POST')).status, 405)
  assert.equal(fetch.mock.callCount(), 0)
})

test('reads all content pages and returns only original section titles', async t => {
  const route = await fixture(t)
  const fetch = t.mock.method(globalThis, 'fetch', async url => Response.json({
    status: 'success', document_id: 'doc_own',
    items: [{ page_start: url.searchParams.has('cursor') ? 2 : 1, text: url.searchParams.has('cursor') ? '第二节 二重积分的计算法 035 」' : '* 第一节 二重积分的概念与性质\n正文' }],
    next_cursor: url.searchParams.has('cursor') ? null : 'next',
  }))
  const res = await route('/api/axisverse/materials/doc_own/outline')
  assert.equal(res.status, 200)
  assert.equal(fetch.mock.callCount(), 2)
  assert.deepEqual(JSON.parse(res.body).items, [{ title: '第一节 二重积分的概念与性质', page: 1 }, { title: '第二节 二重积分的计算法', page: 2 }])
})

test('deduplicates running headers and never invents headings in plain prose', () => {
  assert.deepEqual(extractCourseOutline([{ page_start: 1, text: '第一节 二重积分\n第一节 二重积分 133\n这是没有小标题的正文。' }]), [{ title: '第一节 二重积分', page: 1 }])
})

test('lists only uploaded receipts and strips private upstream fields', async t => {
  const route = await fixture(t)
  const row = { school: 'School', major: 'Major', course: 'Calculus', title: 'My PDF（53页教材照片，文字识别版）', page_count: 53, unit: 'Chapter 9' }
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success', items: [{ ...row, document_id: 'doc_other' }, { ...row, document_id: 'doc_own', secret: 'must not escape' }], next_cursor: null }))
  const res = await route('/api/axisverse/materials')
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { items: [{ id: 'doc_own', title: 'My PDF', pages: 53, course: 'Calculus', unit: 'Chapter 9' }] })
})

test('rejects off-origin PDF URLs without following them or exposing secrets', async t => {
  const route = await fixture(t)
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ download_url: 'https://other.example/private?token=secret' }))
  const res = await route('/api/axisverse/materials/doc_own/file')
  assert.equal(res.status, 502)
  assert.equal(res.body, '{"code":"unavailable"}')
  assert.equal(fetch.mock.callCount(), 1)
})

test('remote failure is unavailable rather than an empty successful list', async t => {
  const route = await fixture(t)
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 503 }))
  assert.equal((await route('/api/axisverse/materials')).status, 502)
})

test('extracts spaced Chinese chapter and decimal section headings without treating equations as titles', () => {
  assert.deepEqual(extractCourseOutline([{ page_start: 19, text: '第 1 章 绪 论 001\n1.2 热 能 传 递 的 三 种 基 本 方 式\n3 ． 4 数 值 方 法\n1.3 f(x) = x 的表达式\n0.95 × L42 m2 系数\n第2章 中已经指出导热微分方程式的条件。\n没有编号的普通正文。' }]), [
    { title: '第1章 绪论', page: 19 }, { title: '1.2 热能传递的三种基本方式', page: 19 }, { title: '3.4 数值方法', page: 19 },
  ])
})

test('removes only receipt-authorized entries, blocks their access and permits undo without remote deletion', async t => {
  const route = await fixture(t)
  const remote = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.method, undefined)
    return Response.json({ status: 'success', items: [{ document_id: 'doc_own', school: 'School', major: 'Major', title: 'Notes', page_count: 12, course: 'Calculus', unit: '' }], next_cursor: null })
  })
  assert.equal((await route('/api/axisverse/materials/doc_other', 'DELETE')).status, 404)
  assert.equal((await route('/api/axisverse/materials/doc_other/restore', 'POST')).status, 404)
  const denied = await fixture(t, 401)
  assert.equal((await denied('/api/axisverse/materials/doc_own', 'DELETE')).status, 401)
  assert.equal((await denied('/api/axisverse/materials/doc_own/restore', 'POST')).status, 401)
  assert.equal((await route('/api/axisverse/materials/doc_own', 'DELETE')).status, 200)
  assert.equal((await route('/api/axisverse/materials/doc_own', 'DELETE')).status, 200)
  assert.equal(remote.mock.callCount(), 0)
  await route.restart()
  assert.deepEqual(JSON.parse((await route('/api/axisverse/materials')).body), { items: [] })
  for (const action of ['view', 'file', 'outline']) assert.equal((await route(`/api/axisverse/materials/doc_own/${action}`)).status, 404)
  assert.equal((await route('/api/axisverse/materials/doc_own/restore', 'POST')).status, 200)
  assert.equal((await route('/api/axisverse/materials/doc_own/restore', 'POST')).status, 200)
  assert.equal(JSON.parse((await route('/api/axisverse/materials')).body).items[0].id, 'doc_own')
  assert.equal((await route('/api/axisverse/materials/doc_own/view')).status, 200)
})

test('serves the authenticated reader and same-version renderer without native PDF navigation', async t => {
  const route = await fixture(t)
  assert.equal((await route('/api/axisverse/materials/doc_other/view')).status, 404)
  const reader = await route('/api/axisverse/materials/doc_own/view')
  assert.equal(reader.status, 200)
  assert.match(reader.body.toString(), /<canvas/)
  assert.match(reader.body.toString(), /\.\.\/viewer.mjs/)
  const script = await route('/api/axisverse/materials/viewer.mjs')
  assert.equal(script.headers['Content-Type'], 'text/javascript')
  const engine = await route('/api/axisverse/materials/assets/build/pdf.mjs')
  assert.equal(engine.status, 200)
  assert.equal((await route('/api/axisverse/materials/assets/package.json')).status, 404)
  const unauthorized = await fixture(t, 401)
  assert.equal((await unauthorized('/api/axisverse/materials/doc_own/view')).status, 401)
})

test('uploads real bytes, saves a receipt and reuses it on retry', async t => {
  const route = await fixture(t)
  const remote = t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options.method === 'POST') {
      assert.equal(url.pathname, '/v1/materials/ingest')
      assert.equal(await options.body.get('file').text(), '%PDF-1.7 example')
      assert.equal(options.body.get('course'), 'Personal materials')
      assert.equal(options.body.get('title'), 'notes.pdf')
      return Response.json({ status: 'success', document_id: 'doc_new', searchable: true, page_count: 12 })
    }
    return Response.json({ status: 'success', items: [{ document_id: 'doc_new', school: 'School', major: 'Major', course: 'Personal materials', title: 'notes', page_count: 12, unit: 'User upload' }], next_cursor: null })
  })
  const headers = { 'content-type': 'application/pdf', 'x-material-name': 'notes.pdf' }
  const upload = () => route('/api/axisverse/materials/upload', 'POST', Buffer.from('%PDF-1.7 example'), headers)
  const first = await upload()
  assert.equal(first.status, 202)
  const accepted = JSON.parse(first.body)
  assert.equal(accepted.stored, true)
  assert.equal((await finished(route, accepted)).searchable, true)
  assert.equal(JSON.parse((await upload()).body).id, 'doc_new')
  assert.equal(remote.mock.callCount(), 1)
  assert.deepEqual(JSON.parse((await route('/api/axisverse/materials')).body).items[0], { id: 'doc_new', title: 'notes.pdf', pages: 12, course: 'Personal materials', unit: '' })
  assert.equal((await route('/api/axisverse/materials/doc_new/view')).status, 200)
  await route('/api/axisverse/materials/doc_new', 'DELETE')
  assert.equal((await route('/api/axisverse/materials/doc_new/view')).status, 404)
  const callsBeforeRetry = remote.mock.callCount()
  assert.equal((await upload()).status, 202)
  assert.equal(remote.mock.callCount(), callsBeforeRetry)
  assert.equal((await route('/api/axisverse/materials/doc_new/view')).status, 200)
})

test('rejects invalid PDFs and oversize requests before sending any remote bytes', async t => {
  const route = await fixture(t)
  const remote = t.mock.method(globalThis, 'fetch', () => { throw Error('unexpected network') })
  const headers = { 'content-type': 'application/pdf', 'x-material-name': 'notes.pdf' }
  assert.equal((await route('/api/axisverse/materials/upload', 'POST', Buffer.from('not PDF'), headers)).status, 415)
  assert.equal((await route('/api/axisverse/materials/upload', 'POST', Buffer.alloc(1025), headers)).status, 413)
  assert.equal((await route('/api/axisverse/materials/upload', 'POST', Buffer.alloc(0), headers)).status, 400)
  const denied = await fixture(t, 403)
  assert.equal((await denied('/api/axisverse/materials/upload', 'POST', Buffer.from('%PDF-'), headers)).status, 403)
  assert.equal(remote.mock.callCount(), 0)
})

test('preserves partial ingestion as stored without claiming searchable success', async t => {
  const route = await fixture(t)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'partial_success', document_id: 'doc_scan', searchable: false, page_count: 3 }))
  const response = await route('/api/axisverse/materials/upload', 'POST', Buffer.from('%PDF-'), { 'content-type': 'application/pdf', 'x-material-name': 'scan.pdf' })
  assert.equal(response.status, 202)
  const status = await finished(route, JSON.parse(response.body))
  assert.equal(status.searchable, false)
  assert.equal((await route(`/api/axisverse/materials/${status.id}/file`)).body.toString(), '%PDF-')
})

test('remote indexing failure keeps the stored original available across restart', async t => {
  const route = await fixture(t)
  t.mock.method(globalThis, 'fetch', async () => new Response('private error', { status: 500 }))
  const response = await route('/api/axisverse/materials/upload', 'POST', Buffer.from('%PDF-'), { 'content-type': 'application/pdf', 'x-material-name': 'notes.pdf' })
  assert.equal(response.status, 202)
  const status = await finished(route, JSON.parse(response.body))
  assert.equal(status.phase, 'failed')
  assert.equal(status.errorCode, 'remoteUnavailable')
  await route.restart()
  assert.equal((await route(`/api/axisverse/materials/${status.id}/file`)).body.toString(), '%PDF-')
})

test('retains scans even when automatic OCR is unavailable', async t => {
  const route = await fixture(t)
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'error', error_code: 'PDF_TEXT_NOT_EXTRACTABLE' }, { status: 422 }))
  const response = await route('/api/axisverse/materials/upload', 'POST', Buffer.from('%PDF-'), { 'content-type': 'application/pdf', 'x-material-name': 'scan.pdf' })
  assert.equal(response.status, 202)
  const status = await finished(route, JSON.parse(response.body))
  assert.equal(status.phase, 'failed')
  assert.equal(status.errorCode, 'ocrUnavailable')
  assert.equal(status.searchable, false)
  assert.equal((await route(`/api/axisverse/materials/${status.id}/file`)).body.toString(), '%PDF-')
})

test('retries a remote rejection from completed OCR without repeating recognition', async t => {
  const route = await fixture(t, undefined, { ocrCommand: [process.execPath, '-e',
    "const fs=require('node:fs');fs.appendFileSync(require('node:path').join(process.argv[3],'runs'),'x');fs.writeFileSync(process.argv[2],'%PDF-recognized')"] })
  let recognizedTransfers = 0
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    if (await options.body.get('file').text() === '%PDF-original') {
      return Response.json({ error_code: 'PDF_TEXT_NOT_EXTRACTABLE' }, { status: 422 })
    }
    if (++recognizedTransfers === 1) return Response.json({ error_code: 'FIXTURE_REJECTION', detail: 'Fixture rejection' }, { status: 400 })
    return Response.json({ status: 'success', document_id: 'doc_retried', searchable: true, page_count: 1 })
  })
  const response = await route('/api/axisverse/materials/upload', 'POST', Buffer.from('%PDF-original'),
    { 'content-type': 'application/pdf', 'x-material-name': 'scan.pdf' })
  const accepted = JSON.parse(response.body)
  const failed = await finished(route, accepted)
  assert.equal(failed.errorCode, 'remoteRejected')
  await route.restart()
  const retry = await route(`/api/axisverse/materials/uploads/${accepted.uploadId}/retry`, 'POST')
  assert.equal(retry.status, 202)
  assert.equal((await finished(route, accepted)).id, 'doc_retried')
  assert.equal(await readFile(join(route.root, 'runs'), 'utf8'), 'x')
  assert.equal((await route('/api/axisverse/materials/doc_retried/file')).body.toString(), '%PDF-original')
})

for (const rejection of [422, 413]) test(`processes a scan after upstream ${rejection} while retaining its original bytes`, async t => {
  const route = await fixture(t, undefined, { ocrCommand: [process.execPath, '-e',
    "require('node:fs').writeFileSync(process.argv[2], '%PDF-recognized')"] })
  const transfers = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    transfers.push(await options.body.get('file').text())
    return transfers.length === 1
      ? Response.json({ status: 'error', error_code: 'PDF_TEXT_NOT_EXTRACTABLE' }, { status: rejection })
      : Response.json({ status: 'success', document_id: 'doc_recognized', searchable: true, page_count: 1 })
  })
  const response = await route('/api/axisverse/materials/upload', 'POST', Buffer.from('%PDF-original'),
    { 'content-type': 'application/pdf', 'x-material-name': 'scan.pdf' })
  const accepted = JSON.parse(response.body)
  assert.equal(accepted.stored, true)
  const result = await finished(route, accepted)
  assert.deepEqual(transfers, ['%PDF-original', '%PDF-recognized'])
  assert.equal(result.id, 'doc_recognized')
  assert.equal(result.phase, 'ready')
  assert.equal((await route(`/api/axisverse/materials/${accepted.uploadId}/file`)).body.toString(), '%PDF-original')
  assert.equal((await route(`/api/axisverse/materials/${result.id}/file?download=1`)).body.toString(), '%PDF-original')
  assert.equal((await route(`/api/axisverse/materials/${accepted.uploadId}/file?download=1`)).headers['Content-Disposition'],
    "attachment; filename=\"course-material.pdf\"; filename*=UTF-8''scan.pdf")
  t.mock.method(globalThis, 'fetch', async () => Response.json({ status: 'success', items: [{
    document_id: 'doc_recognized', school: 'School', major: 'Major', course: 'Personal materials',
    title: 'scan-文字识别版', page_count: 1, unit: 'User upload',
  }], next_cursor: null }))
  assert.equal(JSON.parse((await route('/api/axisverse/materials')).body).items[0].title, 'scan.pdf')
  await route.restart()
  assert.equal(JSON.parse((await route('/api/axisverse/materials')).body).items[0].title, 'scan.pdf')
})

test('resumes confirmed parts, lists one original and maps later headings to whole-PDF pages', async t => {
  const route = await fixture(t, undefined, { maxRemotePages: 2,
    ocrCommand: [process.execPath, '-e', "require('node:fs').writeFileSync(process.argv[2],'%PDF-searchable');console.log(JSON.stringify({totalPages:3,completedPages:3}))"],
    splitCommand: [process.execPath, '-e', `const fs=require('node:fs'),p=require('node:path');
const root=process.argv[2],hash=p.basename(process.argv[1]).slice(0,64);
fs.writeFileSync(p.join(root,hash+'.part-00001.pdf'),'%PDF-first');
fs.writeFileSync(p.join(root,hash+'.part-00002.pdf'),'%PDF-last');
fs.writeFileSync(p.join(root,hash+'.parts.json'),JSON.stringify([{pageStart:1,pageCount:2},{pageStart:3,pageCount:1}]));
console.log(JSON.stringify({totalPages:3,completedPages:3}));`] })
  const calls = [], uploaded = []
  let rejectLast = true
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (options?.method === 'POST') {
      const bytes = await options.body.get('file').text()
      calls.push(bytes)
      assert.equal(options.body.get('title'), 'original.pdf')
      if (bytes === '%PDF-original') return Response.json({ error_code: 'TOO_MANY_PAGES' }, { status: 422 })
      if (bytes === '%PDF-last' && rejectLast) return new Response('', { status: 503 })
      const id = bytes === '%PDF-first' ? 'doc_first' : 'doc_last'
      uploaded.push({ document_id: id, school: 'School', major: 'Major', title: 'original.pdf', page_count: id === 'doc_first' ? 2 : 1 })
      return Response.json({ status: 'success', searchable: true, document_id: id, page_count: id === 'doc_first' ? 2 : 1 })
    }
    if (url.pathname.endsWith('/content')) {
      const id = url.pathname.split('/')[3]
      return Response.json({ status: 'success', document_id: id, items: [{ page_start: 1,
        text: id === 'doc_first' ? '第一节 初始小节' : 'PDF 1 / 1\n第一节 后续小节' }], next_cursor: null })
    }
    return Response.json({ status: 'success', items: uploaded, next_cursor: null })
  })
  const accepted = JSON.parse((await route('/api/axisverse/materials/upload', 'POST', Buffer.from('%PDF-original'),
    { 'content-type': 'application/pdf', 'x-material-name': 'original.pdf' })).body)
  assert.equal((await finished(route, accepted)).errorCode, 'remoteUnavailable')
  assert.equal(JSON.parse((await route('/api/axisverse/materials')).body).items.length, 1)
  await route.restart()
  rejectLast = false
  await route(`/api/axisverse/materials/uploads/${accepted.uploadId}/retry`, 'POST')
  const ready = await finished(route, accepted)
  assert.equal(ready.id, accepted.uploadId)
  assert.equal(ready.totalPages, 3)
  assert.deepEqual(calls, ['%PDF-original', '%PDF-first', '%PDF-last', '%PDF-last'])
  const [card] = JSON.parse((await route('/api/axisverse/materials')).body).items
  assert.equal(card.title, 'original.pdf')
  assert.deepEqual(card.sources, [{ id: 'doc_first', pageStart: 1, pageCount: 2 }, { id: 'doc_last', pageStart: 3, pageCount: 1 }])
  assert.deepEqual(JSON.parse((await route(`/api/axisverse/materials/${ready.id}/outline`)).body).items,
    [{ title: '第一节 初始小节', page: 1 }, { title: '第一节 后续小节', page: 3 }])
  assert.equal((await route(`/api/axisverse/materials/${ready.id}/file`)).body.toString(), '%PDF-original')
  await route(`/api/axisverse/materials/${ready.id}`, 'DELETE')
  assert.deepEqual(JSON.parse((await route('/api/axisverse/materials')).body).items, [])
  assert.equal((await route('/api/axisverse/materials/doc_last/file')).status, 404)
  await route(`/api/axisverse/materials/${ready.id}/restore`, 'POST')
  assert.equal(JSON.parse((await route('/api/axisverse/materials')).body).items.length, 1)
  await route.restart()
  assert.equal(JSON.parse((await route('/api/axisverse/materials')).body).items.length, 1)
})
