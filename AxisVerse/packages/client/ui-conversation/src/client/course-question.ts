/** Session-scoped course selection; submitted instructions remain in ordinary message history. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Uploaded document selected for the current conversation. */
export interface CourseQuestionMaterial {
  id: Branded<'CourseMaterialId'>
  title: string
  /** Ordered remote documents and their original PDF page ranges. */
  sources?: readonly { id: Branded<'CourseMaterialId'>; pageStart: number; pageCount: number }[]
}

/** Browser-tab selection stores, isolated by conversation identity. */
export class CourseQuestionSelection {
  private readonly stores = new Map<SessionId, SnapshotStore<CourseQuestionMaterial | null>>()

  /** Restore the selected document for a conversation.
   * @param id - Conversation identity.
   * @returns stable observable selection.
   */
  for(id: SessionId): SnapshotStore<CourseQuestionMaterial | null> {
    const existing = this.stores.get(id)
    if (existing) return existing
    let material: CourseQuestionMaterial | null = null
    try {
      const raw: unknown = JSON.parse(sessionStorage.getItem(`axisverse.course.${id}`) ?? 'null')
      if (raw !== null && typeof raw === 'object' && 'id' in raw && 'title' in raw
        && typeof raw.id === 'string' && /^doc_[a-zA-Z0-9_-]+$/.test(raw.id)
        && typeof raw.title === 'string') {
        let next = 1
        const sources = 'sources' in raw ? raw.sources : undefined
        if (sources === undefined || (Array.isArray(sources) && sources.length >= 2 && sources.every((source: unknown) => {
          if (source === null || typeof source !== 'object' || !('id' in source) || typeof source.id !== 'string'
            || !/^doc_[a-zA-Z0-9_-]+$/.test(source.id) || !('pageStart' in source) || source.pageStart !== next
            || !('pageCount' in source) || typeof source.pageCount !== 'number' || !Number.isSafeInteger(source.pageCount) || source.pageCount < 1) return false
          next += source.pageCount
          return true
        }))) material = raw as CourseQuestionMaterial
      }
    } catch (_error) { /* Unavailable storage or invalid saved selections start in ordinary mode. */ }
    const store = createSnapshotStore(material)
    this.stores.set(id, store)
    return store
  }

  /** Publish and retain a conversation's selected document.
   * @param id - Conversation identity.
   * @param material - Selected document, or null for ordinary questions.
   */
  set(id: SessionId, material: CourseQuestionMaterial | null): void {
    this.for(id).set(material)
    try {
      if (material === null) sessionStorage.removeItem(`axisverse.course.${id}`)
      else sessionStorage.setItem(`axisverse.course.${id}`, JSON.stringify(material))
    } catch (_error) { /* The live selection still works when browser storage is unavailable. */ }
  }
}
