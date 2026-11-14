/**
 * B57.1 — the words check and the layout check that pocket-shots runs on every screen it shoots.
 *
 * The same functions run in three places: in jsdom under vitest (src/test/shots.test.ts), and in a
 * real browser on the app and on the Pocket reference (scripts/pocket/shots.mjs passes them to
 * Playwright's `page.evaluate`). So `wordsOf`, `haystackOf` and `layoutProblems` are SELF-CONTAINED:
 * Playwright sends a function's source to the page, and a helper outside its body would not exist
 * there.
 */

/** One word on a screen: what kind of thing carries it, and the words themselves. */
export interface Word {
  kind: 'heading' | 'button' | 'tab' | 'chip' | 'label'
  text: string
}

/** apps/web/scripts/pocket/overrides.json: a B55 or B56 item's words replace the prototype's. */
export interface Override {
  screen: string
  prototype: string
  words: string
  item: string
}

/** Every heading, button, tab, chip and label showing under `root`, in document order. */
export function wordsOf(root: ParentNode): Word[] {
  const KINDS: [Word['kind'], string][] = [
    ['heading', 'h1, h2, h3, h4, h5, h6, [role="heading"]'],
    ['button', 'button, [role="button"]'],
    ['tab', '[role="tab"]'],
    ['chip', '.chip, .pill, .status, [data-chip]'],
    ['label', 'label, legend, .eyebrow'],
  ]
  const shown = (el: Element) => !el.closest('[hidden], [aria-hidden="true"]') && (typeof (el as HTMLElement).checkVisibility !== 'function' || (el as HTMLElement).checkVisibility())
  const out: Word[] = []
  const seen = new Set<string>()
  for (const [kind, sel] of KINDS) {
    for (const el of Array.from(root.querySelectorAll(sel))) {
      if (!shown(el)) continue
      const text = ((el.getAttribute('aria-label') || '').trim() || (el.textContent || '')).replace(/\s+/g, ' ').trim()
      if (!text || seen.has(text)) continue
      seen.add(text)
      out.push({ kind, text })
    }
  }
  return out
}

/** All the words a person can read or a screen reader can say under `root`, for the words check to search. */
export function haystackOf(root: ParentNode): string {
  const texts: string[] = []
  const doc = (root as Node).ownerDocument || (root as Document)
  const walk = doc.createTreeWalker(root as Node, 4 /* NodeFilter.SHOW_TEXT */)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const p = n.parentElement
    if (p && (p.closest('script, style, [hidden], [aria-hidden="true"]'))) continue
    texts.push(n.nodeValue || '')
  }
  const names = Array.from(root.querySelectorAll('[aria-label], [title], [placeholder], [alt]')).flatMap((el) =>
    ['aria-label', 'title', 'placeholder', 'alt'].map((a) => el.getAttribute(a) || ''),
  )
  // Joined twice: with nothing between text nodes ("$1,650" + ".00") and with a space between blocks.
  return [texts.join(''), texts.join(' '), names.join(' ')].join('\n')
}

/**
 * Words compared as a person reads them: spaces collapsed, curly quotes straight, case ignored, and
 * money dollars first (decision 1): an LXC figure beside a dollar one is the small print, so only the
 * dollars must match.
 */
export function normalise(s: string): string {
  return s
    .replace(/[  ]/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\(?\s*[−-]?[\d,.]+\s*LXC\s*\)?/g, (m) => (/\d/.test(m) ? ' ' : m))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,:;)])/g, '$1')
    .trim()
    .toLowerCase()
}

/**
 * The words check: every word on the reference screen must be on the app's, except where an override
 * gives a B55 or B56 item's words instead. Returns what is missing; empty means the check passes.
 */
export function wordsCheck(screen: string, reference: Word[], appHaystack: string, overrides: Override[] = []): string[] {
  const parts = screen.split('+')
  const mine = overrides.filter((o) => o.screen === screen || parts.includes(o.screen))
  const hay = normalise(appHaystack)
  const missing: string[] = []
  for (const w of reference) {
    const o = mine.find((x) => normalise(x.prototype) === normalise(w.text))
    const want = o ? o.words : w.text
    const n = normalise(want)
    if (n && !hay.includes(n)) missing.push(`${w.kind} “${want}”${o ? ` (${o.item})` : ''}`)
  }
  return missing
}

/**
 * The layout check at 390: no sideways scroll, no text past its box, no button or chip label on two
 * lines. Needs a real layout engine, so it runs in the browser; under jsdom every box is zero and it
 * finds nothing.
 */
