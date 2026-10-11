/** Save original PDFs to disk and resume recognition independently of browsers. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { spawn } from 'node:child_process'

const SCHEMA_VERSION = 3
const localId = hash => `doc_local_${hash}`
const failures = new Set(['processingFailed', 'recognitionFailed', 'recognitionTimeout', 'ocrUnavailable',
  'remoteUnavailable', 'remoteRejected', 'remoteTooLarge', 'textUnavailable'])

const partsOf = row => {
  if (row.parts_json === null) return []
  const parts = JSON.parse(row.parts_json)
  let next = 1
  if (!Array.isArray(parts) || parts.length < 2) throw new Error('Invalid material parts')
  for (const part of parts) {
    if (!part || part.pageStart !== next || !Number.isSafeInteger(part.pageCount) || part.pageCount < 1
      || (part.documentId !== null && !/^doc_[a-zA-Z0-9_-]+$/.test(part.documentId))) throw new Error('Invalid material part')
    next += part.pageCount
  }
  if (next !== row.pages + 1 || (row.phase === 'ready' && parts.some(part => part.documentId === null))) throw new Error('Incomplete material parts')
  return parts
}

/** Create a durable single-worker queue; disposal awaits uploads and subprocess termination. */
export async function createCourseJobs(config, uploader) {
  const root = join(config.uploadReceiptsDirectory, 'originals')
  await mkdir(root, { recursive: true })
  const db = new DatabaseSync(join(root, 'materials.sqlite'))
  const version = db.prepare('PRAGMA user_version').get().user_version
  if (version > SCHEMA_VERSION) { db.close(); throw new Error('Unsupported material database version') }
  if (version === 0) db.exec(`CREATE TABLE materials (
    hash TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL,
    phase TEXT NOT NULL, remote_id TEXT, pages INTEGER NOT NULL DEFAULT 0,
    completed_pages INTEGER NOT NULL DEFAULT 0, error_code TEXT
  ); PRAGMA user_version = 2;`)
  if (version === 1) db.exec(`BEGIN;
    ALTER TABLE materials ADD COLUMN completed_pages INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE materials ADD COLUMN error_code TEXT;
    UPDATE materials SET phase = 'failed', error_code = 'processingFailed' WHERE phase = 'stored';
    PRAGMA user_version = 2; COMMIT;`)
  if (version <= 2) db.exec('BEGIN; ALTER TABLE materials ADD COLUMN parts_json TEXT; PRAGMA user_version = 3; COMMIT;')
  for (const row of db.prepare('SELECT * FROM materials').all()) {
    try { partsOf(row) } catch (error) { db.close(); throw error }
    if (!/^[a-f0-9]{64}$/.test(row.hash) || typeof row.name !== 'string' || !/\.pdf$/i.test(row.name)
      || row.name.length > 255 || /[\x00-\x1f/\\]/.test(row.name)
      || !Number.isSafeInteger(row.size) || row.size < 1 || !Number.isSafeInteger(row.pages) || row.pages < 0
      || !Number.isInteger(row.completed_pages) || row.completed_pages < 0 || row.completed_pages > row.pages
      || !['queued', 'indexing', 'recognizing', 'ready', 'failed'].includes(row.phase)
      || (row.error_code !== null && !failures.has(row.error_code))
      || (row.remote_id !== null && !/^doc_[a-zA-Z0-9_-]+$/.test(row.remote_id))
      || (row.phase === 'ready' && (!row.remote_id || row.pages < 1))) {
      db.close(); throw new Error('Invalid stored material record')
    }
  }
  db.prepare("UPDATE materials SET phase = 'queued' WHERE phase IN ('recognizing', 'indexing')").run()
  let worker, closed = false
  const saving = new Map(), activeSaves = new Set()
  const lifetime = new AbortController()
  const filePath = hash => join(root, `${hash}.pdf`)
  const read = hash => db.prepare('SELECT * FROM materials WHERE hash = ?').get(hash)
  const phase = (hash, value, error = null) => db.prepare('UPDATE materials SET phase = ?, error_code = ? WHERE hash = ?').run(value, error, hash)
  const runHelper = async (hash, command, args) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/KEY|SECRET|TOKEN|PASSWORD|AUTHORIZATION/i.test(key)))
    await new Promise((resolve, reject) => {
      lifetime.signal.throwIfAborted()
      const child = spawn(command[0], [...command.slice(1), ...args], {
        windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
      })
      let failure, timer, stderr = '', stdout = '', stopping = false
      let termination = Promise.resolve()
      const stop = () => {
        if (!child.pid || stopping) return
        stopping = true
        if (process.platform === 'win32') termination = new Promise(done => {
          const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', env })
          killer.on('error', () => { child.kill(); done() })
          killer.on('close', done)
        })
        else {
          try { process.kill(-child.pid, 'SIGTERM') }
          catch (error) { if (error.code !== 'ESRCH') failure = new Error('recognitionFailed') }
        }
      }
      const abort = () => { failure = new Error('processingFailed'); stop() }
      const heartbeat = () => {
        clearTimeout(timer)
        timer = setTimeout(() => { failure = new Error('recognitionTimeout'); stop() }, config.ocrIdleTimeoutMs)
      }
      heartbeat()
      lifetime.signal.addEventListener('abort', abort, { once: true })
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        stdout += chunk
        if (stdout.length > 16384) { failure = new Error('recognitionFailed'); stop(); return }
        let end
        while ((end = stdout.indexOf('\n')) >= 0) {
          const line = stdout.slice(0, end).trim(); stdout = stdout.slice(end + 1)
          let value
          try { value = JSON.parse(line) }
          catch (_error) { continue /* Diagnostic stdout cannot update progress. */ }
          if (!value || !Number.isInteger(value.totalPages) || value.totalPages < 1
            || !Number.isInteger(value.completedPages) || value.completedPages < 0 || value.completedPages > value.totalPages) continue
          try {
            db.prepare('UPDATE materials SET pages = ?, completed_pages = ? WHERE hash = ?')
              .run(value.totalPages, value.completedPages, hash)
          } catch (_error) { failure = new Error('processingFailed'); stop(); return }
          heartbeat()
        }
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192) })
      child.on('error', error => { failure = new Error(error.code === 'ENOENT' ? 'ocrUnavailable' : 'recognitionFailed') })
      child.on('close', code => {
        clearTimeout(timer)
        lifetime.signal.removeEventListener('abort', abort)
        void termination.then(async () => {
          if (failure || code !== 0) {
            await writeFile(join(root, `${hash}.diagnostic.json`), JSON.stringify({
              error: failure?.message ?? 'recognitionFailed', exitCode: code, stderr,
            }) + '\n', { mode: 0o600 })
            reject(failure ?? new Error('recognitionFailed'))
          } else resolve()
        }).catch(reject)
      })
    })
  }
  const recognize = async hash => {
    const output = join(root, `${hash}.ocr.pdf`)
    try {
      await readFile(join(root, `${hash}.ocr-complete`))
      const handle = await open(output, 'r')
      await handle.close()
      return output
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    await runHelper(hash, config.ocrCommand, [filePath(hash), output, root])
    await writeFile(join(root, `${hash}.ocr-complete`), '', { mode: 0o600 })
    return output
  }
  const uploadParts = async (row, path) => {
    await runHelper(row.hash, config.splitCommand, [path, root, String(config.maxRemotePages)])
    const manifest = JSON.parse(await readFile(join(root, `${row.hash}.parts.json`), 'utf8'))
    const plan = manifest.map(part => ({ documentId: null, pageStart: part.pageStart, pageCount: part.pageCount }))
    partsOf({ ...read(row.hash), parts_json: JSON.stringify(plan), phase: 'indexing' })
    if (plan.some(part => part.pageCount > config.maxRemotePages)) throw new Error('Invalid material part size')
    const previous = partsOf(read(row.hash))
    if (previous.length && JSON.stringify(previous.map(({ pageStart, pageCount }) => ({ pageStart, pageCount }))) !== JSON.stringify(plan.map(({ pageStart, pageCount }) => ({ pageStart, pageCount })))) throw new Error('Changed material part plan')
    const parts = previous.length ? previous : plan
    const saveParts = () => db.prepare('UPDATE materials SET parts_json = ? WHERE hash = ?').run(JSON.stringify(parts), row.hash)
    saveParts()
    for (let index = 0; index < parts.length; index++) {
      lifetime.signal.throwIfAborted()
      const part = parts[index]
      if (part.documentId !== null) continue
      const receipt = await uploader.uploadFile(join(root, `${row.hash}.part-${String(index + 1).padStart(5, '0')}.pdf`), row.name)
      if (!receipt.searchable) throw new Error('textUnavailable')
      if (receipt.page_count !== part.pageCount) throw new Error('processingFailed')
      part.documentId = receipt.document_id
      saveParts()
    }
    return { searchable: true, document_id: parts[0].documentId, page_count: read(row.hash).pages }
  }
  const run = async () => {
    while (!closed) {
      const row = db.prepare("SELECT * FROM materials WHERE phase = 'queued' ORDER BY rowid LIMIT 1").get()
      if (!row) return
      try {
        phase(row.hash, 'indexing')
        let receipt
        try {
          if (row.pages > config.maxRemotePages) throw new Error('remotePageLimit')
          receipt = await uploader.uploadFile(filePath(row.hash), row.name)
        }
        catch (error) {
          if (!['needsOcr', 'remoteTooLarge', 'remotePageLimit'].includes(error.message)) throw error
          phase(row.hash, 'recognizing')
          const recognized = await recognize(row.hash)
          phase(row.hash, 'indexing')
          receipt = read(row.hash).pages > config.maxRemotePages
            ? await uploadParts(row, recognized) : await uploader.uploadFile(recognized, row.name)
        }
        db.prepare('UPDATE materials SET phase = ?, remote_id = ?, pages = ?, completed_pages = ?, error_code = ? WHERE hash = ?')
          .run(receipt.searchable ? 'ready' : 'failed', receipt.document_id, receipt.page_count,
            receipt.searchable ? receipt.page_count : Math.min(read(row.hash).completed_pages, receipt.page_count),
            receipt.searchable ? null : 'textUnavailable', row.hash)
        const removed = join(config.uploadReceiptsDirectory, 'removed')
        let deleted = false
        try { await readFile(join(removed, `${localId(row.hash)}.deleted`)); deleted = true }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        for (const id of partsOf(read(row.hash)).map(part => part.documentId).concat(receipt.document_id)) {
          if (deleted) {
            try { await writeFile(join(removed, `${id}.deleted`), '', { flag: 'wx' }) }
            catch (error) { if (error.code !== 'EEXIST') throw error }
          } else {
            try { await unlink(join(removed, `${id}.deleted`)) }
            catch (error) { if (error.code !== 'ENOENT') throw error }
          }
        }
      } catch (error) {
        phase(row.hash, closed ? 'queued' : 'failed', closed ? null : failures.has(error.message) ? error.message : 'processingFailed')
      } finally {
        if (read(row.hash).phase === 'ready') {
          const parts = partsOf(read(row.hash))
          for (const suffix of ['ocr.pdf', 'ocr-complete', ...(parts.length ? ['parts.json', ...parts.map((_part, index) => `part-${String(index + 1).padStart(5, '0')}.pdf`)] : [])]) {
            try { await unlink(join(root, `${row.hash}.${suffix}`)) }
            catch (error) { if (error.code !== 'ENOENT') console.warn('Unable to clean OCR output', error.code) }
          }
        }
      }
    }
  }
  const kick = () => {
    if (worker || closed) return
    worker = run().catch(() => {
      closed = true
      console.warn('Material queue stopped after a storage failure')
    }).finally(() => {
      worker = undefined
      if (!closed && db.prepare("SELECT 1 FROM materials WHERE phase = 'queued' LIMIT 1").get()) kick()
    })
  }
  const publicStatus = row => ({
    id: row.phase === 'ready' && row.parts_json === null ? row.remote_id : localId(row.hash), uploadId: localId(row.hash),
    searchable: row.phase === 'ready', stored: true, phase: row.phase,
    name: row.name, size: row.size, totalPages: row.pages, completedPages: row.completed_pages,
    errorCode: row.error_code, pollAfterMs: config.uploadPollMs,
  })
  kick()
  return {
    async save(stream, name) {
      const operation = (async () => {
        const temporary = join(root, `${randomUUID()}.tmp`)
        const handle = await open(temporary, 'wx', 0o600)
        const digest = createHash('sha256')
        let size = 0, prefix = Buffer.alloc(0)
        try {
          try {
            for await (const chunk of stream) {
              if (closed) throw new Error('processingFailed')
              size += chunk.length
              if (size > config.maxUploadBytes) throw new Error('tooLarge')
              if (prefix.length < 1024) prefix = Buffer.concat([prefix, chunk.subarray(0, 1024 - prefix.length)])
              digest.update(chunk)
              await handle.writeFile(chunk)
            }
          } finally { await handle.close() }
          if (!size) throw new Error('empty')
          if (!prefix.includes(Buffer.from('%PDF-'))) throw new Error('unsupported')
          const hash = digest.digest('hex')
          if (saving.has(hash)) return await saving.get(hash)
          const commit = Promise.resolve().then(async () => {
            if (closed) throw new Error('processingFailed')
            if (!read(hash)) {
              await rename(temporary, filePath(hash))
              db.prepare("INSERT INTO materials (hash, name, size, phase) VALUES (?, ?, ?, 'queued')").run(hash, name, size)
            } else if (read(hash).phase === 'failed') phase(hash, 'queued')
            const status = publicStatus(read(hash)); kick(); return status
          })
          saving.set(hash, commit)
          try { return await commit } finally { saving.delete(hash) }
        } finally {
          try { await unlink(temporary) }
          catch (error) { if (error.code !== 'ENOENT') throw error }
        }
      })()
      activeSaves.add(operation)
      try { return await operation } finally { activeSaves.delete(operation) }
    },
    get(id) { const hash = /^doc_local_([a-f0-9]{64})$/.exec(id)?.[1]; return hash ? read(hash) : undefined },
    status(id) { const row = this.get(id); return row ? publicStatus(row) : undefined },
    statuses() { return db.prepare('SELECT * FROM materials ORDER BY rowid DESC').all().map(publicStatus) },
    retry(id) {
      const row = this.get(id)
      if (!row || closed) return undefined
      if (row.phase === 'failed') phase(row.hash, 'queued')
      const status = publicStatus(read(row.hash)); kick(); return status
    },
    path(id) { const row = this.get(id); return row ? filePath(row.hash) : undefined },
    list() { return db.prepare('SELECT * FROM materials').all().map(row => ({ ...row, parts: partsOf(row), id: localId(row.hash) })) },
    async dispose() { closed = true; lifetime.abort(); uploader.dispose(); await Promise.allSettled(activeSaves); await worker; db.close() },
  }
}
