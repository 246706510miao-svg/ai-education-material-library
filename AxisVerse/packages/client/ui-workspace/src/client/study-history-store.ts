/** Browser-local review bookmarks; question content remains owned by Sessions. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

type StudyHistoryState = { reviewIds: SessionId[] }
type StudyHistoryActions = { toggleReview: (draft: StudyHistoryState, id: SessionId) => void }

/**
 * Create persisted review bookmarks for this browser origin.
 * @returns an entry-owned store handle.
 */
export function createStudyHistoryStore(): EngineStoreHandle<StudyHistoryState, StudyHistoryActions> {
  return defineStore({
    init: (): StudyHistoryState => ({ reviewIds: [] }),
    persist: 'axisverse.study-history.v1',
    actions: {
      toggleReview: (draft, id) => {
        draft.reviewIds = draft.reviewIds.includes(id)
          ? draft.reviewIds.filter(value => value !== id)
          : [...draft.reviewIds, id]
      },
    },
  })
}
