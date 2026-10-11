/** Topic hints and calendar groups for study records, derived without opening conversations. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { visibleSessionIds } from './tree.ts'

/** Localized topic suffix inferred from a conversation title, not a mastery assessment. */
export type StudyTopic = 'order' | 'polar' | 'spherical' | 'triple' | 'double' | 'integral' | 'series' | 'derivative' | 'limit' | 'general'
/** Recency groups use local calendar days. */
export type StudyGroup = 'review' | 'today' | 'week' | 'older'

const topicPatterns: readonly [StudyTopic, RegExp][] = [
  ['order', /换序|交换积分|积分次序|order.*integr|integr.*order/i],
  ['spherical', /球坐标|spherical/i],
  ['polar', /极坐标|polar/i],
  ['triple', /三重积分|triple integral/i],
  ['double', /二重积分|重积分|double integral/i],
  ['integral', /积分|integral|integration/i],
  ['series', /级数|series/i],
  ['derivative', /导数|微分|偏导|derivative|differential/i],
  ['limit', /极限|连续|limit|continuity/i],
]

/**
 * Infer a searchable topic from the title.
 * @param title - stored title.
 * @returns a locale suffix.
 */
export function studyTopic(title: string): StudyTopic {
  return topicPatterns.find(([, pattern]) => pattern.test(title))?.[0] ?? 'general'
}

/**
 * Derive non-blank records, omitting archived and delegated conversations.
 * @param list - live Session metadata.
 * @param archived - Host-owned archive membership.
 * @param reviewIds - browser-local review bookmarks.
 * @param now - current local clock, in milliseconds.
 * @returns records newest first with topic hints and non-overlapping groups.
 */
export function studyRecords(list: SessionListState, archived: readonly SessionId[], reviewIds: readonly SessionId[], now: number): Array<{
  id: SessionId
  title: string
  updatedAt: number
  review: boolean
  topic: StudyTopic
  group: StudyGroup
  selected: boolean
}> {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const week = new Date(today)
  week.setDate(week.getDate() - 6)
  const review = new Set(reviewIds)
  return visibleSessionIds(list, archived).flatMap((id) => {
    const session = list.byId[id]
    if (session === undefined || session.blank) return []
    const marked = review.has(id)
    const group: StudyGroup = marked ? 'review' : session.updatedAt >= today.getTime()
      ? 'today' : session.updatedAt >= week.getTime() ? 'week' : 'older'
    return [{ id, title: session.displayTitle, updatedAt: session.updatedAt, review: marked,
      topic: studyTopic(session.displayTitle), group, selected: (session.retainedBy.mainView ?? 0) > 0 }]
  }).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}
