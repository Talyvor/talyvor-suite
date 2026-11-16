#!/usr/bin/env node
/**
 * B57.1 — pocket-shots: the app beside the Pocket reference, for every Pocket item.
 *
 *   pnpm --filter @talyvor/web pocket:shots <item> <checks.json>
 *   pnpm --filter @talyvor/web pocket:shots <item> --dark [checks.json] [--no-press]
 *
 * B57.58 — --dark shoots every check in dark, and with no checks file every route it knows (scripts/pocket/routes.ts),
 * and every dark shot also runs the contrast check: every text pair at 4.5:1, every field's and switch's edge at 3:1.
 * --no-press leaves out the press check, which opens a fresh page for each control and is most of the time a sweep takes.
 *
 *   pnpm --filter @talyvor/web pocket:shots <item> --pixels [checks.json]
 *
 * B61.98 — --pixels is the contrast check on the real pixels, over the moving background: each check (with no checks file,
 * routes.ts's BACKGROUND_PAGES: the seven sidebar pages, sign-in, sign-up and welcome) in light and dark at both sizes,
 * with the background frozen at 0, 4, 8 and 12 s (its CSS animations paused at that time, the streams' canvas drawn by a
 * paused clock run on to it). At each moment the window is shot twice, as it is and with every text drawn clear, and
 * every line of text in the window is held to 4.5:1 (3:1 large) against the pixels behind it (pocketCheck's
 * pixelContrastProblems). It writes the 0 s frame of each, as <name>-pixels[-dark]-<size>.png, and needs no reference.
 *
 * checks.json is a list of { route, screen, steps?, dark?, frame?, answers?, state? }: the app's address, the reference's screen id
 * (README.md's tables; leave it out for a page with no reference, such as the story page), the words or aria-labels to press in the app to reach the screen as a person would
 * (w-home+sheet-A is reached by pressing "Review"), whether to shoot it dark, and whether the reference is only the
 * dialog's frame over its page (B57.5: a dialog on the story page, beside the reference's dialog without its page),
 * and what to answer instead of the sample for some addresses, by path (B57.49: /auth/me signed out for /signup), and
 * the reference's state to set before its shot (B57.116: { "pr": 1, "nw": 0 } shows a prepared payment), and whether the
 * browser has an authenticator that says yes (B57.103: "authenticator": true makes a passkey, and signs with the one it holds).
 *
 * It builds the app once, serves dist with every /api and /auth request answered from scripts/pocket/sample.ts,
 * and for each check shoots the app at 1440x900 and 390x844 with the reference beside it, into
 * docs/pr-screenshots/<item>/<screen>-1440.png and <screen>-390.png (app left, reference right). Then the
 * checks, each of which fails the run:
 *   · the words check, at both sizes: every heading, button, tab, chip and label on the reference screen is on
 *     the app's, or overrides.json gives a B55 or B56 item's words instead;
 *   · the layout check, at 390: no sideways scroll, no text past its box, no button or chip label wrapping;
 *   · the press check, at 1440: every control on the screen does something (as src/test/pressEverything.ts).
 * It also builds the component story page (scripts/pocket/story) outside dist, at /__pocket-story/.
 *
 * The reference folder is POCKET_REFERENCE, default ~/talyvor-queue/design/pocket.
 */
import { generateKeyPairSync } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { build, createServer } from 'vite'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const REPO = resolve(WEB, '../..')
const DIST = join(WEB, 'dist')
const STORY = join(WEB, '.pocket-story')
const REFERENCE = resolve(process.env.POCKET_REFERENCE || join(homedir(), 'talyvor-queue/design/pocket'))
const SIZES = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }

