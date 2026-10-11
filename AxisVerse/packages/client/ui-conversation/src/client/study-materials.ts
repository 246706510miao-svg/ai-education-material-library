/** Authenticated PDF uploads with a separate test-only demonstration adapter. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

/** Identifier assigned by the material provider. */
export type StudyMaterialId = Branded<'StudyMaterialId'>

/** Lifecycle updates shared by mock and live HTTP adapters. */
export type StudyMaterialProgress =
  | { status: 'uploading'; progress: number }
  | { status: 'processing' | 'recognizing' | 'indexing' | 'checking'; progress: number; stored?: boolean; totalPages?: number; completedPages?: number }

/** Safe student-facing failure categories; subprocess output stays on the host. */
export type StudyMaterialFailure = 'processingFailed' | 'recognitionFailed' | 'recognitionTimeout' | 'ocrUnavailable'
  | 'remoteUnavailable' | 'remoteRejected' | 'remoteTooLarge' | 'textUnavailable'

/** Completed receipt with an explicit demo or real-service origin. */
export interface StudyMaterialReceipt {
  mode: 'mock' | 'live'
  id: StudyMaterialId
  name: string
  size: number
  /** False when the file is saved but its text could not be indexed. */
  searchable?: boolean
  /** Stable original-file identity used to resume monitoring without re-uploading. */
  uploadId?: StudyMaterialId
  /** Present only after processing has actually stopped with a failure. */
  errorCode?: StudyMaterialFailure
  /** Host-selected status polling interval retained for monitoring recovery. */
  pollAfterMs?: number
}

/** Server-confirmed processing snapshot restored when the composer remounts. */
export interface StudyMaterialUpload extends StudyMaterialReceipt {
  uploadId: StudyMaterialId
  phase: 'queued' | 'recognizing' | 'indexing' | 'ready' | 'failed'
  totalPages: number
  completedPages: number
  pollAfterMs: number
}

const failureCodes: readonly StudyMaterialFailure[] = ['processingFailed', 'recognitionFailed', 'recognitionTimeout',
  'ocrUnavailable', 'remoteUnavailable', 'remoteRejected', 'remoteTooLarge', 'textUnavailable']

function statusValue(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || !('id' in data) || typeof data.id !== 'string'
    || !/^doc_[a-zA-Z0-9_-]+$/.test(data.id) || !('searchable' in data) || typeof data.searchable !== 'boolean'
    || !('phase' in data) || typeof data.phase !== 'string'
    || !['queued', 'recognizing', 'indexing', 'ready', 'failed'].includes(data.phase)
    || data.searchable !== (data.phase === 'ready')) throw new Error('failed')
  if ('totalPages' in data && (typeof data.totalPages !== 'number' || !Number.isInteger(data.totalPages) || data.totalPages < 0)) throw new Error('failed')
  if ('completedPages' in data && (typeof data.completedPages !== 'number' || !Number.isInteger(data.completedPages)
    || data.completedPages < 0 || !('totalPages' in data) || typeof data.totalPages !== 'number' || data.completedPages > data.totalPages)) throw new Error('failed')
  return data
}

async function monitorUpload(initial: unknown, material: StudyMaterialReceipt, uploadId: StudyMaterialId,
  signal: AbortSignal, progress: (value: StudyMaterialProgress) => void, checking = false): Promise<StudyMaterialReceipt> {
  let current = initial
  while (true) {
    signal.throwIfAborted()
    const data = statusValue(current)
    if (data.phase === 'ready' || data.phase === 'failed') {
      return { ...material, id: data.id as StudyMaterialId, uploadId, searchable: data.searchable as boolean,
        ...(typeof data.pollAfterMs === 'number' ? { pollAfterMs: data.pollAfterMs } : {}),
        ...(data.phase === 'failed' ? { errorCode: failureCodes.includes(data.errorCode as StudyMaterialFailure)
          ? data.errorCode as StudyMaterialFailure : 'processingFailed' } : {}) }
    }
    if (typeof data.pollAfterMs !== 'number' || !Number.isInteger(data.pollAfterMs) || data.pollAfterMs < 1) throw new Error('failed')
    if (!checking) progress({ status: data.phase === 'queued' ? 'processing' : data.phase as 'recognizing' | 'indexing', progress: 100, stored: true,
      ...(typeof data.totalPages === 'number' ? { totalPages: data.totalPages, completedPages: data.completedPages as number } : {}) })
    while (true) {
      await pause(data.pollAfterMs, signal)
      let response: Response
      try { response = await fetch(`/api/axisverse/materials/uploads/${encodeURIComponent(uploadId)}`, { credentials: 'same-origin', signal }) }
      catch (_error: unknown) {
        signal.throwIfAborted()
        progress({ status: 'checking', progress: 100, stored: true }); continue
      }
      if (response.status >= 500) { progress({ status: 'checking', progress: 100, stored: true }); continue }
      if (!response.ok) throw new Error('failed')
      current = await response.json(); checking = false; break
    }
  }
}

