/** Queue recovery tests own temporary files and await all subprocess exits before cleanup. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { createCourseJobs } from '../course-jobs.mjs'

async function until(condition) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const result = condition()
    if (result) return result
    await delay(20)
  }
  throw new Error('Queue condition did not become observable')
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'axisverse-queue-'))
  const queues = []
  t.after(async () => {
    try { for (const queue of queues.reverse()) await queue.dispose() }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 3 }) }
  })
  const config = { uploadReceiptsDirectory: directory, maxUploadBytes: 64, uploadPollMs: 1,
    maxRemotePages: 500, splitCommand: ['missing-fixture-split'],
    ocrIdleTimeoutMs: 60000, ocrCommand: ['missing-fixture-ocr'] }
  const uploader = { dispose() {}, async uploadFile() {
    return { searchable: true, document_id: 'doc_indexed', page_count: 2 }
  } }
  const start = async () => { const queue = await createCourseJobs(config, uploader); queues.push(queue); return queue }
  return { directory, config, uploader, start, queues }
}

test('streams fragmented PDFs at the byte limit and cleans rejected temporary files', async t => {
  const f = await fixture(t)
  const queue = await f.start()
  const bytes = Buffer.from('%PDF-' + 'a'.repeat(59))
  const accepted = await queue.save(Readable.from([...bytes].map(byte => Buffer.from([byte]))), 'original.pdf')
  assert.equal(accepted.size, 64)
  await until(() => queue.status(accepted.uploadId).phase === 'ready')
  await assert.rejects(queue.save(Readable.from([Buffer.concat([bytes, Buffer.from('x')])]), 'oversize.pdf'), /tooLarge/)
  await assert.rejects(queue.save(Readable.from([Buffer.from('invalid')]), 'invalid.pdf'), /unsupported/)
  assert.equal(queue.statuses().length, 1)
  assert.equal((await readdir(join(f.directory, 'originals'))).some(name => name.endsWith('.tmp')), false)
})

test('restores old saved failures and retries the original without another upload', async t => {
  const f = await fixture(t)
  const root = join(f.directory, 'originals')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(root)
  const hash = createHash('sha256').update('%PDF-original').digest('hex')
  const db = new DatabaseSync(join(root, 'materials.sqlite'))
  db.exec('CREATE TABLE materials (hash TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL, phase TEXT NOT NULL, remote_id TEXT, pages INTEGER NOT NULL DEFAULT 0); PRAGMA user_version = 1;')
  db.prepare('INSERT INTO materials (hash,name,size,phase) VALUES (?,?,?,?)').run(hash, 'original.pdf', 13, 'stored')
  db.close()
  await writeFile(join(root, hash + '.pdf'), '%PDF-original')
  const queue = await f.start()
  const [saved] = queue.statuses()
  assert.equal(saved.phase, 'failed')
  assert.equal(saved.errorCode, 'processingFailed')
  assert.equal(queue.retry(saved.uploadId).phase, 'queued')
  await until(() => queue.status(saved.uploadId).phase === 'ready')
  assert.equal(queue.status(saved.uploadId).name, 'original.pdf')
})

test('checkpoints real subprocess progress and resumes it after a quiescent restart', async t => {
  const f = await fixture(t)
  const helper = join(f.directory, 'recognize.mjs')
  await writeFile(helper, `import {existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout} from 'node:timers/promises';
const root=process.argv[4];
writeFileSync(join(root,'checkpoint'),'1');
console.log(JSON.stringify({totalPages:2,completedPages:1}));
while(!existsSync(join(root,'release'))) await setTimeout(20);
writeFileSync(process.argv[3],'%PDF-recognized');
console.log(JSON.stringify({totalPages:2,completedPages:2}));\n`)
  f.config.ocrCommand = [process.execPath, helper]
  f.uploader.uploadFile = async path => {
    if (!path.endsWith('.ocr.pdf')) throw new Error('needsOcr')
    return { searchable: true, document_id: 'doc_recognized', page_count: 2 }
  }
  const first = await f.start()
  const saved = await first.save(Readable.from([Buffer.from('%PDF-original')]), 'scan.pdf')
  await until(() => first.status(saved.uploadId).completedPages === 1)
  assert.equal(first.status(saved.uploadId).phase, 'recognizing')
  assert.equal(first.status(saved.uploadId).errorCode, null)
  await first.dispose(); f.queues.splice(f.queues.indexOf(first), 1)
  const second = await f.start()
  await until(() => second.status(saved.uploadId).phase === 'recognizing')
  assert.equal(second.status(saved.uploadId).completedPages, 1)
  await writeFile(join(f.directory, 'originals', 'release'), '')
  await until(() => second.status(saved.uploadId).phase === 'ready')
  assert.equal(second.status(saved.uploadId).completedPages, 2)
  assert.equal(second.status(saved.uploadId).name, 'scan.pdf')
})
