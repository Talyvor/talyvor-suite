import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useDocumentTitle } from '../../documentTitle'
import { useSignupProbe } from '../../lib/signupOpen'
import { COMPANY_CONTACT, COMPANY_LINE } from '../../company'
import SITE_CSS from './site.css?raw'

// The marketing landing (/marketing, OUTSIDE the AuthGate — see App.tsx). talyvor.com redirects here. It must render
// with no session, no router context, and no providers: Landing.test.tsx renders <Landing /> bare, so nothing here may
// touch react-router or react-query. Every internal destination is a plain anchor for that reason.
//
// ── B64.1: VERSION 4 (Nick approved 17 Nov 2026) ─────────────────────────────────────────────────
//
// The page is design/website-2026-11-17-v4/index.html, section by section: its words exactly, its stylesheet
// (site.css, scoped under .tv4) and its media, served from the app at /site/. Its script is ported to React
// state, with the differences the site's rules make: every "Open your account" goes to /signup on this origin (B64.2),
// the company line is company.ts's (B32), the footer links Privacy and Terms, and "Early access is open" shows only
// while the sign-up gate says so. The loops play from their file URL; loading them whole into a blob first needs
// media-src blob: in the CSP and is B64.4.
//
// Rules that stay on (FOR-V7.md section 3): the Sandbox label in the demo and "Where we are" stay, no line says real
// money is live, and the page never says LXC or that Talyvor is not a bank (Landing.test.tsx).

// ── THE CONTACT ADDRESS ──────────────────────────────────────────────────────────────────────────
//
// ⚠ IT IS A BUILD-TIME VARIABLE. Vite inlines import.meta.env when the bundle is compiled, so
// setting VITE_CONTACT_EMAIL on the running container does nothing at all — the value has to be
// present in the environment of the `pnpm build` that produces the assets. See deploy/README.
export const CONTACT_EMAIL: string = import.meta.env.VITE_CONTACT_EMAIL || COMPANY_CONTACT

/** The teal rule: 32×2 accent, once per section, under its headline. Still drawn by the public board and share pages. */
export function TealRule({ className = '' }: { className?: string }) {
  return <span className={`block h-0.5 w-8 bg-accent ${className}`} aria-hidden="true" />
}

/** Where the page's media is served from (apps/web/public/site, copied from the design's media/). */
const MEDIA = '/site'
const SIGNUP = '/signup'

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const ArrowIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8 5.5v13l11-6.5z" />
  </svg>
)

// ── The loops ────────────────────────────────────────────────────────────────────────────────────

/** Each film starts on its own first frame (the poster), loads one at a time in page order, and runs only while on
 *  screen and in a visible tab. Reduced motion keeps the posters. */
function useLoops(root: React.RefObject<HTMLDivElement>) {
  useEffect(() => {
    const el = root.current
    if (!el) return
    const REDUCE = reduceMotion()
    const loops = [...el.querySelectorAll<HTMLVideoElement>('video[data-loop]')]
    const seen = new Map<HTMLVideoElement, boolean>()
    const small =
      (typeof matchMedia === 'function' && !matchMedia('(min-width: 768px)').matches) ||
      !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
    let stopped = false
    const run = (v: HTMLVideoElement, on: boolean | undefined) => {
      if (on && v.dataset.ready && !REDUCE && !document.hidden) v.play()?.catch(() => {})
      else v.pause()
    }
    const load = async (v: HTMLVideoElement) => {
      v.src = (small && v.dataset.small) || v.dataset.src || ''
      await new Promise<void>((res) => {
        if (v.readyState >= 3) return res()
        v.addEventListener('canplaythrough', () => res(), { once: true })
        setTimeout(res, 8000)
      })
      if (stopped) return
      v.dataset.ready = '1'
      run(v, seen.get(v))
    }
    let observer: IntersectionObserver | undefined
    const onVisibility = () => loops.forEach((v) => run(v, seen.get(v)))
    if (typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver(
        (es) =>
          es.forEach((e) => {
            const v = e.target as HTMLVideoElement
            seen.set(v, e.isIntersecting)
            run(v, e.isIntersecting)
          }),
        { rootMargin: '120px 0px' },
      )
      loops.forEach((v) => observer?.observe(v))
      document.addEventListener('visibilitychange', onVisibility)
    } else loops.forEach((v) => seen.set(v, true))
    if (!REDUCE)
      void (async () => {
        for (const v of loops) {
          if (stopped) return
          await load(v)
        }
      })()
    return () => {
      stopped = true
      observer?.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      loops.forEach((v) => v.pause())
    }
  }, [root])
}

// ── Nav and hero ─────────────────────────────────────────────────────────────────────────────────

function Nav() {
  return (
    <nav className="nav" aria-label="Main">
      <div className="wrap">
        <a className="logo" href="#top" aria-label="Talyvor home">
          <img src={`${MEDIA}/logo.svg`} alt="Talyvor" />
        </a>
        <div className="links">
          <a href="#how">How it works</a>
          <a href="#try">Try it</a>
          <a href="#everyone">For everyone</a>
          <a href="#pricing">Pricing</a>
        </div>
        <a className="btn hot" href={SIGNUP}>
          Open an account
        </a>
      </div>
    </nav>
  )
}