export function layoutProblems(doc: Document): string[] {
  const win = doc.defaultView!
  const out: string[] = []
  const name = (el: Element) => `${el.tagName.toLowerCase()} “${(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60)}”`
  const root = doc.documentElement
  if (root.scrollWidth > root.clientWidth + 1) out.push(`the page scrolls sideways: ${root.scrollWidth}px wide in a ${root.clientWidth}px window`)
  const shown = (el: Element) => !el.closest('[hidden], [aria-hidden="true"]') && el.getClientRects().length > 0
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (!shown(el)) continue
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.nodeValue || '').trim())
    if (!own) continue
    const cs = win.getComputedStyle(el)
    // A box a pixel wide is text kept for screen readers only (sr-only), not text past its box.
    if (cs.display !== 'inline' && (el.clientWidth <= 1 || el.clientHeight <= 1)) continue
    if (cs.display !== 'inline' && cs.textOverflow !== 'ellipsis' && el.scrollWidth > el.clientWidth + 1) {
      out.push(`text past its box: ${name(el)}`)
      continue
    }
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType !== 3 || !(n.nodeValue || '').trim()) continue
      const r = doc.createRange()
      r.selectNodeContents(n)
      const box = r.getBoundingClientRect()
      if (box.right > root.clientWidth + 1) {
        out.push(`text past the window's edge: ${name(el)}`)
        break
      }
    }
  }
  for (const el of Array.from(doc.body.querySelectorAll('button, [role="button"], [role="tab"], .chip, .pill, .status, [data-chip]'))) {
    if (!shown(el)) continue
    const lines: number[] = []
    const walk = doc.createTreeWalker(el, 4)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!(n.nodeValue || '').trim()) continue
      const r = doc.createRange()
      r.selectNodeContents(n)
      for (const rect of Array.from(r.getClientRects())) {
        if (rect.width && !lines.some((top) => Math.abs(top - rect.top) < rect.height / 2)) lines.push(rect.top)
      }
    }
    if (lines.length > 1) out.push(`a label on ${lines.length} lines: ${name(el)}`)
  }
  return out
}

/** What pressEverything and pocket-shots press: every button, link, tab, switch and menu item showing. */
export function controlsOf(root: ParentNode): HTMLElement[] {
  const sel = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="switch"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], input[type="checkbox"], input[type="radio"]'
  return Array.from(root.querySelectorAll<HTMLElement>(sel)).filter(
    (el) => !el.closest('[hidden], [aria-hidden="true"], [inert]') && (typeof el.checkVisibility !== 'function' || el.checkVisibility()),
  )
}

/** A control's name as a person hears it, for the report. */
export function controlName(el: Element): string {
  const words = ((el.getAttribute('aria-label') || '').trim() || (el.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 60)
  return `${el.getAttribute('role') || el.tagName.toLowerCase()} “${words}”`
}

/**
 * Why a control is not pressed, or '' to press it: a link that leaves the app (another site, a new tab,
 * a download, mail), the link to the page you are on, the tab that is on, or a disabled control, which passes only when it
 * says why in words beside it (its aria-describedby, or words in a box it has to itself).
 */
export function notPressed(el: HTMLElement): string {
  const doc = el.ownerDocument
  if (el.matches('a[href]')) {
    const a = el as HTMLAnchorElement
    if (a.target === '_blank' || a.hasAttribute('download') || /^(mailto|tel):/.test(a.href) || new URL(a.href, doc.baseURI).origin !== doc.location.origin) return 'leaves the app'
    if (a.getAttribute('aria-current') === 'page' || a.href === doc.location.href) return 'the page you are on'
  }
  // B57.4 — the tab that is on is the tab you are on, as the reference draws it (a.tab.on): pressing it again is no press.
  if (el.getAttribute('role') === 'tab' && el.getAttribute('aria-selected') === 'true') return 'the tab you are on'
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') {
    const own = (el.textContent || '').replace(/\s+/g, ' ').trim()
    const described = (el.getAttribute('aria-describedby') || '').split(/\s+/).map((id) => (id && doc.getElementById(id)?.textContent) || '').join('').trim()
    // Words in the same box, when the box holds no other control whose words they could be.
    const box = el.parentElement
    const alone = box && box.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="tab"]').length === 1
    const beside = alone ? (box.textContent || '').replace(/\s+/g, ' ').trim().replace(own, '').trim() : ''
    return described || beside ? 'disabled, and says why' : 'DISABLED WITHOUT SAYING WHY'
  }
  return ''
}

