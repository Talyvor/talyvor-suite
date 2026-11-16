import { useEffect, useRef } from 'react'
import { cn } from '../lib/cn'
import { pocket } from '../tokens'
import { faceFill, faceOf } from './Face'

// B61.70 — Pocket Live's background (~/talyvor-queue/design/pocket-live/DESIGN.md section 6): the logo's payment streams
// flowing into one point at the top right, over a satin glass of the page's two colours. Drawn once, by the Shell and the
// sign-in frame, so no page can miss it; never on a panel, a dialog or the search, which sit over a page that has it.
// The glass (three drifting washes, a veil, a sheen and grain) is theme.css's .pk-bg; the streams are one canvas here.

/** A page's two colours: Personal tangerine and cobalt, Business cobalt and mint, an agent's page its own colour twice. */
export type BackgroundHues = readonly [string, string]

export const personalHues: BackgroundHues = [pocket.light.tangerine, pocket.light['agent-cobalt']]
export const businessHues: BackgroundHues = [pocket.light['agent-cobalt'], pocket.light['agent-mint']]
/** An agent's page and its rules page: the agent's own colour, as its face wears it. */
export const agentHues = (agent: { id: string; colour?: string }): BackgroundHues => {
  const fill = faceFill(faceOf(agent).colour)
  return [fill, fill]
}

export interface PageBackgroundProps {
  hues: BackgroundHues
  className?: string
}

/** The satin's grain: Pocket Live's 128 px tile (design/pocket-live/assets), copied unchanged into the web's public files. */
const GRAIN = '/pocket-live/satin-grain.png'

/** About 30 frames a second: a frame is drawn once this many ms have passed since the last. A little under 1000/30, so
 *  at 60 Hz it is every other frame (33.3 ms apart, with the display's jitter) and at 120 Hz every fourth. */
const FRAME_MS = 29
const STREAMS = 22

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`
}

/** One frame of the streams at time t (seconds). Full strength here; the canvas's own opacity sets 50% light, 90% dark. */
export function drawStreams(g: CanvasRenderingContext2D, w: number, h: number, t: number, hues: BackgroundHues) {
  const [h1, h2] = [rgb(hues[0]), rgb(hues[1])]
  const fx = w * 1.04
  const fy = h * 0.3
  g.clearRect(0, 0, w, h)
  for (let i = 0; i < STREAMS; i++) {
    const k = i / (STREAMS - 1)
    const col = i % 3 === 0 ? h1 : h2
    const y0 = h * (-0.1 + k * 1.05) + Math.sin(t * 0.5 + i) * 10
    const grad = g.createLinearGradient(0, 0, fx, 0)
    grad.addColorStop(0, `rgba(${col},0)`)
    grad.addColorStop(0.35, `rgba(${col},0.55)`)
    grad.addColorStop(1, `rgba(${col},1)`)
    g.strokeStyle = grad
    g.lineWidth = i % 3 === 0 ? 1.5 : 1
    g.beginPath()
    g.moveTo(-10, y0)
    g.bezierCurveTo(w * 0.3, y0 + Math.sin(t * 0.6 + i * 1.7) * 34, w * 0.62, fy + (k - 0.5) * 150 + Math.cos(t * 0.45 + i * 0.9) * 26, fx, fy)
    g.stroke()
  }
  const glow = g.createRadialGradient(fx, fy, 0, fx, fy, 90)
  glow.addColorStop(0, `rgba(${h1},0.5)`)
  glow.addColorStop(1, `rgba(${h1},0)`)
  g.fillStyle = glow
  g.fillRect(fx - 90, fy - 90, 180, 180)
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The canvas's loop. It draws only while the tab shows and the canvas is on screen, at about 30 frames a second, and with
 * reduced motion it draws one still frame and stops. Its size is read by a ResizeObserver, never in a frame, so a frame
 * does no layout work: it only paints.
 */
function useStreams(ref: React.RefObject<HTMLCanvasElement | null>, hues: BackgroundHues) {
  const huesRef = useRef(hues)
  huesRef.current = hues
  useEffect(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const seed = Math.random() * 10
    let w = c.clientWidth
    let h = c.clientHeight
    let onScreen = true
    let still = reducedMotion()
    let raf = 0
    let last = -Infinity
    const paint = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawStreams(g, w, h, (still ? 0 : now / 1000) + seed, huesRef.current)
    }
    const running = () => !still && onScreen && !document.hidden
    const frame = (now: number) => {
      raf = 0
      if (!running()) return
      raf = requestAnimationFrame(frame)
      if (now - last < FRAME_MS) return
      last = now
      paint(now)
    }
    // Start the loop when it may run; with reduced motion, or off screen, one still frame is all there is.
    const wake = () => {
      if (document.hidden) return
      if (running()) {
        if (!raf) raf = requestAnimationFrame(frame)
      } else if (still) paint(0)
    }
    const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    const onMotion = () => {
      still = reducedMotion()
      wake()
    }
    media?.addEventListener?.('change', onMotion)
    document.addEventListener('visibilitychange', wake)
    const resize =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(([e]) => {
            w = e.contentRect.width
            h = e.contentRect.height
            if (!running() && !document.hidden) paint(last === -Infinity ? 0 : last)
          })
        : null
    resize?.observe(c)
    const seen =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(([e]) => {
            onScreen = e.isIntersecting
            wake()
          })
        : null
    seen?.observe(c)
    wake()
    return () => {
      if (raf) cancelAnimationFrame(raf)
      media?.removeEventListener?.('change', onMotion)
      document.removeEventListener('visibilitychange', wake)
      resize?.disconnect()
      seen?.disconnect()
    }
  }, [ref])
}

/**
 * The background at the top of a page: absolutely placed in its frame, under everything in it. It is aria-hidden and
 * never takes a press (pointer-events: none), so a top-bar button over it answers as it did. With reduced motion the
 * washes and the sheen stand at their first frame and the streams are still.
 */
export function PageBackground({ hues, className }: PageBackgroundProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  useStreams(canvas, hues)
  return (
    <div
      aria-hidden="true"
      data-background="streams"
      className={cn('pk-bg', className)}
      style={{ '--h1': hues[0], '--h2': hues[1] } as React.CSSProperties}
    >
      <div className="pk-bg-glass">
        <div className="pk-bg-tint">
          <i className="pk-bg-b1" />
          <i className="pk-bg-b2" />
          <i className="pk-bg-b3" />
        </div>
        <div className="pk-bg-satin" />
        <i className="pk-bg-grain" style={{ backgroundImage: `url(${GRAIN})` }} />
      </div>
      <canvas ref={canvas} className="pk-bg-streams" />
    </div>
  )
}
