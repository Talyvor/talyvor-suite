import { useEffect, useRef } from 'react'
import { cn } from '../lib/cn'
import { pocket } from '../tokens'
import { faceFill, faceOf } from './Face'
import { FX_MS, cueStreams, onStreamsCue } from './fx'

// B61.70 — Pocket Live's background (~/talyvor-queue/design/pocket-live/DESIGN.md section 6): the logo's payment streams
// flowing into one point at the top right, over a satin glass of the page's two colours. Drawn once, by the Shell and the
// sign-in frame, so no page can miss it; never on a panel, a dialog or the search, which sit over a page that has it.
// The glass (drifting washes, a veil, a sheen and grain) is theme.css's .pk-bg; the streams are one canvas here.
// B61.125 (section 6.0) — the glass fills the whole window with five washes and stays put; the streams scroll with the page.
// B61.129 (section 15) — the streams draw in when the app opens, carry a pulse when money moves, and stop and lose their
// colour while every agent is paused (or the agent whose page it is): the background is the agents' work.

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
  /** B61.129 — every agent is paused, or the agent whose page it is: the streams slow to a stop and turn grey. */
  still?: boolean
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

/** The still streams' grey (section 15: "grey, 70% strength"). */
const GREY = [128, 134, 148]

/** B61.129 — a frame's effects: how far the streams have drawn in (0 to 1), where the pulse is along them (-1 for none,
 *  0 to 1.25), and how still and grey they are (0 flowing, 1 stopped). */
export interface StreamsFrame {
  reveal: number
  pulse: number
  still: number
}

const FLOWING: StreamsFrame = { reveal: 1, pulse: -1, still: 0 }

function toward(col: string, k: number): string {
  if (k <= 0.01) return col
  return col
    .split(',')
    .map((v, i) => Math.round(+v + (GREY[i] - +v) * k))
    .join(',')
}

