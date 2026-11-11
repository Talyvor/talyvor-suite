#!/usr/bin/env node
/**
 * B57.1 — pocket-shots: the app beside the Pocket reference, for every Pocket item.
 *
 *   pnpm --filter @talyvor/web pocket:shots <item> <checks.json>
 *
 * checks.json is a list of { route, screen, steps?, dark?, frame?, answers?, state? }: the app's address, the reference's screen id
 * (README.md's tables; leave it out for a page with no reference, such as the story page), the words or aria-labels to press in the app to reach the screen as a person would
 * (w-home+sheet-A is reached by pressing "Review"), whether to shoot it dark, and whether the reference is only the
 * dialog's frame over its page (B57.5: a dialog on the story page, beside the reference's dialog without its page),
 * and what to answer instead of the sample for some addresses, by path (B57.49: /auth/me signed out for /signup), and
 * the reference's state to set before its shot (B57.116: { "pr": 1, "nw": 0 } shows a prepared payment).
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

const [item, checksArg] = process.argv.slice(2)
if (!item || !checksArg || !/^[\w.-]+$/.test(item)) {
  console.error('usage: pnpm --filter @talyvor/web pocket:shots <item> <checks.json>')
  process.exit(2)
}
// pnpm runs the script in apps/web; a relative path means where the person typed it.
const checks = JSON.parse(await readFile(resolve(process.env.INIT_CWD || process.cwd(), checksArg), 'utf8'))
if (!existsSync(join(REFERENCE, 'index.html'))) {
  console.error(`no Pocket reference at ${REFERENCE}: set POCKET_REFERENCE`)
  process.exit(2)
}
const overrides = JSON.parse(await readFile(join(WEB, 'scripts/pocket/overrides.json'), 'utf8'))

// The sample and the checks are TypeScript the app's own imports resolve; vite loads them as it does in a build.
const loader = await createServer({ root: WEB, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } })
const { sampleBodyFor, SAMPLE_NOW, SAMPLE_TIME_ZONE } = await loader.ssrLoadModule('/scripts/pocket/sample.ts')
const check = await loader.ssrLoadModule('/src/test/pocketCheck.ts')
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
async function openApp(c, size) {
  const ctx = await browser.newContext({ viewport: size, timezoneId: SAMPLE_TIME_ZONE, colorScheme: c.dark ? 'dark' : 'light' })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(new Date(SAMPLE_NOW))
  const t = tracker(page)
  if (c.answers) {
    await page.route(
      (url) => url.pathname in c.answers,
      (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(c.answers[new URL(route.request().url()).pathname]) }),
    )
  }
  await page.goto(BASE + c.route)
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

for (const c of checks) {
  const name = c.screen || c.route.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'home'
  const label = `${name}${c.dark ? '-dark' : ''}`
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
    await ctx.close()
  }
  // A screen the steps could not reach has no controls of its own to press; the story page's specimens press nothing.
  if (!c.route.startsWith('/__pocket-story/') && !failures.some((f) => f.startsWith(`${label} at `) && f.includes('nothing to press'))) for (const d of await deadControls(c)) failures.push(`${label}: ${d}`)
}

await browser.close()
server.close()
if (unanswered.size) console.log(`\nthe sample had no answer for (404): ${[...unanswered].join(', ')}`)
if (failures.length) {
  console.log(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:\n${failures.map((f) => `  ✗ ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nevery word on every reference screen is on the app, the layout holds at 390, and every control does something')
