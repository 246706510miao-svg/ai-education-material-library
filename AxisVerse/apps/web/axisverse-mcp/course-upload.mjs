/** Persist confirmed remote PDF receipts without storing document bytes locally. */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Create an installation-scoped PDF uploader with durable, content-addressed receipts. */
export async function createCourseUploader(config, base, authorization) {
  await mkdir(config.uploadReceiptsDirectory, { recursive: true })
  const pending = new Map()
  const lifetime = new AbortController()
  const receiptPath = hash => join(config.uploadReceiptsDirectory, `${hash}.json`)
  const readReceipt = async hash => {
    try { return JSON.parse(await readFile(receiptPath(hash), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
  }
  const receipts = async () => {
    const names = await readdir(config.uploadReceiptsDirectory)
    return Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => readReceipt(name.slice(0, -5))))
  }
  const ingest = async (bytes, name, hash) => {
    const saved = await readReceipt(hash)
    if (saved) return saved
    const form = new FormData()
    for (const [key, value] of Object.entries({
      title: name, school: config.school, major: config.major,
      course: config.uploadCourse, unit: config.uploadUnit, material_type: 'reference',
      source_name: name, is_official_source: 'false', idempotency_key: `axisverse-${hash}-${createHash('sha256').update(JSON.stringify([config.school, config.major, config.uploadCourse, config.uploadUnit])).digest('hex').slice(0, 16)}`,
    })) form.set(key, value)
    form.set('file', bytes, name)
    // Finishing ingestion after the browser disconnects keeps a confirmed upload discoverable.
    const response = await fetch(new URL('/v1/materials/ingest', base), {
      method: 'POST', headers: { Authorization: authorization }, body: form,
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(config.uploadTimeoutMs)]), redirect: 'error',
    })
    if (response.status === 413) throw new Error('remoteTooLarge')
    if (response.status >= 500) throw new Error('remoteUnavailable')
    const result = await response.json()
    if (!response.ok) {
      await writeFile(join(config.uploadReceiptsDirectory, `${hash}.remote-error.json`), JSON.stringify({
        status: response.status, errorCode: typeof result.error_code === 'string' ? result.error_code : null,
        detail: result.detail ?? result.message ?? null,
      }) + '\n', { mode: 0o600 })
      throw new Error(result.error_code === 'PDF_TEXT_NOT_EXTRACTABLE' ? 'needsOcr'
        : result.error_code === 'TOO_MANY_PAGES' ? 'remotePageLimit' : 'remoteRejected')
    }
    if (!['success', 'duplicate', 'partial_success'].includes(result.status)
      || !/^doc_[a-zA-Z0-9_-]+$/.test(result.document_id)
      || typeof result.searchable !== 'boolean' || !Number.isInteger(result.page_count)) throw new Error('upload-failed')
    const receipt = { status: result.status, document_id: result.document_id, searchable: result.searchable,
      page_count: result.page_count, name, size: bytes.size, sha256: hash }
    const temporary = join(config.uploadReceiptsDirectory, `${hash}.${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(receipt) + '\n', { flag: 'wx' })
    await rename(temporary, receiptPath(hash))
    return receipt
  }
  return {
    receipts,
    dispose() { lifetime.abort() },
    async uploadFile(path, name) {
      const digest = createHash('sha256')
      for await (const chunk of createReadStream(path)) digest.update(chunk)
      const hash = digest.digest('hex')
      if (pending.has(hash)) return pending.get(hash)
      const operation = openAsBlob(path, { type: 'application/pdf' }).then(blob => ingest(blob, name, hash))
      pending.set(hash, operation)
      try { return await operation } finally { pending.delete(hash) }
    },
  }
}
