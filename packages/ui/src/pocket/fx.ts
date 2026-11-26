import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from '../preset'
import { reducedMotion } from './motion'

/**
 * B61.129 — Pocket Live's special openings, transitions and buttons on the web (DESIGN.md section 15, the three tables).
 * An effect never delays a press and never says anything alone: the snack, the tick or the figure says the same thing.
 * Each money effect is asked for where the screen already has the server's answer, never on the press. With reduced
 * motion none of them starts: each function here returns before drawing anything.
 */

/** Section 15's timings, in ms. */
export const FX_MS = { pulse: 760, ring: 760, burst: 1250, ripple: 620, done: 430, frost: 560, opening: 900 } as const

const EASE_OUT = motion.easing.out

/** What the streams are asked to do: draw in from the left edge (the opening), or carry one bright pulse into the point. */
export type StreamsCue = 'open' | 'pulse'

const streams = new Set<(cue: StreamsCue, at: number) => void>()

/** PageBackground's canvas listens here. */
export function onStreamsCue(listener: (cue: StreamsCue, at: number) => void): () => void {
  streams.add(listener)
  return () => {
    streams.delete(listener)
  }
}

export function cueStreams(cue: StreamsCue): void {
  if (reducedMotion()) return
  const at = performance.now()
  for (const listener of streams) listener(cue, at)
}

/** The middle of an element in the window, or of the window when there is none. */
function middleOf(from?: Element | null): [number, number] {
  if (from && from.isConnected) {
    const r = from.getBoundingClientRect()
    if (r.width || r.height) return [r.left + r.width / 2, r.top + r.height / 2]
  }
  return [window.innerWidth / 2, window.innerHeight / 2]
}

/** What the person just pressed, where a ring opens from when nothing else is named. */
function pressed(): Element | null {
  const el = typeof document === 'undefined' ? null : document.activeElement
  return el && el !== document.body ? el : null
}

/** One element on the body, over everything, that takes no press and no screen reader, and is gone when it has played. */
function overlay(tag: 'i' | 'canvas', className: string): HTMLElement {
  const el = document.createElement(tag)
  el.className = className
  el.setAttribute('aria-hidden', 'true')
  el.dataset.fx = className
  document.body.appendChild(el)
  return el
}

function playOnce(el: HTMLElement, keyframes: Keyframe[], ms: number): void {
  if (typeof el.animate !== 'function') {
    el.remove()
    return
  }
  const a = el.animate(keyframes, { duration: ms, easing: EASE_OUT, fill: 'forwards' })
  a.finished.then(
    () => el.remove(),
    () => el.remove(),
  )
}

/** A soft ring of colour that opens across the window from a point and is gone: green for money in, the page's colour out. */
export function ring(from?: Element | null, colour = 'var(--h1, #FF7A1A)'): void {
  if (reducedMotion() || typeof document === 'undefined') return
  const [x, y] = middleOf(from ?? pressed())
  const d = Math.hypot(window.innerWidth, window.innerHeight) * 2.1
  const el = overlay('i', 'pk-fx-ring')
  el.style.cssText = `left:${x - d / 2}px;top:${y - d / 2}px;width:${d}px;height:${d}px;--fxc:${colour}`
  playOnce(el, [{ transform: 'scale(.02)', opacity: 0.5 }, { transform: 'scale(1)', opacity: 0 }], FX_MS.ring)
}

/**
 * How money moved, as the screen read it from the server's answer: `out` (sent, withdrawn), `in` (approved, added) or
 * `inside` the account (to an agent, back from one, a conversion). Every one pulses the streams; out and in also open a
 * ring, the page's colour for out and green for in.
 */
export type MoneyMove = 'out' | 'in' | 'inside'

export function moneyMoved(kind: MoneyMove, from?: Element | null): void {
  cueStreams('pulse')
  if (kind === 'inside') return
  ring(from, kind === 'in' ? 'var(--success, #0B7A45)' : 'var(--h1, #FF7A1A)')
}

