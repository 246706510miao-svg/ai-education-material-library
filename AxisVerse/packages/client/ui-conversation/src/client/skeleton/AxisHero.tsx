/** English headline animation for the AxisVerse blank conversation. */
import { useLayoutEffect, useRef } from 'react'
import type { HeroShellProps } from './EmptyHero.tsx'
import css from './AxisHero.module.css'

/**
 * Park at the arrow on entry and sweep to the right edge on first submission.
 * @param props - Localized copy, submission state, and sweep completion callback.
 * @returns the animated headline above the resident composer.
 */
export function AxisHero({ t, submitting = false, onSubmitComplete }: Pick<HeroShellProps, 't'> & {
  submitting?: boolean
  onSubmitComplete?: (() => void) | undefined
}) {
  const box = useRef<HTMLDivElement>(null)
  const arrow = useRef<HTMLElement>(null)
  const range = useRef<HTMLInputElement>(null)
  const frame = useRef(0)
  const parked = useRef(false)
  const progress = useRef(0)
  const setProgress = (value: number) => {
    progress.current = value
    box.current?.style.setProperty('--axis-progress', `${value}%`)
    if (range.current !== null) range.current.value = String(value)
  }
  useLayoutEffect(() => {
    const element = box.current
    const arrowElement = arrow.current
    if (element === null || arrowElement === null) return
    const center = () => {
      const bounds = element.getBoundingClientRect()
      const mark = arrowElement.getBoundingClientRect()
      return bounds.width === 0 ? 50 : (mark.left + mark.width / 2 - bounds.left) / bounds.width * 100
    }
    const target = center()
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    const step = (now: number) => {
      const time = Math.min(1, (now - start) / 1200)
      const ease = time < .5 ? 4 * time ** 3 : 1 - (-2 * time + 2) ** 3 / 2
      setProgress(target * ease)
      if (time < 1) frame.current = requestAnimationFrame(step)
      else { parked.current = true; setProgress(center()) }
    }
    setProgress(0)
    if (reduced) { parked.current = true; setProgress(target) }
    else frame.current = requestAnimationFrame(step)
    const observer = new ResizeObserver(() => { if (parked.current) setProgress(center()) })
    observer.observe(element)
    return () => { cancelAnimationFrame(frame.current); observer.disconnect() }
  }, [])
  useLayoutEffect(() => {
    if (!submitting) return
    cancelAnimationFrame(frame.current)
    parked.current = false
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setProgress(100)
      onSubmitComplete?.()
      return
    }
    const from = progress.current
    const start = performance.now()
    const step = (now: number) => {
      const time = Math.min(1, Math.max(0, (now - start) / 1100))
      const ease = time < .5 ? 4 * time ** 3 : 1 - (-2 * time + 2) ** 3 / 2
      setProgress(from + (100 - from) * ease)
      frame.current = requestAnimationFrame(time < 1 ? step : () => onSubmitComplete?.())
    }
    frame.current = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(frame.current) }
  }, [submitting, onSubmitComplete])
  return (
    <div className={css.root} lang="en">
      <div className={css.overline}>
        <span>{t('hero.greeting')}</span>
        <svg className={css.trace} viewBox="0 0 320 90" aria-hidden="true">
          <path className={css.path} pathLength="1" d="M25 64 C48 64 51 35 82 35 S116 63 147 63 S178 25 211 25 H286" />
          {[{ x: 25, y: 64 }, { x: 82, y: 35 }, { x: 147, y: 63 }, { x: 211, y: 25 }, { x: 286, y: 25 }].map(({ x, y }, index) => <circle key={x} className={css.node} cx={x} cy={y} r={index === 4 ? 4 : 3} style={{ animationDelay: `${index * 80}ms` }} />)}
        </svg>
      </div>
      <div className={css.wordbox} ref={box}>
        <h1 className={css.words}><span>{t('hero.headline')}</span>{' '}<em ref={arrow}>→</em>{' '}<span>{t('hero.headlineTogether')}</span></h1>
        <div className={css.color} aria-hidden="true"><div className={css.words}><span>{t('hero.headline')}</span><em>→</em><span>{t('hero.headlineTogether')}</span></div></div>
        <div className={css.cursor} aria-hidden="true" />
        <input ref={range} className={css.range} type="range" min="0" max="100" step=".01" defaultValue="0" disabled={submitting} aria-label={t('hero.reveal')} onInput={(event) => { cancelAnimationFrame(frame.current); parked.current = false; setProgress(Number(event.currentTarget.value)) }} />
      </div>
      <p className={css.subtitle}>{t('hero.subtitle')}</p>
    </div>
  )
}