/**
 * What a press can change: the address, the dialogs open, the messages shown, every switch's state, the page's
 * theme, and the controls on offer (an inline "Pause Research?" with its own buttons is a press answered).
 */
export function pressState(doc: Document): string {
  const states = Array.from(doc.querySelectorAll<HTMLInputElement>('[aria-checked], [aria-pressed], [aria-expanded], [aria-selected], input[type="checkbox"], input[type="radio"]')).map((el) =>
    ['aria-checked', 'aria-pressed', 'aria-expanded', 'aria-selected'].map((a) => el.getAttribute(a)).join() + (el.checked ? '+' : ''),
  )
  const messages = Array.from(doc.querySelectorAll('[role="status"], [role="alert"]')).map((el) => el.textContent)
  const dialogs = doc.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog[open]').length
  const offered = Array.from(doc.querySelectorAll('button, a[href], [role="button"], input, select, textarea')).map((el) => el.getAttribute('aria-label') || el.textContent)
  const theme = doc.documentElement.className + JSON.stringify(doc.documentElement.dataset)
  return JSON.stringify({ href: doc.location.href, dialogs, messages, states, offered, theme })
}

/**
 * B57.58 — the contrast check: every piece of text showing, against what is behind it, at 4.5:1 or better, and the
 * edge of every field and switch against the box it sits in at 3:1. Self-contained like layoutProblems, and like it
 * needs a real browser: jsdom reads only inline styles, so under vitest it checks what a test paints by hand.
 *
 * What is behind a piece of text is its own background laid over its parents', up to the first one that is solid.
 * A disabled control's words are not held to it (WCAG's inactive components); a background picture cannot be read,
 * so text over one is passed by.
 */