function Hero({ onWatch }: { onWatch: () => void }) {
  // The chip is a claim about access, so it is the server's: shown only while sign-up is open, never on a guess.
  const { signup } = useSignupProbe()
  return (
    <header className="hero" id="top">
      <div className="wrap grid">
        <div>
          {signup === 'open' ? (
            <span className="chip live">
              <i className="dot" />
              Early access is open
            </span>
          ) : null}
          <h1>
            Your AI agent wants your card.
            <br />
            <span className="l2">Give it its own.</span>
          </h1>
          <p className="sub">
            Everyone else made agent money complicated. <b>We made it three steps.</b> Sign up, open an account, give your
            agent a card. It pays inside your rules and asks you before anything else.
          </p>
          <div className="ctas">
            <a className="btn hot" href={SIGNUP}>
              Open your account
              <ArrowIcon />
            </a>
            <a className="btn ghost" href="#how" onClick={onWatch}>
              <PlayIcon />
              Watch the one-minute how-to
            </a>
          </div>
          <div className="meta">
            <span>No setup homework</span>
            <span>Free for people</span>
            <span>Personal or business</span>
          </div>
        </div>
        <video
          className="film"
          data-loop
          data-src={`${MEDIA}/hero-loop-1080.mp4`}
          data-small={`${MEDIA}/hero-loop-720.mp4`}
          poster={`${MEDIA}/hero-loop-poster.jpg`}
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        />
        <div className="phonewrap">
          <div className="phone">
            <video
              data-loop
              data-src={`${MEDIA}/approve-loop-hd.mp4`}
              poster={`${MEDIA}/approve-loop-poster.jpg`}
              muted
              loop
              playsInline
              preload="auto"
              aria-label="The Talyvor app on a phone. An agent asks to pay, the owner approves with Face ID."
            />
          </div>
          <div className="toast t1">
            <span className="ic" style={{ background: 'var(--mint)' }}>
              P
            </span>
            <span>
              Penny paid $34.00<small>Inside your rules</small>
            </span>
          </div>
          <div className="toast t2">
            <span className="ic" style={{ background: 'var(--tang)' }}>
              J
            </span>
            <span>
              Juno asks for €412<small>Waiting for your yes</small>
            </span>
          </div>
          <div className="toast t3">
            <span className="ic" style={{ background: 'var(--lemon)' }}>
              II
            </span>
            <span>
              Every agent paused<small>One tap</small>
            </span>
          </div>
        </div>
      </div>
    </header>
  )
}

const MARQUEE = ['No SDK homework', 'No protocol degree', 'No borrowing your card', 'One look to approve', 'One tap to stop', 'For people and businesses', 'Inside Claude']