/**
 * Upload PDFs through the authenticated host; only confirmed storage returns a receipt.
 * @returns upload callbacks reporting real transfer progress and server-confirmed indexing.
 */
export function createLiveStudyMaterialOperations(): Pick<StudyMaterialOperations, 'studyMaterialMode' | 'uploadStudyMaterial' | 'listStudyMaterialUploads' | 'resumeStudyMaterialUpload'> {
  return {
    studyMaterialMode: 'live',
    async listStudyMaterialUploads(signal) {
      const response = await fetch('/api/axisverse/materials/uploads', { credentials: 'same-origin', signal })
      if (!response.ok) throw new Error('failed')
      const value: unknown = await response.json()
      if (typeof value !== 'object' || value === null || !('items' in value) || !Array.isArray(value.items)) throw new Error('failed')
      return value.items.map((item: unknown): StudyMaterialUpload => {
        const data = statusValue(item)
        if (typeof data.name !== 'string' || typeof data.size !== 'number' || !Number.isSafeInteger(data.size) || data.size < 1
          || typeof data.uploadId !== 'string' || !/^doc_local_[a-f0-9]{64}$/.test(data.uploadId)
          || typeof data.totalPages !== 'number' || typeof data.completedPages !== 'number'
          || typeof data.pollAfterMs !== 'number' || !Number.isInteger(data.pollAfterMs) || data.pollAfterMs < 1) throw new Error('failed')
        return { mode: 'live', id: data.id as StudyMaterialId, uploadId: data.uploadId as StudyMaterialId,
          name: data.name, size: data.size, searchable: data.searchable as boolean, phase: data.phase as StudyMaterialUpload['phase'],
          totalPages: data.totalPages, completedPages: data.completedPages, pollAfterMs: data.pollAfterMs,
          ...(data.phase === 'failed' ? { errorCode: failureCodes.includes(data.errorCode as StudyMaterialFailure)
            ? data.errorCode as StudyMaterialFailure : 'processingFailed' } : {}) }
      })
    },
    async resumeStudyMaterialUpload(material, signal, progress, retry) {
      let response: Response
      try {
        response = await fetch(`/api/axisverse/materials/uploads/${encodeURIComponent(material.uploadId)}${retry ? '/retry' : ''}`,
          { credentials: 'same-origin', signal, ...(retry ? { method: 'POST' } : {}) })
      } catch (_error: unknown) {
        signal.throwIfAborted()
        if (!material.pollAfterMs) throw new Error('failed')
        progress({ status: 'checking', progress: 100, stored: true })
        return monitorUpload({ id: material.uploadId, searchable: false, phase: 'queued', pollAfterMs: material.pollAfterMs },
          material, material.uploadId, signal, progress, true)
      }
      if (response.status >= 500 && material.pollAfterMs) {
        progress({ status: 'checking', progress: 100, stored: true })
        return monitorUpload({ id: material.uploadId, searchable: false, phase: 'queued', pollAfterMs: material.pollAfterMs },
          material, material.uploadId, signal, progress, true)
      }
      if (!response.ok) throw new Error('failed')
      return monitorUpload(await response.json(), material, material.uploadId, signal, progress)
    },
    async uploadStudyMaterial(file, signal, progress) {
      signal.throwIfAborted()
      if (!/\.pdf$/i.test(file.name)) throw new Error('unsupported')
      if (!file.size) throw new Error('empty')
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        const abort = (): void => { xhr.abort() }
        const finish = (): void => { signal.removeEventListener('abort', abort) }
        xhr.open('POST', '/api/axisverse/materials/upload')
        xhr.setRequestHeader('Content-Type', 'application/pdf')
        xhr.setRequestHeader('X-Material-Name', encodeURIComponent(file.name))
        xhr.upload.onprogress = (event): void => {
          if (event.lengthComputable) progress({ status: 'uploading', progress: Math.round(event.loaded / event.total * 100) })
        }
        xhr.upload.onload = (): void => { progress({ status: 'processing', progress: 100 }) }
        xhr.onerror = (): void => { finish(); reject(new Error('failed')) }
        xhr.onabort = (): void => { finish(); reject(new DOMException('Upload cancelled', 'AbortError')) }
        const complete = async (data: unknown, status: number): Promise<StudyMaterialReceipt> => {
          if (typeof data !== 'object' || data === null) throw new Error('failed')
          if (status !== 200 && status !== 202) {
            const code = 'code' in data ? data.code : null
            throw new Error(code === 'tooLarge' || code === 'unsupported' || code === 'empty' || code === 'needsOcr' ? code : 'failed')
          }
          if (!('id' in data) || typeof data.id !== 'string' || !/^doc_[a-zA-Z0-9_-]+$/.test(data.id)
            || !('searchable' in data) || typeof data.searchable !== 'boolean') throw new Error('failed')
          if (status === 200) return { mode: 'live', id: data.id as StudyMaterialId, name: file.name, size: file.size, searchable: data.searchable }
          if (!('stored' in data) || data.stored !== true || !('uploadId' in data) || typeof data.uploadId !== 'string'
            || !/^doc_local_[a-f0-9]{64}$/.test(data.uploadId)) throw new Error('failed')
          return monitorUpload(data, { mode: 'live', id: data.id as StudyMaterialId, name: file.name, size: file.size },
            data.uploadId as StudyMaterialId, signal, progress)
        }
        xhr.onload = (): void => {
          finish()
          try {
            const data: unknown = JSON.parse(xhr.responseText)
            void complete(data, xhr.status).then(resolve, reject)
          } catch (error: unknown) { reject(error instanceof Error ? error : new Error('failed')) }
        }
        signal.addEventListener('abort', abort, { once: true })
        progress({ status: 'uploading', progress: 0 })
        xhr.send(file)
      })
    },
  }
}