export function contrastProblems(doc: Document): string[] {
  const win = doc.defaultView!
  type RGBA = [number, number, number, number]
  let ctx: CanvasRenderingContext2D | null | undefined
  const parse = (c: string): RGBA => {
    if (!c || c === 'transparent') return [0, 0, 0, 0]
    const m = /^rgba?\(([^)]+)\)$/.exec(c.trim())
    if (m) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map((x) => (x.endsWith('%') ? parseFloat(x) / 100 : parseFloat(x)))
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
    }
    const s = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.e-]+%?))?\)$/.exec(c.trim())
    if (s) return [+s[1] * 255, +s[2] * 255, +s[3] * 255, s[4] === undefined ? 1 : s[4].endsWith('%') ? parseFloat(s[4]) / 100 : +s[4]]
    // Any other way of writing a colour (oklch, color-mix): let the browser paint it and read the pixel.
    if (ctx === undefined) {
      // jsdom has no canvas to paint on, and says so loudly.
      if (/jsdom/.test(win.navigator.userAgent)) ctx = null
      else try {
        const canvas = doc.createElement('canvas')
        canvas.width = canvas.height = 1
        ctx = typeof canvas.getContext === 'function' ? canvas.getContext('2d', { willReadFrequently: true }) : null
      } catch {
        ctx = null
      }
    }
    if (!ctx) return [0, 0, 0, 0]
    ctx.clearRect(0, 0, 1, 1)
    ctx.fillStyle = c
    ctx.fillRect(0, 0, 1, 1)
    const d = ctx.getImageData(0, 0, 1, 1).data
    return [d[0], d[1], d[2], d[3] / 255]
  }
  const over = (top: RGBA, under: RGBA): RGBA => {
    const a = top[3] + under[3] * (1 - top[3])
    if (!a) return [0, 0, 0, 0]
    return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a) as RGBA
  }
  const lum = (c: RGBA) => {
    const [r, g, b] = [0, 1, 2].map((i) => {
      const v = c[i] / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (a: RGBA, b: RGBA) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  }
  const hex = (c: RGBA) => '#' + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, '0')).join('').toUpperCase()
  const name = (el: Element) => `${el.tagName.toLowerCase()} “${(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 60)}”`
  // The page's own canvas, when nothing on the page paints one: the browser's, which follows color-scheme.
  const canvasColour: RGBA = /dark/.test(win.getComputedStyle(doc.documentElement).colorScheme || '') ? [18, 18, 18, 1] : [255, 255, 255, 1]
  /** What is painted behind `el`, or null when a picture is part of it. */
  const behind = (el: Element | null): RGBA | null => {
    const layers: RGBA[] = []
    for (let e = el; e; e = e.parentElement) {
      const cs = win.getComputedStyle(e)
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null
      const c = parse(cs.backgroundColor || 'rgba(0, 0, 0, 0)')
      if (c[3] > 0) layers.push(c)
      if (c[3] >= 1) break
    }
    return layers.reduceRight((under, top) => over(top, under), canvasColour)
  }
  const opacity = (el: Element) => {
    let o = 1
    for (let e: Element | null = el; e; e = e.parentElement) o *= parseFloat(win.getComputedStyle(e).opacity || '1')
    return o
  }
  const shown = (el: Element) => !el.closest('[hidden], [aria-hidden="true"]') && (typeof (el as HTMLElement).checkVisibility !== 'function' || (el as HTMLElement).checkVisibility())
  // A box a pixel wide is kept for screen readers only (sr-only). jsdom lays nothing out, so there every box is unmeasured.
  const tiny = (el: Element) => el.getClientRects().length > 0 && ((el as HTMLElement).offsetWidth <= 1 || (el as HTMLElement).offsetHeight <= 1)
  const out = new Set<string>()
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (el.closest('script, style, svg, option, [role="img"], [disabled], [aria-disabled="true"]') || !shown(el)) continue
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.nodeValue || '').trim())) continue
    const cs = win.getComputedStyle(el)
    if (cs.visibility === 'hidden' || (cs.display !== 'inline' && tiny(el))) continue
    const bg = behind(el)
    if (!bg) continue
    const fg = parse(cs.color)
    const a = fg[3] * opacity(el)
    if (!a) continue
    const r = ratio(over([fg[0], fg[1], fg[2], a], bg), bg)
    if (r < 4.5) out.add(`text at ${r.toFixed(2)}:1: ${name(el)} (${hex(over([fg[0], fg[1], fg[2], a], bg))} on ${hex(bg)})`)
  }
  /** How well a box's edge stands off what it sits on: its ring (Pocket's shadow-edge), its border, or its own fill. */
  const edgeOf = (box: Element): { r: number; edge: RGBA; outside: RGBA; drawn: boolean } | null => {
    const cs = win.getComputedStyle(box)
    const outside = behind(box.parentElement)
    const inside = behind(box)
    if (!outside || !inside) return null
    const ring = (cs.boxShadow || '')
      .split(/,(?![^(]*\))/)
      .map((x) => x.trim())
      .find((x) => /\binset\b/.test(x) && parseFloat((x.replace(/^\S+\([^)]*\)/, '').match(/-?[\d.]+px/g) || [])[3] || '0') > 0)
    const border = parseFloat(cs.borderTopWidth || '0') > 0 && cs.borderTopStyle !== 'none'
    const edge = ring ? over(parse((ring.match(/^\S+\([^)]*\)|^#\w+/) || ['transparent'])[0]), inside) : border ? over(parse(cs.borderTopColor), outside) : inside
    return { r: Math.max(ratio(edge, outside), ratio(inside, outside)), edge, outside, drawn: !!ring || border }
  }
  const fields = 'input:not([type="hidden"]), select, textarea, [role="switch"], [role="checkbox"], [role="radio"]'
  for (const el of Array.from(doc.body.querySelectorAll(fields))) {
    if (el.closest('[disabled], [aria-disabled="true"]') || (el as HTMLInputElement).disabled || !shown(el) || tiny(el)) continue
    const fcs = win.getComputedStyle(el)
    if (fcs.opacity === '0') continue
    // A checkbox or radio the browser draws itself draws its own edge, for the page's color-scheme.
    if (el.matches('input[type="checkbox"], input[type="radio"]') && (fcs.appearance || 'auto') !== 'none') continue
    // A file field is its button (::file-selector-button), which no element carries to read.
    if (el.matches('input[type="file"]')) continue
    const own = edgeOf(el)
    if (!own || own.r >= 3) continue
    // Pocket's field is a ringed box the input sits in borderless (Field.tsx): the box's edge is the field's.
    const box = el.parentElement
    const wrapper = box && box.querySelectorAll(fields).length === 1 ? edgeOf(box) : null
    if (wrapper?.drawn && wrapper.r >= 3) continue
    out.add(`a control's edge at ${own.r.toFixed(2)}:1: ${name(el)} (${hex(own.edge)} on ${hex(own.outside)})`)
  }
  return [...out]
}