function rgbOf(colour: string, fallback: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim())?.[1] ?? fallback.slice(1)
  const n = parseInt(hex, 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

/**
 * A burst of 44 small dots and dashes in the page's two colours, tangerine and lemon, from the middle of the window,
 * falling and fading over 1.25 s. Only when an account is opened or an agent is made.
 */
export function burst(): void {
  if (reducedMotion() || typeof document === 'undefined') return
  const c = overlay('canvas', 'pk-fx-burst') as HTMLCanvasElement
  const g = c.getContext?.('2d')
  if (!g || typeof requestAnimationFrame !== 'function') {
    c.remove()
    return
  }
  const W = window.innerWidth
  const H = window.innerHeight
  c.width = W * 2
  c.height = H * 2
  g.scale(2, 2)
  const root = getComputedStyle(document.documentElement)
  const cols = [
    rgbOf(root.getPropertyValue('--h1'), '#FF7A1A'),
    rgbOf(root.getPropertyValue('--h2'), '#2F5BFF'),
    rgbOf('#FF7A1A', '#FF7A1A'),
    rgbOf('#FFD43B', '#FFD43B'),
  ]
  const [x, y] = [W / 2, H * 0.4]
  const bits = Array.from({ length: 44 }, (_, i) => {
    const a = Math.random() * Math.PI * 2
    const v = 2.5 + Math.random() * 6.5
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 3.2, r: 2 + Math.random() * 3.5, c: cols[i % cols.length], long: i % 3 === 0, rot: a }
  })
  const t0 = performance.now()
  const step = (now: number) => {
    const t = (now - t0) / FX_MS.burst
    if (t >= 1 || !c.isConnected) {
      c.remove()
      return
    }
    g.clearRect(0, 0, W, H)
    for (const p of bits) {
      p.x += p.vx
      p.y += p.vy
      p.vy += 0.22
      p.vx *= 0.985
      p.rot += 0.12
      g.save()
      g.translate(p.x, p.y)
      g.rotate(p.rot)
      g.fillStyle = `rgba(${p.c},${Math.max(0, 1 - t * t)})`
      g.beginPath()
      if (p.long) g.rect(-p.r * 2, -p.r / 2, p.r * 4, p.r)
      else g.arc(0, 0, p.r, 0, Math.PI * 2)
      g.fill()
      g.restore()
    }
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

/**
 * A ripple from where the pointer landed, on a control that carries data-ripple: `main` in a tint of the button's own
 * words, `ink` in a tint of ink (grey buttons, choices), `wait` in tangerine (the waiting card).
 */
export function ripple(target: HTMLElement, clientX: number, clientY: number): void {
  if (reducedMotion()) return
  const r = target.getBoundingClientRect()
  const d = Math.max(r.width, r.height) * 2.2
  const el = document.createElement('i')
  el.className = 'pk-fx-ripple'
  el.setAttribute('aria-hidden', 'true')
  el.style.cssText = `left:${clientX - r.left - d / 2}px;top:${clientY - r.top - d / 2}px;width:${d}px;height:${d}px`
  target.appendChild(el)
  playOnce(el, [{ transform: 'scale(.05)', opacity: 0.5 }, { transform: 'scale(1)', opacity: 0 }], FX_MS.ripple)
}

/** A card's picture (data-card) tilts up to 9 degrees towards the pointer, and its band of light follows it. */
function tilt(art: HTMLElement, clientX: number, clientY: number): void {
  const r = art.getBoundingClientRect()
  if (!r.width || !r.height) return
  const px = (clientX - r.left) / r.width - 0.5
  const py = (clientY - r.top) / r.height - 0.5
  art.style.transform = `perspective(700px) rotateY(${(px * 18).toFixed(2)}deg) rotateX(${(-py * 18).toFixed(2)}deg)`
  art.style.setProperty('--sx', `${((px + 0.5) * 100).toFixed(1)}%`)
  art.dataset.tilt = ''
}

function untilt(art: HTMLElement): void {
  art.style.transform = ''
  delete art.dataset.tilt
}

/**
 * The Shell's listeners, on the document once: the ripple on a press, and on the web's cards a soft light that follows
 * the pointer (--mx, --my on .pk-card) and the picture's tilt. With reduced motion the ripple and the tilt never start;
 * the light under the pointer is not motion and stays.
 */
export function useFxPresses(): void {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const t = (e.target as Element | null)?.closest?.<HTMLElement>('[data-ripple]')
      if (!t || (t as HTMLButtonElement).disabled) return
      ripple(t, e.clientX, e.clientY)
    }
    const move = (e: PointerEvent) => {
      const el = e.target as Element | null
      const card = el?.closest?.<HTMLElement>('.pk-card')
      if (card) {
        const r = card.getBoundingClientRect()
        card.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`)
        card.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`)
      }
      const art = el?.closest?.<HTMLElement>('[data-card]')
      if (art && !reducedMotion()) tilt(art, e.clientX, e.clientY)
    }
    const out = (e: PointerEvent) => {
      const art = (e.target as Element | null)?.closest?.<HTMLElement>('[data-card]')
      if (art && !art.contains(e.relatedTarget as Node | null)) untilt(art)
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerout', out)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerout', out)
    }
  }, [])
}

/**
 * A main button that finishes a small job (add money, move to an agent, take back, convert, a rule that asks for no
 * passkey): once the server has answered, `finish(then)` turns it green with a tick (Button's `done`) and runs `then`
 * (closing its panel) 430 ms later. The request was already sent on the press; this only follows its answer. With
 * reduced motion `then` runs at once.
 */
export function useDoneTick(): { done: boolean; finish: (then: () => void) => void } {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => clearTimeout(timer.current ?? undefined), [])
  const finish = useCallback((then: () => void) => {
    if (reducedMotion()) return then()
    setDone(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setDone(false)
      then()
    }, FX_MS.done)
  }, [])
  return { done, finish }
}

/**
 * Frost crosses a card's picture from left to right when it is frozen (560 ms). Only on the change: a card that was
 * already frozen when the page opened shows its frost at once.
 */
export function useFrost(frozen: boolean): React.RefObject<HTMLElement> {
  const ice = useRef<HTMLElement>(null)
  const was = useRef(frozen)
  useEffect(() => {
    const changed = frozen && !was.current
    was.current = frozen
    const el = ice.current
    if (!changed || !el || reducedMotion() || typeof el.animate !== 'function') return
    el.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: FX_MS.frost, easing: EASE_OUT })
  }, [frozen])
  return ice
}

// The web app's load: the first Home of this visit counts its figures up from nothing.
let opened = false

/** True on the first Home drawn since the page loaded, for as long as that Home is on the page; never with reduced motion. */
export function useOpening(): boolean {
  const [first] = useState(() => !opened && !reducedMotion())
  useEffect(() => {
    opened = true
  }, [])
  return first
}

/** Tests only: the next Home is the first again. */
export function resetOpeningForTest(): void {
  opened = false
}
