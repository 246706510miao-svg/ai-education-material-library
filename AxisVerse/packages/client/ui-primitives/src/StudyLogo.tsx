/** Shared book-and-spark mark for the Zhiwei study workspace. */
import type { IconProps } from './icons/props.ts'

/**
 * Render the decorative study mark in the surrounding text color.
 * @param props.size - Square edge in pixels; defaults to 24.
 * @param props.className - Optional layout and color class.
 * @returns an aria-hidden SVG; the owner supplies its accessible name.
 */
export function StudyLogo({ size = 24, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" fillOpacity="0.1" />
      <path d="M16 25c-3-2.3-6.1-3.1-10-2.7V10.5c3.9-.4 7 .4 10 2.7m0 11.8c3-2.3 6.1-3.1 10-2.7v-7.8M16 25V13.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m24 5 1.4 3.6L29 10l-3.6 1.4L24 15l-1.4-3.6L19 10l3.6-1.4L24 5Z" fill="currentColor" />
    </svg>
  )
}