/** Simulated questions are separate from answers supported by retrieved passages. */
export type StudyMaterialAnswer =
  | { mode: 'mock'; question: string; materialName: string }
  | { mode: 'live'; text: string; citations: readonly { materialId: StudyMaterialId; name: string; page: number }[] }

/** Operations injected into the composer; real adapters must honor cancellation. */
export interface StudyMaterialOperations {
  studyMaterialMode: 'mock' | 'live'
  uploadStudyMaterial: (file: File, signal: AbortSignal, progress: (value: StudyMaterialProgress) => void) => Promise<StudyMaterialReceipt>
  /** Restore actual host processing snapshots after refresh. */
  listStudyMaterialUploads?: (signal: AbortSignal) => Promise<readonly StudyMaterialUpload[]>
  /** Monitor or retry a saved PDF without transmitting its bytes again. */
  resumeStudyMaterialUpload?: (material: StudyMaterialReceipt & { uploadId: StudyMaterialId }, signal: AbortSignal,
    progress: (value: StudyMaterialProgress) => void, retry: boolean) => Promise<StudyMaterialReceipt>
  askStudyMaterial: (material: StudyMaterialReceipt, question: string, signal: AbortSignal) => Promise<StudyMaterialAnswer>
}

function pause(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      reject(new DOMException('Operation cancelled', 'AbortError'))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, delay)
    signal.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Create mock upload and question operations without storage, parsing, or model calls.
 * @param stepDelayMs - configurable demo-stage duration in milliseconds.
 * @returns callbacks usable by the upload interface and adapter tests.
 */
export function createMockStudyMaterialOperations(stepDelayMs: number): StudyMaterialOperations {
  return {
    studyMaterialMode: 'mock',
    async uploadStudyMaterial(file, signal, progress) {
      signal.throwIfAborted()
      if (!/\.(pdf|docx|pptx|txt|md)$/i.test(file.name)) throw new Error('unsupported')
      if (file.size === 0) throw new Error('empty')
      for (const percent of [0, 30, 65, 100]) {
        progress({ status: 'uploading', progress: percent })
        await pause(stepDelayMs, signal)
      }
      progress({ status: 'processing', progress: 100 })
      await pause(stepDelayMs * 2, signal)
      return { mode: 'mock', id: randomUUID() as StudyMaterialId, name: file.name, size: file.size }
    },
    async askStudyMaterial(material, question, signal) {
      await pause(stepDelayMs * 3, signal)
      return { mode: 'mock', materialName: material.name, question }
    },
  }
}
