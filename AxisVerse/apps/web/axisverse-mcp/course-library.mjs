/** Authenticated upload and access to this installation's course PDFs. */
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { createCourseUploader } from './course-upload.mjs'
import { createCourseJobs } from './course-jobs.mjs'

export const name = 'axisverse-course-library'
export const inject = ['webServer', 'connection']

const documentId = /^doc_[a-zA-Z0-9_-]+$/

/** Register library routes; credentials and upload receipts remain on the host. */
export async function apply(ctx, config) {
  if (!config || typeof config.connectionFile !== 'string' || !Array.isArray(config.receiptFiles)
    || !config.receiptFiles.every(path => typeof path === 'string')
    || typeof config.pdfAssetsDirectory !== 'string'
    || !Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000
    || typeof config.uploadReceiptsDirectory !== 'string'
    || typeof config.uploadCourse !== 'string' || typeof config.uploadUnit !== 'string'
    || !Number.isInteger(config.maxUploadBytes) || config.maxUploadBytes < 1
    || !Number.isInteger(config.maxRemotePages) || config.maxRemotePages < 1
    || !Array.isArray(config.splitCommand) || !config.splitCommand.length || !config.splitCommand.every(value => typeof value === 'string' && value.length)
    || !Number.isInteger(config.uploadTimeoutMs) || config.uploadTimeoutMs < 1000
    || !Number.isInteger(config.ocrIdleTimeoutMs) || config.ocrIdleTimeoutMs < 1000
    || !Number.isInteger(config.uploadPollMs) || config.uploadPollMs < 1
    || !Array.isArray(config.ocrCommand) || !config.ocrCommand.length || !config.ocrCommand.every(value => typeof value === 'string' && value.length)
    || typeof config.school !== 'string' || typeof config.major !== 'string' || typeof config.course !== 'string') {
    throw new Error('Invalid course library configuration')
  }
  const settings = JSON.parse(await readFile(config.connectionFile, 'utf8'))
  const base = new URL(settings.url)
  if (base.protocol !== 'https:' || base.username || base.password
    || typeof settings.headers?.Authorization !== 'string') throw new Error('Invalid course library connection')
  const active = new Set()
  ctx.effect(() => () => { for (const controller of active) controller.abort() })
  const uploader = await createCourseUploader(config, base, settings.headers.Authorization)
  ctx.effect(() => () => uploader.dispose())
  const removedDirectory = join(config.uploadReceiptsDirectory, 'removed')
  await mkdir(removedDirectory, { recursive: true })
  const jobs = await createCourseJobs(config, uploader)
  ctx.effect(() => () => jobs.dispose())

  const approvedIds = async (includeRemoved = false) => {
    const ids = new Set()
    for (const file of config.receiptFiles) {
      const receipt = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''))
      if (receipt.status !== 'success' || !receipt.searchable || !documentId.test(receipt.document_id)) {
        throw new Error('Invalid course library upload receipt')
      }
      ids.add(receipt.document_id)
    }
    for (const receipt of await uploader.receipts()) {
      if (!documentId.test(receipt.document_id)) throw new Error('Invalid upload receipt')
      ids.add(receipt.document_id)
    }
    for (const row of jobs.list()) {
      ids.add(row.id)
      for (const part of row.parts) if (part.documentId !== null) ids.add(part.documentId)
    }
    if (!includeRemoved) {
      for (const file of await readdir(removedDirectory)) {
        if (/^doc_[a-zA-Z0-9_-]+\.deleted$/.test(file)) ids.delete(file.slice(0, -8))
      }
      for (const row of jobs.list()) if (!ids.has(row.id)) {
        if (row.remote_id) ids.delete(row.remote_id)
        for (const part of row.parts) ids.delete(part.documentId)
      }
    }
    return ids
  }
  // Validate deployment files before making the routes available.
  await approvedIds()
  await readFile(join(config.pdfAssetsDirectory, 'build/pdf.mjs'))

  const upstream = async (path, signal) => {
    const response = await fetch(new URL(path, base), {
      headers: { Authorization: settings.headers.Authorization }, signal, redirect: 'error',
    })
    if (!response.ok) throw new Error('Course library request failed')
    return response.json()
  }
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(JSON.stringify(data))
  }
  const handler = async (req, res) => {
    const rejected = ctx.connection.requestRejection(req)
    if (rejected !== undefined) { res.writeHead(rejected); res.end(); return }
    const uploadRequest = req.method === 'POST' && req.url?.split('?')[0] === '/api/axisverse/materials/upload'
    const removeRequest = req.method === 'DELETE' && /^\/api\/axisverse\/materials\/doc_[a-zA-Z0-9_-]+$/.test(req.url ?? '')
    const restoreRequest = req.method === 'POST' && /^\/api\/axisverse\/materials\/doc_[a-zA-Z0-9_-]+\/restore$/.test(req.url ?? '')
    const retryRequest = req.method === 'POST' && /^\/api\/axisverse\/materials\/uploads\/doc_local_[a-f0-9]{64}\/retry$/.test(req.url ?? '')
    if (req.method !== 'GET' && !uploadRequest && !removeRequest && !restoreRequest && !retryRequest) { res.writeHead(405, { Allow: 'GET' }); res.end(); return }
    const controller = new AbortController()
    active.add(controller)
    const closed = () => { if (!res.writableFinished) controller.abort() }
    res.on('close', closed)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(config.timeoutMs)])
    try {
      const url = new URL(req.url, 'http://localhost')
      const suffix = url.pathname.slice('/api/axisverse/materials'.length)
      if (removeRequest || restoreRequest) {
        const id = suffix.split('/')[1]
        if (!(await approvedIds(true)).has(id)) { json(res, 404, { code: 'not-found' }); return }
        const row = jobs.list().find(row => row.id === id)
        const ids = [id, ...(row?.parts.map(part => part.documentId).filter(Boolean) ?? []), ...(row?.remote_id ? [row.remote_id] : [])]
        for (const selected of ids) {
          const marker = join(removedDirectory, `${selected}.deleted`)
          if (removeRequest) {
            try { await writeFile(marker, '', { flag: 'wx' }) }
            catch (error) { if (error.code !== 'EEXIST') throw error }
          } else {
            try { await unlink(marker) }
            catch (error) { if (error.code !== 'ENOENT') throw error }
          }
        }
        json(res, 200, { id }); return
      }
      if (uploadRequest) {
        if (req.headers['content-type'] !== 'application/pdf' || typeof req.headers['x-material-name'] !== 'string') {
          json(res, 415, { code: 'unsupported' }); return
        }
        const filename = decodeURIComponent(req.headers['x-material-name'])
        if (!/\.pdf$/i.test(filename) || filename.length > 255 || /[\x00-\x1f/\\]/.test(filename)) {
          json(res, 415, { code: 'unsupported' }); return
        }
        if (Number(req.headers['content-length']) > config.maxUploadBytes) { json(res, 413, { code: 'tooLarge' }); return }
        let receipt
        try { receipt = await jobs.save(req, filename) }
        catch (error) {
          if (!['tooLarge', 'empty', 'unsupported'].includes(error.message)) throw error
          json(res, error.message === 'tooLarge' ? 413 : error.message === 'empty' ? 400 : 415, { code: error.message }); return
        }
        try { await unlink(join(removedDirectory, `${receipt.uploadId}.deleted`)) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        if (receipt.searchable) {
          const restored = jobs.list().find(row => row.id === receipt.uploadId)
          for (const id of [receipt.id, ...(restored?.parts.map(part => part.documentId) ?? [])]) {
            try { await unlink(join(removedDirectory, `${id}.deleted`)) }
            catch (error) { if (error.code !== 'ENOENT') throw error }
          }
        }
        if (!res.destroyed) json(res, 202, receipt)
        return
      }
      const allowed = await approvedIds()
      if (suffix === '/uploads') {
        json(res, 200, { items: jobs.statuses().filter(row => allowed.has(row.uploadId)) }); return
      }
      if (retryRequest) {
        const id = suffix.split('/')[2]
        if (!allowed.has(id)) { json(res, 404, { code: 'not-found' }); return }
        const status = jobs.retry(id)
        if (!status) { json(res, 404, { code: 'not-found' }); return }
        json(res, 202, status); return
      }
      const statusMatch = /^\/uploads\/(doc_local_[a-f0-9]{64})$/.exec(suffix)
      if (statusMatch) {
        const status = jobs.status(statusMatch[1])
        if (!status || !allowed.has(statusMatch[1])) { json(res, 404, { code: 'not-found' }); return }
        json(res, 200, status); return
      }
      const asset = /^\/assets\/(build\/(?:pdf|pdf.worker)\.mjs|(?:cmaps|standard_fonts|wasm)\/[a-zA-Z0-9_.-]+|LICENSE)$/.exec(suffix)
      if (asset) {
        const content = await readFile(join(config.pdfAssetsDirectory, asset[1]))
        res.writeHead(200, { 'Content-Type': asset[1].endsWith('.mjs') ? 'text/javascript' : asset[1].endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
        res.end(content)
        return
      }
      if (suffix === '/viewer.mjs' || suffix === '/viewer.css') {
        const content = await readFile(new URL(`./course${suffix.replace('/', '-')}`, import.meta.url))
        res.writeHead(200, { 'Content-Type': suffix.endsWith('.mjs') ? 'text/javascript' : 'text/css', 'Cache-Control': 'no-store' })
        res.end(content)
        return
      }
      if (suffix === '') {
        const items = []
        const savedJobs = jobs.list()
        const uploadNames = new Map((await uploader.receipts()).filter(receipt => typeof receipt.name === 'string').map(receipt => [receipt.document_id, receipt.name]))
        for (const row of savedJobs) {
          if (row.remote_id) uploadNames.set(row.remote_id, row.name)
          if ((row.phase !== 'ready' || row.parts.length) && allowed.has(row.id)) items.push({
            id: row.id, title: row.name, pages: row.pages,
            course: config.uploadCourse, unit: '', searchable: row.phase === 'ready', processing: !['failed', 'ready'].includes(row.phase),
            completedPages: row.completed_pages, errorCode: row.error_code,
            ...(row.phase === 'ready' && row.parts.length ? { sources: row.parts.map(part => ({ id: part.documentId, pageStart: part.pageStart, pageCount: part.pageCount })) } : {}),
          })
        }
        const cursors = new Set()
        let cursor
        do {
          const query = new URLSearchParams({ school: config.school, major: config.major, limit: '50' })
          if (cursor) query.set('cursor', cursor)
          const data = await upstream(`/v1/materials?${query}`, signal)
          if (data.status !== 'success' || !Array.isArray(data.items)) throw new Error('Invalid material list')
          for (const row of data.items) {
            if (!allowed.has(row.document_id) || row.school !== config.school || row.major !== config.major) continue
            if (savedJobs.some(job => job.remote_id === row.document_id && job.phase !== 'ready')) continue
            if (savedJobs.some(job => job.parts.some(part => part.documentId === row.document_id))) continue
            if (typeof row.title !== 'string' || !Number.isInteger(row.page_count) || row.page_count <= 0) throw new Error('Invalid material metadata')
            const title = uploadNames.get(row.document_id) ?? row.title.replace(/\s*（\d+页教材照片，文字识别版）$/, '')
            if (!items.some(item => item.id === row.document_id)) items.push({ id: row.document_id, title, pages: row.page_count, course: row.course, unit: typeof row.unit === 'string' && row.unit !== config.uploadUnit ? row.unit : '' })
          }
          cursor = data.next_cursor
          if (cursor != null && (typeof cursor !== 'string' || cursors.has(cursor))) throw new Error('Invalid library cursor')
          if (cursor) cursors.add(cursor)
        } while (cursor && items.length < allowed.size)
        json(res, 200, { items })
        return
      }
      const match = /^\/(doc_[a-zA-Z0-9_-]+)\/(file|view|outline)$/.exec(suffix)
      if (!match || !allowed.has(match[1])) { json(res, 404, { code: 'not-found' }); return }
      const original = jobs.list().find(row => row.id === match[1] || row.remote_id === match[1])
      const downloadName = original?.name
        ?? (await uploader.receipts()).find(receipt => receipt.document_id === match[1])?.name
      const disposition = `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="course-material.pdf"${typeof downloadName === 'string' ? `; filename*=UTF-8''${encodeURIComponent(downloadName).replace(/'/g, '%27')}` : ''}`
      if (original) {
        if (match[2] === 'outline' && original.phase !== 'ready') { json(res, 200, { items: [] }); return }
        if (match[2] === 'file') {
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store', 'Content-Length': original.size,
            'Content-Disposition': disposition })
          await pipeline(createReadStream(jobs.path(original.id)), res, { signal }); return
        }
      }
      if (match[2] === 'outline') {
        const chunks = []
        const sources = original?.parts.length ? original.parts : [{ documentId: match[1], pageStart: 1 }]
        for (const source of sources) {
        const cursors = new Set()
        let cursor
        do {
          const query = new URLSearchParams({ limit: '20' })
          if (cursor) query.set('cursor', cursor)
          const data = await upstream(`/v1/materials/${encodeURIComponent(source.documentId)}/content?${query}`, signal)
          if (data.status !== 'success' || data.document_id !== source.documentId || !Array.isArray(data.items)) throw new Error('Invalid document content')
          chunks.push(...data.items.map(chunk => ({ ...chunk, pageOffset: source.pageStart - 1 })))
          cursor = data.next_cursor
          if (cursor != null && (typeof cursor !== 'string' || cursors.has(cursor))) throw new Error('Invalid content cursor')
          if (cursor) cursors.add(cursor)
        } while (cursor)
        }
        json(res, 200, { items: extractCourseOutline(chunks) })
        return
      }
      if (match[2] === 'view') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'" })
        res.end(await readFile(new URL('./course-viewer.html', import.meta.url)))
        return
      }
      const data = await upstream(`/v1/materials/${encodeURIComponent(match[1])}/download`, signal)
      if (typeof data.download_url !== 'string') throw new Error('Invalid download response')
      const download = new URL(data.download_url, base)
      if (download.origin !== base.origin || !download.pathname.startsWith('/transfers/downloads/') || download.username || download.password) throw new Error('Invalid PDF download address')
      const headers = {}
      if (typeof req.headers.range === 'string' && /^bytes=\d*-\d*$/.test(req.headers.range)) headers.Range = req.headers.range
      const pdf = await fetch(download, { signal, headers, redirect: 'error' })
      if (!pdf.ok || !pdf.body) throw new Error('PDF download failed')
      res.statusCode = pdf.status
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      res.setHeader('Content-Disposition', disposition)
      for (const header of ['content-length', 'content-range', 'accept-ranges']) {
        const value = pdf.headers.get(header)
        if (value) res.setHeader(header, value)
      }
      await pipeline(Readable.fromWeb(pdf.body), res, { signal })
    } catch (error) {
      // Upstream failures may contain signed URLs; return only a stable public code.
      if (!res.headersSent && !res.destroyed) json(res, error.message === 'needsOcr' ? 422 : 502, { code: error.message === 'needsOcr' ? 'needsOcr' : 'unavailable' })
      else if (!res.destroyed) res.destroy()
    } finally {
      res.off('close', closed)
      active.delete(controller)
    }
  }
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/axisverse/materials', handler }))
}

