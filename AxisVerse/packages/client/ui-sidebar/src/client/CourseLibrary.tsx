/** Course PDFs available for viewing and downloading from the remote library. */
import { useEffect, useRef, useState, type ReactElement } from 'react'
import clsx from 'clsx'
import { Modal, ReferenceIcon, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import type { CourseMaterial } from './course-materials.ts'
import css from './CourseLibrary.module.css'

type Props = Pick<SidebarRootComponentProps, 't' | 'loadCourseMaterials' | 'loadCourseOutline' | 'openCourseQuestion' | 'deleteCourseMaterial' | 'restoreCourseMaterial'> & { onOpen: () => void }

/**
 * Show a refreshable library and in-page PDF reader links; closing cancels pending reads.
 * @param props - Localized copy, host-backed loading, and sibling-panel dismissal.
 * @returns the navigation button and the course-material dialog.
 */
export function CourseLibrary({
  t, loadCourseMaterials, loadCourseOutline, openCourseQuestion, deleteCourseMaterial, restoreCourseMaterial, onOpen,
}: Props): ReactElement {
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ status: 'loading' | 'error' } | { status: 'ready'; items: readonly CourseMaterial[] }>({ status: 'loading' })
  const body = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [summary, setSummary] = useState<CourseMaterial | null>(null)
  const [removing, setRemoving] = useState<CourseMaterial | null>(null)
  const [deleted, setDeleted] = useState<CourseMaterial | null>(null)
  const [outline, setOutline] = useState<readonly { title: string; page: number }[] | null>(null)
  const [selected, setSelected] = useState<readonly string[]>([])
  const [actionError, setActionError] = useState(false)
  const [opening, setOpening] = useState(false)
  const actionEpoch = useRef(0)
  const close = (): void => {
    actionEpoch.current++; setOpen(false); setSummary(null); setRemoving(null)
    setDeleted(null); setActionError(false); setOpening(false)
  }
  const changeRemoval = async (item: CourseMaterial, restore: boolean): Promise<void> => {
    const action = restore ? restoreCourseMaterial : deleteCourseMaterial
    if (!action) return
    const epoch = ++actionEpoch.current
    setOpening(true); setActionError(false)
    try {
      await action(item.id)
      if (epoch !== actionEpoch.current) return
      setRemoving(null); setDeleted(restore ? null : item)
      setRevision(value => value + 1)
    } catch (_error) { if (epoch === actionEpoch.current) setActionError(true) }
    finally { if (epoch === actionEpoch.current) setOpening(false) }
  }
  const ask = async (item: CourseMaterial, headings?: readonly string[]): Promise<void> => {
    if (!openCourseQuestion) return
    const epoch = ++actionEpoch.current
    setOpening(true); setActionError(false)
    try { await openCourseQuestion(item, headings); if (epoch === actionEpoch.current) close() }
    catch (_error) { if (epoch === actionEpoch.current) setActionError(true) }
    finally { if (epoch === actionEpoch.current) setOpening(false) }
  }
  useEffect(() => {
    if (!open || summary === null) return
    const controller = new AbortController()
    setOutline(null); setSelected([]); setActionError(false)
    if (!loadCourseOutline) setActionError(true)
    else void loadCourseOutline(summary.id, controller.signal).then((items) => {
      if (controller.signal.aborted) return
      setOutline(items); setSelected(items.map(item => item.title))
    }).catch(() => { if (!controller.signal.aborted) setActionError(true) })
    return () => { controller.abort() }
  }, [open, summary, loadCourseOutline, revision])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setState({ status: 'loading' })
    if (loadCourseMaterials === undefined) setState({ status: 'error' })
    else void loadCourseMaterials(controller.signal).then((items) => {
      if (!controller.signal.aborted) setState({ status: 'ready', items })
    }).catch(() => { if (!controller.signal.aborted) setState({ status: 'error' }) })
    return () => { controller.abort() }
  }, [open, revision, loadCourseMaterials])
  useEffect(() => {
    if (!open) return
    const dialog = body.current?.closest<HTMLElement>('[role="dialog"]')
    dialog?.querySelector<HTMLButtonElement>('button')?.focus()
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const controls = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled)') ?? [])]
      const first = controls[0]; const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    dialog?.addEventListener('keydown', trap)
    return () => { dialog?.removeEventListener('keydown', trap); trigger.current?.focus() }
  }, [open])
  return <>
    <button type="button" ref={trigger} className={css.trigger} onClick={() => { onOpen(); setOpen(true) }}>
      <ReferenceIcon kind="file" size={18} /><span>{t('library.title')}</span>
    </button>
    <Modal open={open} onClose={close} title={t(removing ? 'library.confirmDelete' : summary ? 'library.summary' : 'library.title')} closeLabel={t('library.close')} className={clsx(css.dialog)}>
      <div ref={body} className={css.body}>
        {actionError && <p role="alert">{t('library.actionError')} <button type="button" onClick={() => { setRevision(value => value + 1) }}>{t('library.retry')}</button></p>}
        {removing !== null ? <div className={css.summary}>
          <h3>{removing.title}</h3><p>{t('library.deleteHelp')}</p>
          <div className={css.actions}>
            <button type="button" disabled={opening} onClick={() => { setRemoving(null); setActionError(false) }}>{t('library.cancel')}</button>
            <button type="button" disabled={opening} onClick={() => { void changeRemoval(removing, false) }}>{t('library.confirmDelete')}</button>
          </div>
        </div> : summary !== null ? <div className={css.summary}>
          <button type="button" className={css.back} disabled={opening} onClick={() => { setSummary(null); setActionError(false) }}>{t('library.back')}</button>
          <h3>{summary.title}</h3><p>{t('library.summaryHelp')}</p>
          {outline === null && !actionError && <p role="status">{t('library.outlineLoading')}</p>}
          {outline?.length === 0 && <p>{t('library.outlineEmpty')}</p>}
          {outline !== null && outline.length > 0 && <div className={css.selectionActions}>
            <button type="button" disabled={opening || selected.length === outline.length} onClick={() => { setSelected(outline.map(item => item.title)) }}>{t('library.selectAll')}</button>
            <button type="button" disabled={opening || selected.length === 0} onClick={() => { setSelected([]) }}>{t('library.clearAll')}</button>
          </div>}
          {outline?.map(item => <label className={css.section} key={item.title}>
            <input type="checkbox" disabled={opening} checked={selected.includes(item.title)} onChange={(event) => { setSelected(current => event.target.checked ? [...current, item.title] : current.filter(title => title !== item.title)) }} />
            <span>{item.title}</span><small>{t('library.pdfPage', { page: item.page })}</small>
          </label>)}
          <div className={css.actions}><button type="button" disabled={opening || selected.length === 0 || actionError} onClick={() => { void ask(summary, outline?.filter(item => selected.includes(item.title)).map(item => item.title)) }}>{t(opening ? 'library.opening' : 'library.generate')}</button></div>
        </div> : <>
          <div className={css.heading}><p>{t('library.description')}</p><button type="button" disabled={state.status === 'loading'} onClick={() => { setRevision(value => value + 1) }}>{t('library.refresh')}</button></div>
          {deleted !== null && <div className={css.removed} role="status"><span>{t('library.deleted')}</span><button type="button" disabled={opening || !restoreCourseMaterial} onClick={() => { void changeRemoval(deleted, true) }}>{t('library.undo')}</button></div>}
          {state.status === 'loading' && <p role="status" className={css.message}>{t('library.loading')}</p>}
          {state.status === 'error' && <div role="alert" className={css.message}><p>{t('library.error')}</p><button type="button" onClick={() => { setRevision(value => value + 1) }}>{t('library.retry')}</button></div>}
          {state.status === 'ready' && state.items.length === 0 && <p className={css.message}>{t('library.empty')}</p>}
          {state.status === 'ready' && state.items.map((item) => {
            const path = `/api/axisverse/materials/${encodeURIComponent(item.id)}/file`
            return <article className={css.card} key={item.id}>
              <div className={css.icon}><ReferenceIcon kind="file" size={24} /></div>
              <div className={css.content}><h3>{item.title}</h3><p>{item.course}{item.pages > 0 && <> · {item.pages} {t('library.pages')}</>}</p>{item.unit && <p>{item.unit}</p>}
                {item.searchable === false && <p className={item.processing ? css.processing : undefined}>{t(item.processing ? 'library.processing' : 'library.storedOnly')}
                  {item.processing && item.pages > 0 && typeof item.completedPages === 'number' && <> · {t('library.pageProgress', { completed: item.completedPages, total: item.pages })}</>}
                </p>}
                <div className={css.actions}>
                  <button type="button" className={css.primary} disabled={opening || !openCourseQuestion || item.searchable === false} onClick={() => { void ask(item) }}>{t('library.ask')}</button>
                  <button type="button" disabled={opening || !openCourseQuestion || item.searchable === false} onClick={() => { setSummary(item) }}>{t('library.summary')}</button>
                  <a href={`${path}?download=1`} download><IconDownloadOutline16 />{t('library.download')}</a>
                  <button type="button" disabled={opening || !deleteCourseMaterial} onClick={() => { setRemoving(item); setActionError(false) }}>{t('library.delete')}</button>
                </div>
              </div>
            </article>
          })}
        </>}
      </div>
    </Modal>
  </>
}