const args = process.argv.slice(2)
const DARK = args.includes('--dark')
const PRESS = !args.includes('--no-press')
const PIXELS = args.includes('--pixels')
const [item, checksArg] = args.filter((a) => !a.startsWith('--'))
if (!item || (!checksArg && !DARK && !PIXELS) || !/^[\w.-]+$/.test(item)) {
  console.error('usage: pnpm --filter @talyvor/web pocket:shots <item> <checks.json> | <item> --dark [checks.json] [--no-press] | <item> --pixels [checks.json]')
  process.exit(2)
}
if (!PIXELS && !existsSync(join(REFERENCE, 'index.html'))) {
  console.error(`no Pocket reference at ${REFERENCE}: set POCKET_REFERENCE`)
  process.exit(2)
}
const overrides = JSON.parse(await readFile(join(WEB, 'scripts/pocket/overrides.json'), 'utf8'))

// The sample and the checks are TypeScript the app's own imports resolve; vite loads them as it does in a build.
const loader = await createServer({ root: WEB, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } })
const { sampleBodyFor, sampleReset, SAMPLE_NOW, SAMPLE_TIME_ZONE } = await loader.ssrLoadModule('/scripts/pocket/sample.ts')
const check = await loader.ssrLoadModule('/src/test/pocketCheck.ts')
const { SHOT_ROUTES, BACKGROUND_PAGES } = await loader.ssrLoadModule('/scripts/pocket/routes.ts')
// pnpm runs the script in apps/web; a relative path means where the person typed it.
const fallback = PIXELS ? BACKGROUND_PAGES : Object.values(SHOT_ROUTES).map((route) => ({ route }))
const checks = (checksArg ? JSON.parse(await readFile(resolve(process.env.INIT_CWD || process.cwd(), checksArg), 'utf8')) : fallback).map(
  (c) => (DARK ? { ...c, dark: true } : c),
)
await loader.close()

console.log('building the app and the story page…')
await build({ root: WEB, logLevel: 'warn' })
await build({ root: WEB, logLevel: 'warn', base: '/__pocket-story/', build: { outDir: STORY, emptyOutDir: true, rollupOptions: { input: join(WEB, 'scripts/pocket/story/index.html') } } })

const unanswered = new Set()
const server = createHttpServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (path.startsWith('/api/') || path.startsWith('/auth/')) {
    // A write is answered with what a read of the same address returns: enough for a press to be seen to send.
    const body = sampleBodyFor(req.url)
    if (body === undefined) unanswered.add(`${req.method} ${req.url}`)
    res.writeHead(body === undefined ? 404 : 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? null))
    return
  }
  const story = path.startsWith('/__pocket-story/')
  const root = story ? STORY : DIST
  const rel = story ? path.slice('/__pocket-story'.length) : path
  let file = join(root, rel)
  if (!file.startsWith(root) || !extname(file) || !existsSync(file)) file = story ? join(STORY, 'scripts/pocket/story/index.html') : join(DIST, 'index.html')
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' })
  res.end(await readFile(file))
})
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const BASE = `http://127.0.0.1:${server.address().port}`

const OUT = join(REPO, 'docs/pr-screenshots', item)
await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
const failures = []

/** Count requests in flight on a page, so a step or a press is read after it settles. */
function tracker(page) {
  const t = { inflight: 0, sent: 0 }
  page.on('request', () => (t.inflight++, t.sent++))
  page.on('requestfinished', () => t.inflight--)
  page.on('requestfailed', () => t.inflight--)
  return t
}
async function settle(page, t) {
  for (let quiet = 0, i = 0; quiet < 3 && i < 50; i++) {
    await page.waitForTimeout(100)
    quiet = t.inflight === 0 ? quiet + 1 : 0
  }
}

/** Press a control by its words or aria-label, as a person would. */
async function press(page, words) {
  const opts = { name: words, exact: true }
  const loc = ['button', 'link', 'tab', 'switch', 'menuitem'].map((role) => page.getByRole(role, opts)).reduce((a, b) => a.or(b))
  await loc.first().click({ timeout: 5000 })
}