function Marquee() {
  return (
    <div className="mq-wrap" aria-hidden="true">
      <div className="marquee">
        <div className="track">
          {[...MARQUEE, ...MARQUEE].map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Idea() {
  return (
    <section className="cine" aria-labelledby="g-h">
      <video
        data-loop
        data-src={`${MEDIA}/give-it-loop-1080.mp4`}
        data-small={`${MEDIA}/give-it-loop-720.mp4`}
        poster={`${MEDIA}/give-it-loop-poster.jpg`}
        muted
        loop
        playsInline
        preload="auto"
        aria-hidden="true"
      />
      <div className="wrap">
        <p className="eyebrow">The idea</p>
        <h2 className="h2" id="g-h">
          Stop lending your agent <span className="pill">your card.</span>
        </h2>
        <p className="lede">It gets its own account and its own card. Your rules sit on top, and anything outside them waits for your yes.</p>
      </div>
    </section>
  )
}

// ── The jargon wall ──────────────────────────────────────────────────────────────────────────────

const JARGON = ['x402', 'KYA', 'MPP', 'JWT scopes', 'smart accounts', 'account abstraction', 'webhooks', 'API keys', 'mandates', 'OAuth', 'on-chain settlement', 'gas fees',
  'custody model', 'npm install', 'PCI scope', 'network tokens', 'idempotency keys', 'session keys', 'paymaster', 'rate limits', 'signed intents', 'ERC-4337', 'KYB flows',
  'callback URLs', 'spend policies JSON', 'MCP server config', 'merchant category codes', 'sandbox keys', 'retry logic', 'HMAC signatures', 'SDK v3 migration', 'chain IDs']

/** The words are laid out by measuring each one, so the cloud is drawn straight into the DOM (it is aria-hidden). */
function scatter(stage: HTMLDivElement, cloud: HTMLDivElement, center: HTMLDivElement) {
  cloud.innerHTML = ''
  const W = stage.clientWidth, H = stage.clientHeight, sr = stage.getBoundingClientRect(), cr = center.getBoundingClientRect()
  const ex = { l: cr.left - sr.left - 24, r: cr.right - sr.left + 24, t: cr.top - sr.top - 22, b: cr.bottom - sr.top + 22 }
  const cols = W < 520 ? 2 : W < 860 ? 4 : 6, rows = Math.max(5, Math.round(H / 54))
  const cells: Array<[number, number]> = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * W, y = ((r + 0.5) / rows) * H
      if (!(x > ex.l && x < ex.r && y > ex.t && y < ex.b)) cells.push([x, y])
    }
  cells.slice(0, JARGON.length).forEach(([x, y], i) => {
    const el = document.createElement('span')
    el.className = 'word' + (i % 7 === 0 ? ' big' : '')
    el.textContent = JARGON[i]
    el.style.transform = `translate(-50%,-50%) rotate(${((i * 13) % 13) - 6}deg)`
    cloud.appendChild(el)
    const w = el.offsetWidth, jx = (((i * 37) % 11) - 5) * 3, jy = (((i * 53) % 9) - 4) * 2
    let cx = Math.min(W - w / 2 - 10, Math.max(w / 2 + 10, x + jx))
    if (cx + w / 2 > ex.l && cx - w / 2 < ex.r && y + 16 > ex.t && y - 16 < ex.b)
      cx = x < (ex.l + ex.r) / 2 ? Math.max(w / 2 + 10, ex.l - w / 2) : Math.min(W - w / 2 - 10, ex.r + w / 2)
    el.style.left = cx + 'px'
    el.style.top = y + jy + 'px'
  })
}

function Jargon() {
  const [done, setDone] = useState(false)
  const stage = useRef<HTMLDivElement>(null), cloud = useRef<HTMLDivElement>(null), center = useRef<HTMLDivElement>(null)
  const draw = useCallback(() => {
    if (stage.current && cloud.current && center.current) scatter(stage.current, cloud.current, center.current)
  }, [])
  useLayoutEffect(() => {
    if (done) return
    draw()
    let t: ReturnType<typeof setTimeout> | undefined
    const onResize = () => {
      clearTimeout(t)
      t = setTimeout(draw, 200)
    }
    addEventListener('resize', onResize)
    return () => {
      clearTimeout(t)
      removeEventListener('resize', onResize)
    }
  }, [done, draw])
  useEffect(() => {
    if (!done && cloud.current) cloud.current.querySelectorAll<HTMLElement>('.word').forEach((w) => w.classList.remove('gone'))
  }, [done])
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const simplify = () => {
    cloud.current?.querySelectorAll<HTMLElement>('.word').forEach((el, i) => {
      const a = (i / JARGON.length) * Math.PI * 2, d = 900 + (i % 5) * 120
      el.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d}px) rotate(${(i % 2 ? 1 : -1) * 160}deg)`
      el.classList.add('gone')
    })
    timer.current = setTimeout(() => setDone(true), reduceMotion() ? 0 : 520)
  }
  return (
    <section className={`band jargon${done ? ' done' : ''}`} id="simple" aria-labelledby="j-h">
      <div className="wrap">
        <p className="eyebrow">Everyone else</p>
        <h2 className="h2" id="j-h">
          Agent money shouldn’t need a <span className="pill">manual.</span>
        </h2>
        <p className="lede">
          This market is brand new. Most people have never handed an AI agent money, and the first thing they meet is a
          wall of jargon. So they close the tab. We think you should be paying with your agent in minutes, with nothing to
          learn first.
        </p>
        <div className="stage" id="stage" ref={stage}>
          <div className="cloud" id="cloud" aria-hidden="true" ref={cloud} />
          <div className="center" ref={center}>
            <p className="q">This is what they hand you.</p>
            <button className="btn hot" id="simplify" type="button" onClick={simplify}>
              Make it simple
            </button>
          </div>
          <div className="simple" aria-live="polite">
            <div className="steps3">
              <div className="s3">
                <span className="n">1</span>
                <b>Sign up.</b>
                <p>Your phone number, a code and a passcode.</p>
              </div>
              <div className="s3">
                <span className="n">2</span>
                <b>Open an account.</b>
                <p>Personal or business. Fiat, crypto or both.</p>
              </div>
              <div className="s3">
                <span className="n">3</span>
                <b>Give your agent a card.</b>
                <p>Name it, set its limits. It gets to work.</p>
              </div>
            </div>
            <div className="after">
              <p className="big">That’s the whole manual.</p>
              <button className="again" id="again" type="button" onClick={() => setDone(false)}>
                Show me their version again
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── The one-minute how-to ────────────────────────────────────────────────────────────────────────

const STEPS: Array<{ t: number; title: string; body: string }> = [
  { t: 0, title: 'Sign up with your phone.', body: 'Number, the code we text you, a passcode.' },
  { t: 12, title: 'Open your account.', body: 'Personal or business. Fiat, crypto or both. Turn on Face ID.' },
  { t: 31.5, title: 'Give your agent a card.', body: 'Pick a helper, name it, set what it can spend. Create.' },
  { t: 44.5, title: 'Stay in charge.', body: 'It asks before anything outside the rules. One tap pauses every agent.' },
]

function HowTo({ playRef }: { playRef: React.MutableRefObject<(t: number | null) => void> }) {
  const vid = useRef<HTMLVideoElement>(null), film = useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState({ t: 0, d: 63 })
  const playFrom = useCallback((t: number | null) => {
    const v = vid.current
    if (!v) return
    const go = () => {
      try {
        if (t != null) v.currentTime = t
      } catch {
        /* not seekable yet */
      }
      v.play()?.catch(() => {})
    }
    if (v.readyState >= 1) go()
    else {
      v.preload = 'auto'
      v.addEventListener('loadedmetadata', go, { once: true })
      v.load()
    }
  }, [])
  playRef.current = playFrom
  useEffect(() => {
    const el = film.current, v = vid.current
    if (!el || !v || typeof IntersectionObserver !== 'function' || reduceMotion()) return
    let once = false
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting && !once) {
            once = true
            playFrom(null)
          } else if (!e.isIntersecting && !v.paused) v.pause()
        }),
      { threshold: 0.55 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [playFrom])
  return (
    <section className="band how" id="how" aria-labelledby="h-h">
      <div className="wrap">
        <p className="eyebrow">How it works</p>
        <h2 className="h2" id="h-h">
          One minute. <span className="pill">The whole app.</span>
        </h2>
        <p className="lede">
          The new Talyvor phone app, start to finish. Sign up, open an account, give an agent its own card, approve a
          payment and stop everything. Press a step to jump to it.
        </p>
        <div className="grid">
          <div className={`film${playing ? ' playing' : ''}`} id="film" ref={film}>
            <video
              id="howvid"
              ref={vid}
              src={`${MEDIA}/how-it-works.mp4`}
              poster={`${MEDIA}/how-it-works-poster.jpg`}
              muted
              playsInline
              preload="metadata"
              aria-label="One-minute walkthrough of the Talyvor phone app"
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={(e) => (e.currentTarget.paused ? e.currentTarget.play()?.catch(() => {}) : e.currentTarget.pause())}
              onTimeUpdate={(e) => setTime({ t: e.currentTarget.currentTime, d: e.currentTarget.duration || 63 })}
            />
            <button className="play" id="playbtn" type="button" aria-label="Play the how-to video" onClick={() => playFrom(null)}>
              <span>
                <PlayIcon />
              </span>
            </button>
          </div>
          <div>
            <ol id="steps">
              {STEPS.map((s, i) => {
                const a = s.t, b = i + 1 < STEPS.length ? STEPS[i + 1].t : time.d
                const on = time.t >= a && time.t < b
                const width = on ? Math.min(100, ((time.t - a) / (b - a)) * 100) : time.t >= b ? 100 : 0
                return (
                  <li key={s.t} data-t={s.t} className={on ? 'on' : undefined}>
                    <button type="button" onClick={() => playFrom(s.t)}>
                      <span className="n">{i + 1}</span>
                      <span>
                        <b>{s.title}</b>
                        <p>{s.body}</p>
                      </span>
                      <span className="bar">
                        <i style={{ width: `${width}%` }} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ol>
            <p className="note">Everything here runs in Sandbox, so you can try it all before any real money moves.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Try Penny ────────────────────────────────────────────────────────────────────────────────────

// Built, not written: deadClasses.test.ts reads a quoted "0 0 64 64" as a list of classes.
const FACE_ID_BOX = [0, 0, 64, 64].join(' ')
const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const START = 400

type Line = { id: number; name: string; amt: string; st: string; cls: string }
type Pending = { mode: 'pay' | 'resume'; name: string; a: number; facts: Array<[string, string]> }

const REQUESTS = [
  { p: 'Acme Hosting', a: 34, k: 'known', ic: 'AH', note: 'A payee you chose' },
  { p: 'Northwind Data', a: 180, k: 'known', ic: 'ND', note: 'Invoice 1042' },
  { p: 'Brightline Leads', a: 95, k: 'new', ic: 'BL', note: 'New payee' },
] as const

function Penny() {
  const [ask, setAsk] = useState(50)
  const [day, setDay] = useState(300)
  const [payees, setPayees] = useState(true)
  const [nights, setNights] = useState(false)
  const [paused, setPaused] = useState(false)
  const [bal, setBal] = useState(START)
  const [spent, setSpent] = useState(0)
  const [shown, setShown] = useState(START)
  // None until the first payment, and again after Start over, as index.html's statement does.
  const [lines, setLines] = useState<Line[] | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [faceid, setFaceid] = useState<'off' | 'scan' | 'ok'>('off')
  const busy = useRef(false), opener = useRef<HTMLElement | null>(null), approveBtn = useRef<HTMLButtonElement>(null)
  const nextId = useRef(0), shownRef = useRef(START), frame = useRef(0), timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current)
      timers.current.forEach(clearTimeout)
      document.documentElement.style.overflow = ''
    },
    [],
  )

  const roll = (to: number) => {
    const from = shownRef.current, t0 = performance.now(), dur = reduceMotion() ? 1 : 700
    shownRef.current = to
    cancelAnimationFrame(frame.current)
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3)
      setShown(from + (to - from) * e)
      if (k < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }
  const line = (name: string, amt: string, st: string, cls: string) =>
    setLines((ls) => [{ id: nextId.current++, name, amt, st, cls }, ...(ls ?? [])].slice(0, 6))
  // The latest balance and spend, for the approval that lands after the Face ID pause.
  const balRef = useRef(START), spentRef = useRef(0)
  balRef.current = bal
  spentRef.current = spent
  const pay = (name: string, a: number, how: 'own' | 'you') => {
    const left = balRef.current - a
    balRef.current = left
    spentRef.current += a
    setBal(left)
    setSpent(spentRef.current)
    roll(left)
    line(name, '−' + fmt(a), how === 'own' ? 'Paid on its own' : 'You approved', how === 'own' ? 'st-ok' : 'st-you')
  }

  const open = (p: Pending) => {
    opener.current = document.activeElement as HTMLElement | null
    document.documentElement.style.overflow = 'hidden'
    setFaceid('off')
    setPending(p)
  }
  useEffect(() => {
    if (pending) approveBtn.current?.focus({ preventScroll: true })
  }, [pending])
  const close = useCallback(() => {
    document.documentElement.style.overflow = ''
    setPending(null)
    setFaceid('off')
    busy.current = false
    opener.current?.focus?.({ preventScroll: true })
  }, [])
  const dismiss = useCallback(
    (label: string) => {
      if (busy.current || !pending) return
      if (pending.mode !== 'resume') line(pending.name, fmt(pending.a), label, label === 'You declined' ? 'st-no' : 'st-you')
      close()
    },
    [pending, close],
  )
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss('You declined')
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [pending, dismiss])

  const request = (name: string, a: number, isNew: boolean) => {
    if (paused) return line(name, fmt(a), 'Stopped, Penny is paused', 'st-no')
    if (a > bal) return line(name, fmt(a), 'Not enough in Penny’s account', 'st-no')
    const why: string[] = []
    if (a > ask) why.push(`Above your ${'$' + ask} line`)
    if (spent + a > day) why.push(`Over the ${'$' + day} daily limit`)
    if (isNew && payees) why.push('A payee you haven’t chosen')
    if (nights) why.push('Nights off is on')
    if (!why.length) return pay(name, a, 'own')
    open({ mode: 'pay', name, a, facts: [['To', name], ['Amount', fmt(a)], ['Why it asks', why.join('. ')], ['Paid from', 'Penny’s account, ' + fmt(bal)]] })
  }
  const resume = () => {
    setPaused(false)
    line('Every agent', '', 'Resumed with Face ID', 'st-ok')
  }
  const approve = () => {
    if (busy.current || !pending) return
    busy.current = true
    const p = pending
    const quick = reduceMotion()
    setFaceid('scan')
    timers.current.push(
      setTimeout(() => {
        setFaceid('ok')
        timers.current.push(
          setTimeout(() => {
            if (p.mode === 'resume') resume()
            else pay(p.name, p.a, 'you')
            close()
          }, quick ? 0 : 480),
        )
      }, quick ? 0 : 850),
    )
  }
  const panic = () => {
    if (!paused) {
      setPaused(true)
      line('Every agent', '', 'Paused in one tap', 'st-no')
      return
    }
    open({ mode: 'resume', name: 'Resume every agent', a: 0, facts: [['What happens', 'Your agents can pay again inside their rules'], ['Why it asks', 'Resuming always asks you']] })
  }
  const reset = () => {
    setBal(START)
    setSpent(0)
    setPaused(false)
    setPending(null)
    roll(START)
    setLines(null)
  }
  const resuming = pending?.mode === 'resume'

  return (
    <section className={`band try${paused ? ' paused' : ''}`} id="try" aria-labelledby="t-h">
      <div className="wrap">
        <p className="eyebrow">Try it</p>
        <h2 className="h2" id="t-h">
          Press it. You’ll get it in <span className="pill">ten seconds.</span>
        </h2>
        <p className="lede">
          Meet Penny, a bookkeeping agent. Move her rules, send her some payments, then hit the big button. Everything here
          works the way the app does.
        </p>
        <div className="board">
          <div className="panel">
            <h3>
              Penny’s rules <span className="sandbox">Sandbox</span>
            </h3>
            <div className="rule">
              <label htmlFor="ask">
                Ask me above <output id="askv">${ask}</output>
              </label>
              <input id="ask" type="range" min={0} max={250} step={10} value={ask} onChange={(e) => setAsk(+e.target.value)} />
            </div>
            <div className="rule">
              <label htmlFor="day">
                Daily limit <output id="dayv">${day}</output>
              </label>
              <input id="day" type="range" min={50} max={1000} step={50} value={day} onChange={(e) => setDay(+e.target.value)} />
            </div>
            <button className="tog" id="payees" type="button" role="switch" aria-checked={payees} onClick={() => setPayees((v) => !v)}>
              <span>Only pay payees I chose</span>
              <span className="sw" aria-hidden="true" />
            </button>
            <button className="tog" id="hours" type="button" role="switch" aria-checked={nights} onClick={() => setNights((v) => !v)}>
              <span>Nights off, 8pm to 8am</span>
              <span className="sw" aria-hidden="true" />
            </button>
          </div>
          <div className="panel">
            <h3>Penny’s account</h3>
            <div className="agent">
              <span className="av" style={{ background: 'var(--mint)' }}>
                P
              </span>
              <span>
                <b>Penny</b>
                <small id="pstate">{paused ? 'Bookkeeping · Paused' : 'Bookkeeping · Running'}</small>
              </span>
            </div>
            <div className="money" id="bal">
              {fmt(shown)}
            </div>
            <div className="card">
              <span className="nm">Penny</span>
              <span className="row">
                <span>Virtual card</span>
                <span>•• 2048</span>
              </span>
              <span className="ice">Frozen</span>
            </div>
            <p style={{ margin: 0, fontWeight: 750 }}>Penny wants to pay</p>
            <div className="req" id="reqs">
              {REQUESTS.map((r) => (
                <button key={r.p} type="button" data-p={r.p} data-a={r.a} data-k={r.k} onClick={() => request(r.p, r.a, r.k === 'new')}>
                  <span className="ic">{r.ic}</span>
                  <span>
                    <b>{r.p}</b>
                    <small>{r.note}</small>
                  </span>
                  <span className="amt">{fmt(r.a)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="panel p3">
            <button className="panic" id="panic" type="button" onClick={panic}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="5" width="4" height="14" rx="1.5" />
                <rect x="14" y="5" width="4" height="14" rx="1.5" />
              </svg>
              <span id="panict">{paused ? 'Resume every agent' : 'Pause every agent'}</span>
            </button>
            <h3>
              Statement{' '}
              <button className="reset" id="reset" type="button" onClick={reset}>
                Start over
              </button>
            </h3>
            <div className="stmt" id="stmt" aria-live="polite">
              {lines === null ? (
                <div className="empty">Nothing yet. Send Penny a payment.</div>
              ) : (
                lines.map((l) => (
                  <div key={l.id} className="line">
                    <span>
                      <b>{l.name}</b>
                      <small className={l.cls}>{l.st}</small>
                    </span>
                    <span className="amt">{l.amt}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
      <div
        className={`sheet${pending ? ' on' : ''}`}
        id="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sh-h"
        onClick={(e) => {
          if (e.target === e.currentTarget) dismiss('Still waiting for you')
        }}
      >
        <div className="box">
          <h4 id="sh-h">{resuming ? 'Resume every agent?' : 'Penny wants to pay'}</h4>
          <div className="facts" id="facts">
            {pending?.facts.map(([k, v]) => (
              <div key={k} className="fact">
                <span>{k}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
          <div className={`faceid${faceid === 'ok' ? ' ok' : ''}`} id="faceid" style={{ display: faceid === 'off' ? 'none' : 'grid' }}>
            <svg viewBox={FACE_ID_BOX} aria-hidden="true">
              <path d="M8 20V12a4 4 0 0 1 4-4h8M44 8h8a4 4 0 0 1 4 4v8M56 44v8a4 4 0 0 1-4 4h-8M20 56h-8a4 4 0 0 1-4-4v-8" />
              <path className="f" d="M24 26v4M40 26v4M32 26v10h-3M25 44c4 3 10 3 14 0" />
            </svg>
            <span id="fidt">{faceid === 'ok' ? 'Done' : 'Face ID'}</span>
          </div>
          <button className="go" id="approve" type="button" ref={approveBtn} hidden={faceid !== 'off'} onClick={approve}>
            {resuming ? 'Resume with Face ID' : 'Approve with Face ID'}
          </button>
          <button className="no" id="decline" type="button" hidden={faceid !== 'off' || resuming} onClick={() => dismiss('You declined')}>
            Decline
          </button>
        </div>
      </div>
    </section>
  )
}

// ── Sliding switches (For everyone, Pricing) ─────────────────────────────────────────────────────

/** The orange indicator under the pressed button: placed after layout, again on resize and once the fonts are in. */
function useIndicator(group: React.RefObject<HTMLDivElement>, key: string) {
  const [style, setStyle] = useState<React.CSSProperties>({})
  useLayoutEffect(() => {
    const place = () => {
      const on = group.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')
      if (on) setStyle({ width: on.offsetWidth + 'px', transform: `translateX(${on.offsetLeft - 6}px)` })
    }
    place()
    addEventListener('resize', place)
    void document.fonts?.ready.then(place)
    return () => removeEventListener('resize', place)
  }, [group, key])
  return style
}

type Agent = [name: string, job: string, limit: string, pct: number, colour: string]
const WHO: Record<'p' | 'b', { h: string; t: string; a: Agent[] }> = {
  p: {
    h: 'Agents that work for you.',
    t: 'Your shopping agent, your travel agent, your research agent. Each gets its own account and card, and spends only inside the rules you set.',
    a: [['Juno', 'Travel', '€186 of €800 this month', 23, 'var(--sky)'], ['Scout', 'Research', '$214 of $1,000 this month', 21, 'var(--cobalt)'], ['Remy', 'Shopping', '$62 of $300 this month', 21, 'var(--orchid)'], ['Nova', 'Subscriptions', '$38 of $120 this month', 32, 'var(--rose)']],
  },
  b: {
    h: 'Agents that work for your company.',
    t: 'Sales, ads, bookkeeping, support. One account per agent, one statement per agent, one place to approve. Your team sees exactly who spent what.',
    a: [['Sunny', 'Sales', '$1,240 of $5,000 this month', 25, 'var(--lemon)'], ['Pixel', 'Ads', '£86 of £400 this month', 22, 'var(--lime)'], ['Penny', 'Bookkeeping', '$2,980 of $6,000 this month', 50, 'var(--mint)'], ['Max', 'Support', '$410 of $1,500 this month', 27, 'var(--tang)']],
  },
}

function Everyone() {
  const [k, setK] = useState<'p' | 'b'>('p')
  const group = useRef<HTMLDivElement>(null)
  const ind = useIndicator(group, k)
  const w = WHO[k]
  return (
    <section className="band who" id="everyone" aria-labelledby="w-h">
      <div className="wrap">
        <p className="eyebrow">For everyone</p>
        <h2 className="h2" id="w-h">
          Your shopping agent. Your company’s <span className="pill">agent army.</span>
        </h2>
        <div className="switch" role="group" aria-label="Account type" ref={group}>
          <span className="ind" id="wind" style={ind} />
          <button type="button" aria-pressed={k === 'p'} data-w="p" onClick={() => setK('p')}>
            Personal
          </button>
          <button type="button" aria-pressed={k === 'b'} data-w="b" onClick={() => setK('b')}>
            Business
          </button>
        </div>
        <div className="pane" id="wpane" key={k}>
          <div>
            <h3>{w.h}</h3>
            <p>{w.t}</p>
            <div className="kinds">
              <span className="chip">Fiat only</span>
              <span className="chip">Stablecoin and crypto only</span>
              <span className="chip">Hybrid, both side by side</span>
            </div>
          </div>
          <div className="agents">
            {w.a.map(([n, j, lim, pct, col]) => (
              <div key={n} className="ag">
                <div className="top">
                  <span className="av" style={{ background: col }}>
                    {n[0]}
                  </span>
                  <span>
                    <b>{n}</b>
                    <small>{j} · Running</small>
                  </span>
                </div>
                <div className="meter">
                  <i style={{ width: `${pct}%`, background: col }} />
                </div>
                <div className="lim">{lim}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function InsideClaude() {
  return (
    <section className="band cl" aria-labelledby="c-h">
      <div className="wrap grid">
        <div>
          <p className="eyebrow">Inside Claude</p>
          <h2 className="h2" id="c-h">
            Claude does the legwork. <span className="pill">You keep the final say.</span>
          </h2>
          <p className="lede">
            Add Talyvor to Claude through our connector and ask in plain words. Claude can show your agents and budgets and
            prepare a payment. It pays at once only what you’ve already signed for. Everything else waits for your passkey.
          </p>
        </div>
        <div className="chat" aria-label="Example conversation">
          <p className="b me">Pay Northwind Data $180 for invoice 1042</p>
          <p className="b ai">I’ve prepared it. It’s waiting in Talyvor for your approval.</p>
          <div className="wait">
            <small>Waiting for you</small>
            <span style={{ fontWeight: 700 }}>Northwind Data</span>
            <span className="m">$180.00</span>
            <span className="go">Approve with your passkey</span>
          </div>
        </div>
      </div>
    </section>
  )
}

const VS: Array<[string, string, string]> = [
  ['Who it’s for', 'Developers', 'Anyone with a phone'],
  ['Getting started', 'Read the docs, install an SDK, wire up keys', 'Sign up with your phone number'],
  ['Giving an agent money', 'Integrate wallets through an API', 'Tap New agent'],
  ['A big payment', 'Build approvals into your own app', 'Face ID'],
  ['Something goes wrong', 'Revoke keys one by one', 'One tap pauses every agent'],
  ['Who spent what', 'Dig through logs', 'A statement for every agent'],
]

function TheUsualWay() {
  return (
    <section className="band vs" aria-labelledby="v-h">
      <div className="wrap">
        <p className="eyebrow">Us against the usual way</p>
        <h2 className="h2" id="v-h">
          They built it for engineers. <span className="pill">We built it for you.</span>
        </h2>
        <div className="table" role="table" aria-label="The usual way compared with Talyvor">
          <div className="tr" role="row">
            <div role="columnheader" />
            <div role="columnheader">The usual way</div>
            <div role="columnheader">Talyvor</div>
          </div>
          {VS.map(([h, usual, us]) => (
            <div key={h} className="tr" role="row">
              <div role="rowheader">{h}</div>
              <div role="cell">{usual}</div>
              <div role="cell">{us}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Pricing ──────────────────────────────────────────────────────────────────────────────────────

type Currency = 'usd' | 'gbp' | 'eur'
type Plan = [name: string, price: Record<Currency, number> | null, features: string[]]
/** Nick's 15 Nov plans, as index.html draws them. B64.3 renders these from Lens's public plan table instead. */
const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
const PLANS: Record<'people' | 'companies', Plan[]> = {
  people: [
    ['Solo', { usd: 0, gbp: 0, eur: 0 }, ['3 agents', 'Your own account', 'A card for every agent']],
    ['Crew', { usd: 3.99, gbp: 3.99, eur: 3.99 }, ['10 agents', 'Everything in Solo']],
    ['Fleet', { usd: 9.99, gbp: 7.99, eur: 8.99 }, ['25 agents', 'Everything in Crew']],
  ],
  companies: [
    ['Studio', { usd: 10, gbp: 10, eur: 10 }, ['3 agents', people(1), 'A statement for every agent']],
    ['Company', { usd: 35, gbp: 35, eur: 35 }, ['25 agents', people(5), 'Everything in Studio']],
    ['Group', { usd: 125, gbp: 125, eur: 125 }, ['Unlimited agents', people(25), 'Everything in Company']],
    ['Custom', null, ['Built with you', 'By contract', CONTACT_EMAIL]],
  ],
}
const SYM: Record<Currency, string> = { usd: '$', gbp: '£', eur: '€' }

function PriceText({ v, c }: { v: number | null; c: Currency }) {
  if (v === null) return <>Let’s talk</>
  if (v === 0) return <>Free</>
  return (
    <>
      {SYM[c] + (Number.isInteger(v) ? String(v) : v.toFixed(2))}
      <span> a month</span>
    </>
  )
}

function PricingBand() {
  const [k, setK] = useState<'people' | 'companies'>('people')
  const [c, setC] = useState<Currency>('usd')
  const group = useRef<HTMLDivElement>(null)
  const ind = useIndicator(group, k)
  return (
    <section className="band price" id="pricing" aria-labelledby="p-h">
      <div className="wrap">
        <p className="eyebrow">Pricing</p>
        <h2 className="h2" id="p-h">
          Start free. <span className="pill">Seriously.</span>
        </h2>
        <p className="lede">Three plans for people, three for companies, and one we build with you. While you’re in Sandbox, every plan costs nothing.</p>
        <div className="pbar">
          <div className="switch" role="group" aria-label="Plans for" ref={group}>
            <span className="ind" style={ind} />
            <button type="button" aria-pressed={k === 'people'} data-k="people" onClick={() => setK('people')}>
              For people
            </button>
            <button type="button" aria-pressed={k === 'companies'} data-k="companies" onClick={() => setK('companies')}>
              For companies
            </button>
          </div>
          <div className="cur" role="group" aria-label="Currency">
            {(['usd', 'gbp', 'eur'] as const).map((cur) => (
              <button key={cur} type="button" aria-pressed={c === cur} data-c={cur} onClick={() => setC(cur)}>
                {SYM[cur]}
              </button>
            ))}
          </div>
        </div>
        <div className="cards" id="plans" key={`${k}-${c}`}>
          {PLANS[k].map(([name, price, feats], i) => (
            <div key={name} className={i === 0 ? 'pc hot' : 'pc'} data-plan={name}>
              <small>{name}</small>
              <span className="p">
                <PriceText v={price ? price[c] : null} c={c} />
              </span>
              <ul>
                {feats.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function WhereWeAre() {
  return (
    <section className="band where" aria-labelledby="wh-h">
      <div className="wrap">
        <p className="eyebrow">Where we are</p>
        <h2 className="h2" id="wh-h">
          Built. Running. <span className="pill">Moving fast.</span>
        </h2>
        <div className="facts">
          <div className="f">
            <b>Built</b>
            <p>The phone app, the web app and the Claude connector. Accounts, cards, rules, approvals and statements.</p>
          </div>
          <div className="f">
            <b>Sandbox today</b>
            <p>Try every part of it now, before any real money moves.</p>
          </div>
          <div className="f">
            <b>Real money next</b>
            <p>It switches on with our launch partner, and early users go first.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function YourMove() {
  return (
    <section className="band final" aria-labelledby="f-h">
      <div className="wrap">
        <h2 className="huge" id="f-h">
          Your <span>move.</span>
        </h2>
        <p>Sign up, open an account, give your agent a card. We’re onboarding our first design partners now.</p>
        <div className="ctas">
          <a className="btn hot" href={SIGNUP}>
            Open your account
          </a>
          <a className="btn ghost" href="#try">
            Try Penny again
          </a>
        </div>
        <p className="mail">{CONTACT_EMAIL}</p>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer>
      <div className="wrap">
        <img src={`${MEDIA}/logo.svg`} alt="Talyvor" />
        <nav aria-label="Footer">
          <a href="#how">How it works</a>
          <a href="#try">Try it</a>
          <a href="#pricing">Pricing</a>
          <a href={SIGNUP}>Open an account</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
        <span data-company-line>{COMPANY_LINE}</span>
        <a href="https://aiagentsdirectory.com/agent/talyvor" target="_blank" rel="noopener" title="Discover Talyvor on AI Agents Directory">
          <img src={`${MEDIA}/aad-badge.svg`} alt="Talyvor - Featured on AI Agents Directory" width="200" height="50" style={{ width: 160, height: 'auto' }} />
        </a>
      </div>
    </footer>
  )
}

export function Landing() {
  // THE FRONT DOOR TAKES THE BRAND LINE — `null`, not a page name (documentTitle.test.tsx).
  useDocumentTitle(null)
  const root = useRef<HTMLDivElement>(null)
  useLoops(root)
  // index.html's html rules: smooth in-page scrolling and no sideways scroll, for as long as the page is up.
  useEffect(() => {
    const html = document.documentElement
    const before = { sb: html.style.scrollBehavior, ox: html.style.overflowX }
    html.style.scrollBehavior = 'smooth'
    html.style.overflowX = 'clip'
    return () => {
      html.style.scrollBehavior = before.sb
      html.style.overflowX = before.ox
    }
  }, [])
  const play = useRef<(t: number | null) => void>(() => {})
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div ref={root} className="tv4" data-site="v4">
      <style>{SITE_CSS}</style>
      <Nav />
      <main>
        <Hero
          onWatch={() => {
            timer.current = setTimeout(() => play.current(0), 500)
          }}
        />
        <Marquee />
        <Idea />
        <Jargon />
        <HowTo playRef={play} />
        <Penny />
        <Everyone />
        <InsideClaude />
        <TheUsualWay />
        <PricingBand />
        <WhereWeAre />
        <YourMove />
      </main>
      <Footer />
    </div>
  )
}
