/** Student attachment menu and material uploads. */
import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { FileTypeIcon, IconPaperclipOutline16, Menu, Modal, ReferenceIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import type { ComposerBarProps } from '../contract/slots.ts'
import type { StudyMaterialProgress, StudyMaterialReceipt } from '../study-materials.ts'
import css from './StudyMaterials.module.css'

interface Row {
  id: number
  name: string
  size: number
  state: StudyMaterialProgress | { status: 'ready'; receipt: StudyMaterialReceipt } | { status: 'error'; reason: 'empty' | 'unsupported' | 'failed' | 'tooLarge' | 'needsOcr' }
}

type Props = Pick<ComposerBarProps, 't'> & {
  studyMaterialMode: ComposerBarProps['studyMaterialMode']
  uploadStudyMaterial: ComposerBarProps['uploadStudyMaterial']
  listStudyMaterialUploads?: ComposerBarProps['listStudyMaterialUploads']
  resumeStudyMaterialUpload?: ComposerBarProps['resumeStudyMaterialUpload']
  menuOpen: boolean
  onMenuClose: () => void
  anchor: ReactNode
  onPickImages: () => void
}

/**
 * Render the two student attachment actions and their material upload panel.
 * @param props - localized view data and replaceable asynchronous operations.
 * @returns the anchored menu and a dismissible, transient upload panel.
 */
export function StudyMaterials({ t, studyMaterialMode = 'live', uploadStudyMaterial, listStudyMaterialUploads,
  resumeStudyMaterialUpload, menuOpen, onMenuClose, anchor, onPickImages }: Props) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<readonly Row[]>([])
  const files = useRef(new Map<number, File>())
  const jobs = useRef(new Map<number, AbortController>())
  const nextId = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)

  useEffect(() => () => {
    for (const job of jobs.current.values()) job.abort()
    files.current.clear()
  }, [])

  useEffect(() => {
    if (!listStudyMaterialUploads || !resumeStudyMaterialUpload) return
    const controller = new AbortController()
    void listStudyMaterialUploads(controller.signal).then((items) => {
      if (controller.signal.aborted) return
      for (const item of items) {
        const id = ++nextId.current
        setRows(current => [...current, { id, name: item.name, size: item.size,
          state: item.phase === 'ready' || item.phase === 'failed' ? { status: 'ready', receipt: item }
            : { status: 'processing', progress: 100, stored: true, totalPages: item.totalPages, completedPages: item.completedPages } }])
        if (item.phase === 'ready' || item.phase === 'failed') continue
        const monitor = new AbortController()
        jobs.current.set(id, monitor)
        void resumeStudyMaterialUpload(item, monitor.signal, (state) => {
          if (!monitor.signal.aborted) setRows(current => current.map(row => row.id === id ? { ...row, state } : row))
        }, false).then((receipt) => {
          if (!monitor.signal.aborted) setRows(current => current.map(row => row.id === id ? { ...row, state: { status: 'ready', receipt } } : row))
        }).catch(() => {
          if (!monitor.signal.aborted) setRows(current => current.map(row => row.id === id ? { ...row, state: { status: 'error', reason: 'failed' } } : row))
        }).finally(() => { if (jobs.current.get(id) === monitor) jobs.current.delete(id) })
      }
    }).catch(() => { /* The upload picker remains usable if its saved-history request fails. */ })
    return () => { controller.abort(); for (const job of jobs.current.values()) job.abort() }
  }, [listStudyMaterialUploads, resumeStudyMaterialUpload])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    addButton.current?.focus()
    const trap = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const dialog = body.current?.closest('[role="dialog"]')
      const controls = [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled)') ?? [])]
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [open])

  const update = (id: number, state: Row['state']): void => {
    setRows(current => current.map(row => row.id === id ? { ...row, state } : row))
  }
  const upload = async (id: number, file: File): Promise<void> => {
    if (uploadStudyMaterial === undefined) return
    jobs.current.get(id)?.abort()
    const controller = new AbortController()
    jobs.current.set(id, controller)
    update(id, { status: 'uploading', progress: 0 })
    try {
      const receipt = await uploadStudyMaterial(file, controller.signal, (state) => {
        if (!controller.signal.aborted) update(id, state)
      })
      if (!controller.signal.aborted) { update(id, { status: 'ready', receipt }) }
    } catch (error: unknown) {
      if (!controller.signal.aborted) update(id, {
        status: 'error', reason: error instanceof Error && (error.message === 'empty' || error.message === 'unsupported' || error.message === 'tooLarge' || error.message === 'needsOcr') ? error.message : 'failed',
      })
    } finally {
      if (jobs.current.get(id) === controller) jobs.current.delete(id)
    }
  }
  const remove = (id: number): void => {
    jobs.current.get(id)?.abort()
    jobs.current.delete(id)
    files.current.delete(id)
    setRows(current => current.filter(row => row.id !== id))

  }
  const retry = async (row: Row): Promise<void> => {
    if (row.state.status === 'ready' && row.state.receipt.uploadId && resumeStudyMaterialUpload) {
      const controller = new AbortController()
      jobs.current.set(row.id, controller)
      update(row.id, { status: 'checking', progress: 100, stored: true })
      try {
        const receipt = await resumeStudyMaterialUpload({ ...row.state.receipt, uploadId: row.state.receipt.uploadId },
          controller.signal, (state) => { if (!controller.signal.aborted) update(row.id, state) }, true)
        if (!controller.signal.aborted) update(row.id, { status: 'ready', receipt })
      } catch (_error) { if (!controller.signal.aborted) update(row.id, { status: 'error', reason: 'failed' }) }
      finally { if (jobs.current.get(row.id) === controller) jobs.current.delete(row.id) }
    } else {
      const file = files.current.get(row.id)
      if (file) await upload(row.id, file)
    }
  }
  const active = rows.find(row => row.state.status === 'uploading')
    ?? rows.find(row => row.state.status === 'processing' || row.state.status === 'recognizing' || row.state.status === 'indexing' || row.state.status === 'checking')
  const progressText = (state: StudyMaterialProgress): string => {
    const stage = t(`study.${state.status}`)
    if (state.status !== 'uploading' && state.totalPages && typeof state.completedPages === 'number') {
      return t('study.pageStage', { stage, completed: state.completedPages, total: state.totalPages })
    }
    return state.status !== 'uploading' && state.stored ? t('study.savedStage', { stage }) : stage
  }

  return <>
    <Menu open={menuOpen} onClose={onMenuClose} anchor={anchor} side="top" portal
      items={[
        { type: 'label', id: 'add', text: t('study.add') },
        {
          id: 'image',
          label: <span className={css.menuLabel}><span>{t('study.image')}</span><span className={css.menuDescription}>{t('study.imageDescription')}</span></span>,
          icon: <FileTypeIcon kind="image" size={22} />,
        },
        {
          id: 'material',
          label: <span className={css.menuLabel}><span>{t('study.upload')}</span><span className={css.menuDescription}>{t('study.uploadDescription')}</span></span>,
          icon: <ReferenceIcon kind="file" size={18} />,
          disabled: uploadStudyMaterial === undefined,
        },
      ]}
      onSelect={(id) => { onMenuClose(); if (id === 'image') onPickImages(); else setOpen(true) }} />
    {!open && active !== undefined && <button className={css.backgroundStatus} type="button" onClick={() => { setOpen(true) }}>
      <span className={css.dot} />{'progress' in active.state && progressText(active.state)}
    </button>}
    <Modal open={open} onClose={() => { setOpen(false) }} title={t('study.materialTitle')} closeLabel={t('study.close')}
      description={t(studyMaterialMode === 'mock' ? 'study.demoNote' : 'study.liveNote')} className={clsx(css.dialog)}>
      <div ref={body} data-study-material-panel>
        <button ref={addButton} type="button" className={css.choose} onClick={() => { picker.current?.click() }}>
          <IconPaperclipOutline16 />{t('study.choose')}
          <span>{t('study.formats')}</span>
        </button>
        <input ref={picker} hidden type="file" multiple accept=".pdf" aria-label={t('study.choose')}
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])]
            event.target.value = ''
            for (const file of picked) {
              const id = ++nextId.current
              files.current.set(id, file)
              setRows(current => [...current, { id, name: file.name, size: file.size, state: { status: 'uploading', progress: 0 } }])
              void upload(id, file)
            }
          }} />
        {active !== undefined && <div className={css.status} role="status" aria-live="polite">
          <span className={css.dot} />{'progress' in active.state && progressText(active.state)}
        </div>}
        {rows.length === 0 && <p className={css.empty}>{t('study.emptyList')}</p>}
        <ul className={css.files} aria-label={t('study.files')}>
          {rows.map(row => <li key={row.id} className={css.file}>
            <IconPaperclipOutline16 />
            <div className={css.details}>
              <strong title={row.name}>{row.name}</strong>
              <span aria-live="polite">{t('study.fileSize', { size: Math.ceil(row.size / 1024) })} · {row.state.status === 'ready' ? t(row.state.receipt.mode === 'mock' ? 'study.ready' : row.state.receipt.searchable === false ? `study.${row.state.receipt.errorCode ?? 'processingFailed'}` : 'study.liveReady') : row.state.status === 'error' ? t(`study.${row.state.reason}`) : progressText(row.state)}</span>
              {row.state.status === 'uploading' && <progress max={100} value={row.state.progress} aria-label={t('study.progress', { name: row.name })} />}
            </div>
            {(row.state.status === 'error' || (row.state.status === 'ready' && row.state.receipt.searchable === false)) && <button type="button" className={css.link} onClick={() => { void retry(row) }}>{t('study.retry')}</button>}
            <button type="button" className={css.link} aria-label={t('study.removeName', { name: row.name })} onClick={() => { remove(row.id) }}>{t('progress' in row.state ? 'study.cancel' : 'study.remove')}</button>
          </li>)}
        </ul>

      </div>
    </Modal>
  </>
}
