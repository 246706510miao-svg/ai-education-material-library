/** Study prompts enter the existing draft; choosing a card never sends a message. */
import type { ConversationContentProps } from '../contract/slots.ts'
import css from './StudyStarters.module.css'

type StudyStartersProps = Pick<ConversationContentProps, 't'> & {
  onChoose: (prompt: string) => void
}

/**
 * Render localized calculus prompts and the course-data availability notice.
 * @param props - Localized copy and the owner's draft callback.
 * @returns three keyboard-accessible prompt cards.
 */
export function StudyStarters({ t, onChoose }: StudyStartersProps) {
  return (
    <section className={css.root} aria-label={t('study.title')}>
      <div className={css.cards}>
        <span className={css.heading}>{t('study.title')}</span>
        {(['region', 'order', 'check'] as const).map(topic => (
          <button className={css.card} key={topic} type="button" onClick={() => { onChoose(t(`study.${topic}.prompt`)) }}>
            <strong>{t(`study.${topic}.title`)}</strong>
          </button>
        ))}
      </div>
      <div className={css.footer}>
        <span>{t('study.availability')}</span>
      </div>
    </section>
  )
}