/** Extract explicit original headings without guessing missing OCR text. */
export function extractCourseOutline(chunks) {
  const sections = new Map()
  for (const chunk of chunks) {
    if (typeof chunk.text !== 'string' || !Number.isInteger(chunk.page_start) || chunk.page_start < 1) throw new Error('Invalid content chunk')
    const offset = chunk.pageOffset ?? 0
    let page = chunk.page_start + offset
    for (const raw of chunk.text.split('\n')) {
      const pageMarker = /PDF\s+(\d+)\s*\//.exec(raw)
      if (pageMarker) page = Number(pageMarker[1]) + offset
      const line = raw.trim().replace(/^[*#]+\s*/, '').replace(/\s+/g, ' ')
        .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
        .replace(/(?<=\d)\s*[．.]\s*(?=\d)/g, '.')
        .replace(/\s+[《·|'」]*\s*\d{2,4}\s*[」》']*$/, '')
      const heading = /^(第\s*[一二三四五六七八九十百\d]+\s*[章节])\s*(.{2,60}?)\s*(?:[《·|]?\s*\d{2,4})?$/.exec(line)
        ?? /^(\d{1,2}(?:\.\d{1,2}){1,2})\s+([^=。；;]{2,60})$/.exec(line)
      if (!heading) continue
      if (!/^\p{Script=Han}/u.test(heading[2]) || !/\p{Script=Han}.*\p{Script=Han}/u.test(heading[2])
        || /[=×<>^。；;]/u.test(heading[2]) || /^(?:中(?:关于|已经|实际|的)|节中)/u.test(heading[2])) continue
      const title = `${heading[1].replace(/\s/g, '')} ${heading[2].trim()}`
      if (!sections.has(title)) sections.set(title, { title, page })
    }
  }
  return [...sections.values()]
}