/** One frame of the streams at time t (seconds). Full strength here; the canvas's own opacity sets 50% light, 90% dark. */
export function drawStreams(g: CanvasRenderingContext2D, w: number, h: number, t: number, hues: BackgroundHues, frame: StreamsFrame = FLOWING) {
  const { reveal, pulse, still } = frame
  const [h1, h2] = [toward(rgb(hues[0]), still), toward(rgb(hues[1]), still)]
  const alpha = 1 - 0.3 * still
  const fx = w * 1.04
  const fy = h * 0.3
  g.clearRect(0, 0, w, h)
  // The opening: the streams draw in from the left edge to their point.
  const opening = reveal < 1
  if (opening) {
    g.save()
    g.beginPath()
    g.rect(0, 0, (fx + 20) * reveal, h)
    g.clip()
  }
  for (let i = 0; i < STREAMS; i++) {
    const k = i / (STREAMS - 1)
    const col = i % 3 === 0 ? h1 : h2
    const y0 = h * (-0.1 + k * 1.05) + Math.sin(t * 0.5 + i) * 10
    const c1x = w * 0.3
    const c1y = y0 + Math.sin(t * 0.6 + i * 1.7) * 34
    const c2x = w * 0.62
    const c2y = fy + (k - 0.5) * 150 + Math.cos(t * 0.45 + i * 0.9) * 26
    const grad = g.createLinearGradient(0, 0, fx, 0)
    grad.addColorStop(0, `rgba(${col},0)`)
    grad.addColorStop(0.35, `rgba(${col},${0.55 * alpha})`)
    grad.addColorStop(1, `rgba(${col},${alpha})`)
    g.strokeStyle = grad
    g.lineWidth = i % 3 === 0 ? 1.5 : 1
    g.beginPath()
    g.moveTo(-10, y0)
    g.bezierCurveTo(c1x, c1y, c2x, c2y, fx, fy)
    g.stroke()
    // Money moved: one bright stretch runs along each stream into the point, each a little after the one above.
    const a = Math.max(0, pulse - 0.2 - k * 0.08)
    const b = Math.min(1, pulse - k * 0.08)
    if (pulse >= 0 && b > a) {
      g.beginPath()
      for (let s = 0; s <= 8; s++) {
        const u = a + ((b - a) * s) / 8
        const v = 1 - u
        const x = v * v * v * -10 + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * fx
        const y = v * v * v * y0 + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * fy
        if (s) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.strokeStyle = `rgba(${col},1)`
      g.lineWidth = 2.4
      g.lineCap = 'round'
      g.stroke()
    }
  }
  // The glow at the point swells once as the pulse arrives.
  const bump = pulse > 0.75 && pulse < 1.25 ? Math.sin((pulse - 0.75) * 2 * Math.PI) : 0
  const r = 90 + bump * 46
  const glow = g.createRadialGradient(fx, fy, 0, fx, fy, r)
  glow.addColorStop(0, `rgba(${h1},${Math.min(1, alpha * (0.5 + bump * 0.5)) * reveal})`)
  glow.addColorStop(1, `rgba(${h1},0)`)
  g.fillStyle = glow
  g.fillRect(fx - r, fy - r, r * 2, r * 2)
  if (opening) g.restore()
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * The canvas's loop. It draws only while the tab shows and the canvas is on screen, at about 30 frames a second, and with
 * reduced motion it draws one still frame and stops. Its size is read by a ResizeObserver, never in a frame, so a frame
 * does no layout work: it only paints.
 */
function useStreams(ref: React.RefObject<HTMLCanvasElement | null>, hues: BackgroundHues, stillWanted: boolean) {
  const huesRef = useRef(hues)
  huesRef.current = hues
  const stillRef = useRef(stillWanted)
  stillRef.current = stillWanted
  const wakeRef = useRef<() => void>(() => {})
  useEffect(() => wakeRef.current(), [stillWanted])
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
    // B61.129 — the effects' clocks: when the opening and the last pulse began, how still the streams are now (eased
    // towards what is wanted, about a second each way), and the streams' own time, which slows with them.
    let revealAt = 0
    let pulseAt = 0
    let k = stillRef.current ? 1 : 0
    let flow = 0
    let lastFrame = 0
    const paint = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const want = stillRef.current ? 1 : 0
      k = still ? want : k + (want - k) * 0.08
      if (Math.abs(want - k) < 0.005) k = want
      const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0
      lastFrame = now
      flow += dt * (1 - k)
      let reveal = 1
      if (revealAt && !still) {
        const p = Math.min(1, (now - revealAt) / FX_MS.opening)
        reveal = 1 - Math.pow(1 - p, 3)
        if (p >= 1) revealAt = 0
      }
      let pulse = -1
      if (pulseAt && !still) {
        pulse = (now - pulseAt) / FX_MS.pulse
        if (pulse > 1.25) {
          pulseAt = 0
          pulse = -1
        }
      }
      drawStreams(g, w, h, (still ? 0 : flow) + seed, huesRef.current, { reveal, pulse, still: k })
    }
    // It runs while it shows, and with reduced motion never; while still and fully stopped it rests, with nothing to draw.
    const busy = () => revealAt !== 0 || pulseAt !== 0 || k !== (stillRef.current ? 1 : 0) || !stillRef.current
    const running = () => !still && onScreen && !document.hidden && busy()
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
    wakeRef.current = wake
    const cue = onStreamsCue((what, at) => {
      if (what === 'open') revealAt = at
      else pulseAt = at
      wake()
    })
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
    // The app opens: the streams draw in from the left edge over 900 ms.
    cueStreams('open')
    wake()
    return () => {
      cue()
      wakeRef.current = () => {}
      if (raf) cancelAnimationFrame(raf)
      media?.removeEventListener?.('change', onMotion)
      document.removeEventListener('visibilitychange', wake)
      resize?.disconnect()
      seen?.disconnect()
    }
  }, [ref])
}

/**
 * B61.125 — the window's two colours, on the document too: a panel, a dialog or the Help box opens on the body, outside
 * the page, and washes itself in them (theme.css [data-layer]).
 */
function useWindowHues(hues: BackgroundHues) {
  const [h1, h2] = hues
  useEffect(() => {
    const root = document.documentElement.style
    root.setProperty('--h1', h1)
    root.setProperty('--h2', h2)
    return () => {
      root.removeProperty('--h1')
      root.removeProperty('--h2')
    }
  }, [h1, h2])
}

/**
 * The background: the glass across the whole window (fixed, data-glass) and the streams at the top of the page, under
 * everything in its frame. It is aria-hidden and never takes a press (pointer-events: none), so a top-bar button over it
 * answers as it did. With reduced motion the washes and the sheen stand at their first frame and the streams are still.
 */
export function PageBackground({ hues, still = false, className }: PageBackgroundProps) {
  const canvas = useRef<HTMLCanvasElement | null>(null)
  useStreams(canvas, hues, still)
  useWindowHues(hues)
  return (
    <div
      aria-hidden="true"
      data-background="streams"
      data-still={still ? 'true' : undefined}
      className={cn('pk-bg', className)}
      style={{ '--h1': hues[0], '--h2': hues[1] } as React.CSSProperties}
    >
      <div className="pk-bg-glass" data-glass="">
        <div className="pk-bg-tint">
          <i className="pk-bg-b1" />
          <i className="pk-bg-b2" />
          <i className="pk-bg-b3" />
          <i className="pk-bg-b4" />
          <i className="pk-bg-b5" />
        </div>
        <div className="pk-bg-satin" />
        <i className="pk-bg-grain" style={{ backgroundImage: `url(${GRAIN})` }} />
      </div>
      <canvas ref={canvas} className="pk-bg-streams" />
    </div>
  )
}
