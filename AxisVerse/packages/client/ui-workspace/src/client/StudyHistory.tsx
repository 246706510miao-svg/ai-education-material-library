/** Student history cards over live conversation metadata and local review bookmarks. */
import { useEffect, useState } from 'react'
import {
  Button, IconEditOutline16, IconSearchOutline16, IconTrashOutline16, Modal, relativeTime,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { StudyHistoryProps } from './contract/slots.ts'
import { studyRecords, type StudyGroup } from './study-history.ts'
import css from './StudyHistory.module.css'

const groups: readonly StudyGroup[] = ['review', 'today', 'week', 'older']

/**
 * Render searchable learning records without Workspace or runtime chrome.
 * @param props - framework hooks, local bookmarks and Host commands.
 * @returns the student history list and record management dialogs.
 */
export function StudyHistory({ useSessions, useWorkspaces, usePanelInfo, useStore, actions,
  open, expandSidebar, renameSession, archiveSession, unarchiveSession, t }: StudyHistoryProps) {
  const list = useSessions(state => state)
  const archived = useWorkspaces(state => state.archivedSessionIds)
  const panel = usePanelInfo(state => state.activePanelId)
  const reviewIds = useStore(state => state.reviewIds)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'review'>('all')
  const [now, setNow] = useState(Date.now)
  const [target, setTarget] = useState<{ id: SessionId; title: string; action: 'rename' | 'delete' } | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [removed, setRemoved] = useState<SessionId | null>(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [undoError, setUndoError] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 60_000)
    return () => { window.clearInterval(timer) }
  }, [])
  const records = studyRecords(list, archived, reviewIds, now)
  const normalized = query.trim().toLocaleLowerCase()
  const visible = records.filter(record => (filter === 'all' || record.review)
    && `${record.title} ${t(`study.topic.${record.topic}`)}`.toLocaleLowerCase().includes(normalized))
  const reviewCount = records.filter(record => record.review).length

  const closeDialog = () => { if (!busy) { setTarget(null); setError(false) } }
  const confirm = async () => {
    if (target === null || busy || (target.action === 'rename' && draft.trim() === '')) return
    setBusy(true)
    setError(false)
    try {
      if (target.action === 'rename') await renameSession(target.id, draft.trim())
      else {
        await archiveSession(target.id)
        setRemoved(target.id)
        setUndoError(false)
      }
      setTarget(null)
    } catch (_error: unknown) {
      // Host diagnostics are not student-facing copy; the dialog remains retryable.
      setError(true)
    } finally { setBusy(false) }
  }
  const undo = async () => {
    if (removed === null || undoBusy) return
    setUndoBusy(true)
    setUndoError(false)
    try {
      await unarchiveSession(removed)
      setRemoved(null)
    } catch (_error: unknown) {
      // Keep the removed record identity so the user can retry restoration.
      setUndoError(true)
    } finally { setUndoBusy(false) }
  }

  return <div className={css.root}>
    <div className={css.filters} role="group" aria-label={t('study.filters')}>
      <button type="button" aria-pressed={filter === 'all'} onClick={() => { setFilter('all') }}>
        {t('study.all')}<span>{records.length}</span>
      </button>
      <button type="button" aria-pressed={filter === 'review'} onClick={() => { setFilter('review') }}>
        {t('study.review')}<span>{reviewCount}</span>
      </button>
    </div>
    <label className={css.search}>
      <IconSearchOutline16 size={18} />
      <input type="search" aria-label={t('study.search')} placeholder={t('study.search')}
        value={query} onChange={(event) => { setQuery(event.target.value) }} />
    </label>
    {removed !== null && <div className={css.notice} role="status">
      <span>{t(undoError ? 'study.undoError' : 'study.removed')}</span>
      <button type="button" disabled={undoBusy} onClick={() => { void undo() }}>{t('study.undo')}</button>
    </div>}
    <div className={css.list}>
      {visible.length === 0 && <div className={css.empty} role="status">
        <strong>{t(list.phase !== 'ready' ? 'study.loading' : normalized !== '' ? 'study.noMatches'
          : filter === 'review' ? 'study.noReview' : 'study.empty')}</strong>
        {list.phase === 'ready' && <p>{t(normalized !== '' ? 'study.searchHint' : filter === 'review'
          ? 'study.reviewHint' : 'study.emptyHint')}</p>}
      </div>}
      {groups.map((group) => {
        const rows = visible.filter(record => record.group === group)
        if (rows.length === 0) return null
        return <section key={group} className={css.group} aria-label={t(`study.group.${group}`)}>
          <h3>{t(`study.group.${group}`)}<span>{rows.length}</span></h3>
          {rows.map((record) => {
            const relative = relativeTime(record.updatedAt, now)
            const time = relative.unit === 'now' ? t('time.now')
              : t('time.ago', { t: t(`time.${relative.unit}`, { n: relative.n }) })
            const date = new Date(record.updatedAt)
            const absoluteTime = `${t('date.ymd', { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() })} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
            return <article className={css.card} key={record.id} data-selected={record.selected && panel === null}>
              <button type="button" className={css.question} aria-current={record.selected && panel === null ? 'true' : undefined}
                onClick={() => { open(record.id); expandSidebar() }}>
                <strong>{record.title || t('study.untitled')}</strong>
                <span className={css.meta}><span>{t(`study.topic.${record.topic}`)}</span>
                  <time dateTime={date.toISOString()} title={absoluteTime}>{time}</time>
                </span>
              </button>
              <div className={css.actions}>
                <button type="button" className={css.review} aria-pressed={record.review}
                  aria-label={t(record.review ? 'study.unmarkNamed' : 'study.markNamed', { title: record.title })}
                  onClick={() => { actions.toggleReview(record.id) }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" fill={record.review ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                    <path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3.2 9.6l6-.9Z" />
                  </svg>
                  {t(record.review ? 'study.review' : 'study.mark')}
                </button>
                <div className={css.manage}>
                  <button type="button" aria-label={t('study.renameNamed', { title: record.title })} title={t('study.rename')}
                    onClick={() => { setTarget({ ...record, action: 'rename' }); setDraft(record.title); setError(false) }}><IconEditOutline16 /></button>
                  <button type="button" aria-label={t('study.deleteNamed', { title: record.title })} title={t('study.delete')}
                    onClick={() => { setTarget({ ...record, action: 'delete' }); setError(false) }}><IconTrashOutline16 /></button>
                </div>
              </div>
            </article>
          })}
        </section>
      })}
    </div>
    <Modal open={target !== null} onClose={closeDialog} closeLabel={t('close')}
      title={t(target?.action === 'delete' ? 'study.delete' : 'study.rename')}
      footer={<><Button variant="outline" disabled={busy} onClick={closeDialog}>{t('cancel')}</Button>
        <Button variant="primary" disabled={busy || (target?.action === 'rename' && draft.trim() === '')}
          onClick={() => { void confirm() }}>{t(busy ? 'study.saving' : target?.action === 'delete' ? 'study.delete' : 'study.save')}</Button></>}>
      {target?.action === 'rename' ? <input className={css.renameInput} aria-label={t('study.title')}
        value={draft} autoFocus disabled={busy} maxLength={200}
        onChange={(event) => { setDraft(event.target.value); setError(false) }}
        onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void confirm() } }} />
        : <p className={css.deleteText}>{t('study.deleteConfirm', { title: target?.title ?? '' })}</p>}
      {error && <p className={css.error} role="alert">{t('study.error')}</p>}
    </Modal>
  </div>
}