/** The app at `route` after `steps`, in a fresh page at `size`. */
async function openApp(c, size, { clock = false } = {}) {
  sampleReset()
  const ctx = await browser.newContext({ viewport: size, timezoneId: SAMPLE_TIME_ZONE, colorScheme: c.dark ? 'dark' : 'light' })
  const page = await ctx.newPage()
  if (clock) {
    // B61.98 — a clock the check can stop and run on (the streams draw on its frames), and the same streams every run.
    await page.clock.install({ time: new Date(SAMPLE_NOW) })
    await page.addInitScript(() => {
      let s = 0x5eed
      Math.random = () => {
        s = (s + 0x6d2b79f5) | 0
        let r = Math.imul(s ^ (s >>> 15), 1 | s)
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296
      }
    })
  } else await page.clock.setFixedTime(new Date(SAMPLE_NOW))
  const t = tracker(page)
  if (c.answers) {
    await page.route(
      (url) => url.pathname in c.answers,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c.answers[new URL(route.request().url()).pathname]) }),
    )
  }
  // B57.103 — Face ID that says yes, holding one passkey of its own. WebAuthn takes no IP address, so the page is at localhost.
  if (c.authenticator) {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('WebAuthn.enable')
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    })
    const privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')
    const id = Buffer.from('shots').toString('base64')
    await cdp.send('WebAuthn.addCredential', { authenticatorId, credential: { credentialId: id, isResidentCredential: true, rpId: 'localhost', privateKey, userHandle: id, signCount: 0 } })
  }
  await page.goto((c.authenticator ? BASE.replace('127.0.0.1', 'localhost') : BASE) + c.route)
  await settle(page, t)
  let missed = ''
  for (const step of c.steps || []) {
    try {
      await press(page, step)
    } catch {
      missed = `there is nothing to press called “${step}”`
      break
    }
    await settle(page, t)
  }
  return { ctx, page, t, missed }
}

/** The reference screen, opened by its id, as its own words and a picture. */
async function reference(c) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('file://' + join(REFERENCE, 'index.html'))
  await page.waitForFunction(() => window.__proto)
  await page.evaluate((s) => window.__proto.open(s), c.screen)
  if ((await page.evaluate(() => window.__proto.current())) !== c.screen) throw new Error(`the reference has no screen ${c.screen}`)
  // B57.116 — a row the reference hides until its state is set (w-approvals' prepared payment is pr=1, nw=0).
  if (c.state) await page.evaluate((st) => window.__proto.setState(st), c.state)
  if (c.dark) await page.evaluate(() => document.querySelectorAll('#proto .phold .pk').forEach((el) => el.classList.replace('pk-light', 'pk-dark') || el.classList.add('pk-dark')))
  await page.waitForTimeout(300)
  const hold = page.locator(c.frame ? '#proto .phold .scrim > *' : '#proto .phold > *').first()
  // The viewer scrolls a tall screen inside its stage; a window taller than the screen shows it whole.
  const box = await hold.boundingBox()
  await page.setViewportSize({ width: 1440, height: Math.ceil(box.y + box.height + 100) })
  await page.waitForTimeout(300)
  const words = await page.evaluate(`(${check.wordsOf})(document.querySelector('#proto .phold${c.frame ? ' .scrim' : ''}'))`)
  const png = await hold.screenshot()
  await page.close()
  return { words, png }
}

/** The app's picture and the reference's, side by side in one PNG. */
async function sideBySide(app, ref, file, caption) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
  const img = (b) => `<img style="display:block;max-width:none" src="data:image/png;base64,${b.toString('base64')}">`
  await page.setContent(
    `<body style="margin:0;background:#888;font:14px sans-serif"><div style="display:flex;gap:24px;align-items:flex-start;padding:16px;width:max-content">` +
      `<figure style="margin:0">${img(app)}<figcaption>${caption}</figcaption></figure>` +
      (ref ? `<figure style="margin:0">${img(ref)}<figcaption>Pocket reference</figcaption></figure>` : '') + '</div></body>',
  )
  await page.locator('body > div').screenshot({ path: file })
  await page.close()
}

