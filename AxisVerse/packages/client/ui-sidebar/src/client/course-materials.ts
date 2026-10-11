/** Browser projection of the authenticated course library. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Remote course-document identity, validated when reading host responses. */
export type CourseMaterialId = Branded<'CourseMaterialId'>

/** Display metadata for an uploaded course PDF. */
export interface CourseMaterial {
  /** Opaque remote document identifier used only in same-origin file links. */
  id: CourseMaterialId
  /** Uploaded document title. */
  title: string
  /** PDF page count. */
  pages: number
  /** Course label. */
  course: string
  /** Uploaded chapter or coverage label. */
  unit: string
  /** False until the saved document has searchable text. */
  searchable?: boolean
  /** True while saved document text is being processed. */
  processing?: boolean
  /** Pages whose text has been recognized and checkpointed on the host. */
  completedPages?: number
  /** Ordered remote documents and their original PDF page ranges. */
  sources?: readonly { id: CourseMaterialId; pageStart: number; pageCount: number }[]
}

/**
 * Fetch uploaded materials without exposing the remote credentials to the browser.
 * @param signal - Cancels a closed or superseded panel request.
 * @returns validated display metadata for uploaded documents.
 */
export async function loadCourseMaterials(signal: AbortSignal): Promise<readonly CourseMaterial[]> {
  const response = await fetch('/api/axisverse/materials', { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error('unavailable')
  const data: unknown = await response.json()
  if (typeof data !== 'object' || data === null || !('items' in data) || !Array.isArray(data.items)) throw new Error('invalid-response')
  return data.items.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || !('id' in item) || typeof item.id !== 'string' || !/^doc_[a-zA-Z0-9_-]+$/.test(item.id)
      || !('title' in item) || typeof item.title !== 'string' || !('pages' in item) || typeof item.pages !== 'number' || !Number.isInteger(item.pages) || item.pages < 0
      || !('course' in item) || typeof item.course !== 'string' || !('unit' in item) || typeof item.unit !== 'string') throw new Error('invalid-response')
    if (('searchable' in item && typeof item.searchable !== 'boolean')
      || ('processing' in item && typeof item.processing !== 'boolean')
      || ('completedPages' in item && (typeof item.completedPages !== 'number' || !Number.isInteger(item.completedPages)
        || item.completedPages < 0 || item.completedPages > item.pages))) throw new Error('invalid-response')
    let sources: CourseMaterial['sources']
    if ('sources' in item) {
      let next = 1
      if (!Array.isArray(item.sources) || item.sources.length < 2) throw new Error('invalid-response')
      sources = item.sources.map((source: unknown) => {
        if (source === null || typeof source !== 'object' || !('id' in source) || typeof source.id !== 'string'
          || !/^doc_[a-zA-Z0-9_-]+$/.test(source.id) || !('pageStart' in source) || source.pageStart !== next
          || !('pageCount' in source) || typeof source.pageCount !== 'number' || !Number.isSafeInteger(source.pageCount) || source.pageCount < 1) throw new Error('invalid-response')
        const pageStart = next
        next += source.pageCount
        return { id: source.id as CourseMaterialId, pageStart, pageCount: source.pageCount }
      })
      if (next !== item.pages + 1) throw new Error('invalid-response')
    }
    return { id: item.id as CourseMaterialId, title: item.title, pages: item.pages, course: item.course, unit: item.unit,
      ...(sources === undefined ? {} : { sources }),
      ...('searchable' in item ? { searchable: item.searchable as boolean } : {}),
      ...('processing' in item ? { processing: item.processing as boolean } : {}),
      ...('completedPages' in item ? { completedPages: item.completedPages as number } : {}) }
  })
}
/**
 * Remove a document from this installation's library without erasing its remote PDF.
 * @param id - Uploaded document identity.
 * @returns completion after the host stores the removal marker.
 */
export async function deleteCourseMaterial(id: CourseMaterialId): Promise<void> {
  const response = await fetch(`/api/axisverse/materials/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin' })
  if (!response.ok) throw new Error('unavailable')
}

/**
 * Restore a document removed from this installation's library.
 * @param id - Previously uploaded document identity.
 * @returns completion after the host clears the removal marker.
 */
export async function restoreCourseMaterial(id: CourseMaterialId): Promise<void> {
  const response = await fetch(`/api/axisverse/materials/${encodeURIComponent(id)}/restore`, { method: 'POST', credentials: 'same-origin' })
  if (!response.ok) throw new Error('unavailable')
}

/** Read the authorized document's extracted section titles.
 * @param id - Uploaded document identity.
 * @param signal - Dialog cancellation.
 * @returns ordered titles and PDF page numbers.
 */
export async function loadCourseOutline(id: CourseMaterialId, signal: AbortSignal): Promise<readonly { title: string; page: number }[]> {
  const response = await fetch(`/api/axisverse/materials/${encodeURIComponent(id)}/outline`, { signal, credentials: 'same-origin' })
  if (!response.ok) throw new Error('unavailable')
  const value: unknown = await response.json()
  if (value === null || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items)) throw new Error('invalid-response')
  return value.items.map((item: unknown) => {
    if (item === null || typeof item !== 'object' || !('title' in item) || typeof item.title !== 'string'
      || !('page' in item) || typeof item.page !== 'number' || !Number.isInteger(item.page) || item.page < 1) throw new Error('invalid-response')
    return { title: item.title, page: item.page }
  })
}
