/** AxisVerse navigation keeps learning history in an on-demand drawer. */
import { useRef } from 'react'
import { StudyLogo, IconNewChatOutline16, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SidebarRootComponentProps } from './contract/slots.ts'
import css from './AxisNavigation.module.css'
import { CourseLibrary } from './CourseLibrary.tsx'

/**
 * Render learning navigation, course materials, and the existing history slot.
 * @param props - Localized navigation actions and authorized child renderers.
 * @returns the full-width application header.
 */
export function AxisNavigation({
  startSession, renderSlot, t, loadCourseMaterials, openCourseQuestion,
  loadCourseOutline, deleteCourseMaterial, restoreCourseMaterial,
}: SidebarRootComponentProps) {
  const history = useRef<HTMLDetailsElement>(null)
  const closeHistory = () => { if (history.current !== null) history.current.open = false }
  const newQuestion = () => { closeHistory(); startSession() }
  return (
    <header className={css.root}>
      <button type="button" className={css.brand} aria-label={t('session.new.label')} onClick={newQuestion}>
        {renderSlot('sidebar.brand.mark', { size: 34 }, { fallback: <StudyLogo size={34} /> })}
        {renderSlot('sidebar.brand.name', {}, { fallback: <span className={css.identity}><strong>{t('brand.study')}</strong><span>{`· ${t('brand.tagline')}`}</span></span> })}
      </button>
      <nav className={css.navigation} aria-label={t('panels.label')}>
        <button type="button" className={css.newSession} aria-label={t('session.new.label')} onClick={newQuestion}><IconNewChatOutline16 /><span>{t('session.new')}</span></button>
        <details className={css.history} ref={history} onKeyDown={(event) => {
          if (event.key === 'Escape') { closeHistory(); history.current?.querySelector('summary')?.focus() }
        }}>
          <summary>{t('history.title')}</summary>
          <button className={css.backdrop} type="button" aria-label={t('history.close')} onClick={closeHistory} />
          <section className={css.drawer} aria-label={t('history.title')}>
            <div className={css.drawerHeading}><strong>{t('history.title')}</strong><button type="button" aria-label={t('history.close')} onClick={closeHistory}><IconCloseOutline16 /></button></div>
            <p className={css.hint}>{t('history.description')}</p>
            <div className={css.historyContent}>{renderSlot('sidebar.workspaces', { wide: true, expandSidebar: closeHistory })}</div>
          </section>
        </details>
        <CourseLibrary t={t} loadCourseMaterials={loadCourseMaterials} openCourseQuestion={openCourseQuestion}
          loadCourseOutline={loadCourseOutline} deleteCourseMaterial={deleteCourseMaterial}
          restoreCourseMaterial={restoreCourseMaterial} onOpen={closeHistory} />
        <div className={css.extras}>{renderSlot('sidebar.footer.action', { wide: false })}</div>
      </nav>
    </header>
  )
}