/** Press every control on the screen, each on a fresh page; return the ones that did nothing. */
async function deadControls(c) {
  const size = SIZES[0]
  const first = await openApp(c, size)
  const names = await first.page.evaluate(`(${check.controlsOf})(document.body).map(${check.controlName})`)
  await first.ctx.close()
  const dead = []
  for (let i = 0; i < names.length; i++) {
    const { ctx, page, t } = await openApp(c, size)
    try {
      const why = await page.evaluate(`(() => { const el = (${check.controlsOf})(document.body)[${i}]; if (!el || (${check.controlName})(el) !== ${JSON.stringify(names[i])}) return 'not there on a fresh page'; el.setAttribute('data-pocket-press', ''); return (${check.notPressed})(el) })()`)
      if (why) {
        if (why === 'DISABLED WITHOUT SAYING WHY' || why === 'not there on a fresh page') dead.push(`${names[i]}: ${why.toLowerCase()}`)
        continue
      }
      const before = await page.evaluate(`(${check.pressState})(document)`)
      const sent = t.sent
      await page.locator('[data-pocket-press]').click({ timeout: 3000 })
      await settle(page, t)
      if ((await page.evaluate(`(${check.pressState})(document)`)) === before && t.sent === sent) dead.push(`${names[i]}: does nothing`)
    } catch (e) {
      dead.push(`${names[i]}: could not be pressed (${String(e.message).split('\n')[0]})`)
    } finally {
      await ctx.close()
    }
  }
  return dead
}

/**
 * B61.98 — the contrast check on the real pixels: the page frozen at each moment, shot as it is and with its text drawn
 * clear, and every line of text measured against the pixels behind it. Returns its problems, each once.
 */
const MOMENTS = [0, 4, 8, 12]
const CLEAR_TEXT = '*, *::before, *::after, *::placeholder { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }'
async function pixelProblems(c, size, file) {
  const { ctx, page, missed } = await openApp(c, size, { clock: true })
  const found = new Set(missed ? [missed] : [])
  try {
    await page.evaluate(() => document.fonts.ready)
    // No transition runs while the text is drawn clear and back, so each picture is the moment it says.
    await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' })
    await page.clock.pauseAt(new Date(new Date(SAMPLE_NOW).getTime() + 60_000))
    const decoder = await browser.newPage()
    for (const [n, t] of MOMENTS.entries()) {
      if (n) await page.clock.runFor((t - MOMENTS[n - 1]) * 1000)
      await page.evaluate((ms) => document.getAnimations().forEach((a) => (a.pause(), (a.currentTime = ms))), t * 1000)
      const drawn = await page.screenshot()
      if (!n) await sideBySide(drawn, null, file, `The app at ${size.width}x${size.height}, the background at 0 s`)
      const lines = await page.evaluate(`(${check.textLines})(document)`)
      const clear = await page.addStyleTag({ content: CLEAR_TEXT })
      const bare = await page.screenshot()
      await clear.evaluate((el) => el.remove())
      const problems = await decoder.evaluate(
        async ([lines, bare, drawn, fn]) => {
          const read = async (b64) => {
            const img = new Image()
            img.src = 'data:image/png;base64,' + b64
            await img.decode()
            const cv = document.createElement('canvas')
            cv.width = img.naturalWidth
            cv.height = img.naturalHeight
            const g = cv.getContext('2d', { willReadFrequently: true })
            g.drawImage(img, 0, 0)
            return g.getImageData(0, 0, cv.width, cv.height)
          }
          const [b, d] = [await read(bare), await read(drawn)]
          return (0, eval)(`(${fn})`)(lines, b.data, d.data, b.width, b.height)
        },
        [lines, bare.toString('base64'), drawn.toString('base64'), String(check.pixelContrastProblems)],
      )
      for (const p of problems) found.add(`${p} at ${t} s`)
    }
    await decoder.close()
  } finally {
    await ctx.close()
  }
  return [...found]
}

