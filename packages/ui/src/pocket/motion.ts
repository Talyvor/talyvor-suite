import { motion } from '../preset'

type Duration = keyof typeof motion.duration
type Easing = keyof typeof motion.easing

/** True where the reader asked for less motion: then a view changes at once (Pocket Live, DESIGN.md section 4). */
export function reducedMotion(): boolean {
  return typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * B61.74 — one of the eight moves, played with the Web Animations API on Pocket Live's tokens. Nothing is played under
 * reduced motion, or where the browser has no Element.animate, and then null comes back: the view is already where it ends.
 */
export function play(el: Element | null | undefined, keyframes: Keyframe[], duration: Duration, easing: Easing): Animation | null {
  if (!el || typeof el.animate !== 'function' || reducedMotion()) return null
  return el.animate(keyframes, { duration: parseFloat(motion.duration[duration]), easing: motion.easing[easing] })
}