if (PIXELS) {
  for (const c of checks) {
    const name = c.route.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'home'
    for (const dark of [false, true]) {
      const label = `${name}${dark ? '-dark' : ''}`
      console.log(`\n${label} — the app at ${c.route}, the background frozen at ${MOMENTS.join(', ')} s`)
      for (const size of SIZES) {
        const file = join(OUT, `${name}-pixels${dark ? '-dark' : ''}-${size.name}.png`)
        const found = await pixelProblems({ ...c, dark }, size, file)
        console.log(`  wrote ${file.slice(REPO.length + 1)}${found.length ? `, ${found.length} line${found.length === 1 ? '' : 's'} under` : ''}`)
        for (const p of found) failures.push(`${label} at ${size.name}: ${p}`)
      }
    }
  }
  await browser.close()
  server.close()
  if (failures.length) {
    console.log(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:\n${failures.map((f) => `  ✗ ${f}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`\nevery line of text on ${checks.length} page${checks.length === 1 ? '' : 's'}, light and dark, at both sizes and at ${MOMENTS.join(', ')} s, reads at 4.5:1 (3:1 large) on the pixels behind it`)
  process.exit(0)
}

for (const c of checks) {
  // B57.21 — a screen with no reference, reached by steps (an agent's money panel), is named by its steps too.
  const steps = !c.screen && c.steps?.length ? `+${c.steps.join('-').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '')}` : ''
  const name = (c.screen || c.route.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'home') + steps
  // B57.20 — one screen in several states keeps a file for each: w-agent-research@fR1.
  const label = `${name}${c.state ? `@${Object.entries(c.state).map(([k, v]) => `${k}${v}`).join('-')}` : ''}${c.dark ? '-dark' : ''}`
  console.log(`\n${label} — the app at ${c.route}${c.steps?.length ? `, after ${c.steps.map((s) => `“${s}”`).join(', ')}` : ''}`)
  const ref = c.screen ? await reference(c) : null
  for (const size of SIZES) {
    const { ctx, page, missed } = await openApp(c, size)
    if (missed) failures.push(`${label} at ${size.name}: ${missed}`)
    const app = await page.screenshot({ fullPage: true })
    const file = join(OUT, `${label}-${size.name}.png`)
    await sideBySide(app, ref?.png, file, `The app at ${size.width}x${size.height}`)
    console.log(`  wrote ${file.slice(REPO.length + 1)}`)
    const hay = await page.evaluate(`(${check.haystackOf})(document.body)`)
    if (ref) for (const m of check.wordsCheck(c.screen, ref.words, hay, overrides)) failures.push(`${label} at ${size.name}: missing ${m}`)
    if (size.name === '390') for (const p of await page.evaluate(`(${check.layoutProblems})(document)`)) failures.push(`${label} at 390: ${p}`)
    if (c.dark) for (const p of await page.evaluate(`(${check.contrastProblems})(document)`)) failures.push(`${label} at ${size.name}: ${p}`)
    await ctx.close()
  }
  // A screen the steps could not reach has no controls of its own to press; the story page's specimens press nothing.
  if (PRESS && !c.route.startsWith('/__pocket-story/') && !failures.some((f) => f.startsWith(`${label} at `) && f.includes('nothing to press'))) for (const d of await deadControls(c)) failures.push(`${label}: ${d}`)
}

await browser.close()
server.close()
if (unanswered.size) console.log(`\nthe sample had no answer for (404): ${[...unanswered].join(', ')}`)
if (failures.length) {
  console.log(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:\n${failures.map((f) => `  ✗ ${f}`).join('\n')}`)
  process.exit(1)
}
console.log(`\nevery word on every reference screen is on the app, the layout holds at 390${DARK ? ', every text pair reads in dark' : ''}${PRESS ? ', and every control does something' : ''}`)
