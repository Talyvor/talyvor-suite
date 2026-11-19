#!/usr/bin/env node
/**
 * B64.9 — Orange boxes never cover letters (website version 4, FOR-V7 item 9).
 *
 *   pnpm --filter @talyvor/web pillcheck [--no-build]
 *
 * The logic of design/website-2026-11-17-v4/checks/pillcheck.js, run on the app's own /marketing instead of the design's
 * index.html: it builds the app, serves dist signed out, and at 14 widths from 320 to 1920 measures every heading that
 * holds an orange box (.pill, the hero's .l2). For each g, j, p, q, y, Q, comma and semicolon in the heading it finds
 * where the glyph's ink ends (its baseline from the line box, its descent from the font) and fails if a glyph on a line
 * above a box reaches into it, or if a box runs past the window. It prints one line per heading and width, then
 * ALL CLEAR or FAIL <n>, and exits 1 on FAIL.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'
import { build } from 'vite'

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = join(WEB, 'dist')
const WIDTHS = [320, 360, 375, 390, 414, 600, 768, 900, 1024, 1180, 1280, 1440, 1680, 1920]
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4' }

function serve() {
  return new Promise((done) => {
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      // Signed out, with nothing behind the page's reads: the headings do not wait on them.
      if (path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/v1/')) {
        res.writeHead(401, { 'content-type': 'application/json' }).end('{}')
        return
      }
      const file = join(DIST, path)
      const found = file.startsWith(DIST) && extname(path) && existsSync(file) ? file : join(DIST, 'index.html')
      res.writeHead(200, { 'content-type': TYPES[extname(found)] ?? 'application/octet-stream' }).end(await readFile(found))
    })
    server.listen(0, '127.0.0.1', () => done(server))
  })
}

/** Runs in the page: every heading with an orange box, and each descender of its text that reaches into a box below it. */
function measure() {
  const out = []
  const cv = document.createElement('canvas').getContext('2d')
  for (const h of [...document.querySelectorAll('h1, .h2')].filter((el) => el.querySelector('.pill, .l2'))) {
    const pill = h.querySelector('.pill, .l2')
    const ps = getComputedStyle(pill)
    const hs = getComputedStyle(h)
    const boxes = [...pill.getClientRects()].map((r) => ({ l: r.left, r: r.right, t: r.top }))
    const issues = []
    const tw = document.createTreeWalker(h, NodeFilter.SHOW_TEXT)
    let n
    while ((n = tw.nextNode())) {
      const inPill = pill.contains(n)
      const style = inPill ? ps : hs
      cv.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      for (let i = 0; i < n.textContent.length; i++) {
        const ch = n.textContent[i]
        if (!/[gjpqy,;Q]/.test(ch)) continue
        const rg = document.createRange()
        rg.setStart(n, i)
        rg.setEnd(n, i + 1)
        const rr = rg.getClientRects()[0]
        if (!rr) continue
        const m = cv.measureText(ch)
        const baseline = rr.bottom - m.fontBoundingBoxDescent
        const inkBottom = baseline + m.actualBoundingBoxDescent
        for (const b of boxes) {
          if (Math.min(rr.right, b.r) - Math.max(rr.left, b.l) <= 1) continue
          // The glyph sits on a line above this piece of the box, and its ink reaches into it.
          if (baseline < b.t + 2 && inkBottom > b.t - 1) issues.push({ ch, inPill, gap: +(b.t - inkBottom).toFixed(1) })
        }
      }
    }
    const pr = pill.getBoundingClientRect()
    out.push({ id: h.id || h.tagName, fs: parseFloat(hs.fontSize), lines: boxes.length, issues, overflow: pr.right > document.documentElement.clientWidth + 0.5 })
  }
  return out
}

if (!process.argv.includes('--no-build')) await build({ root: WEB, logLevel: 'warn' })
const server = await serve()
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
let bad = 0
let headings = 0
try {
  for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } })
    await page.goto(`${base}/marketing`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.tv4 .h2 .pill')
    await page.evaluate(() => document.fonts.ready)
    // Measured on a fallback font, the run says nothing about the page people see.
    if (!(await page.evaluate(() => [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Bricolage Grotesque' && f.status === 'loaded')))) {
      throw new Error(`${w}px: Bricolage Grotesque did not load`)
    }
    // The hero's box slams in; measure where it lands, not where it starts.
    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' })
    await page.waitForTimeout(300)
    for (const r of await page.evaluate(measure)) {
      headings++
      if (r.issues.length || r.overflow) bad++
      console.log(`${w}px ${r.id} fs=${r.fs} lines=${r.lines}${r.overflow ? ' OVERFLOW' : ''} ${r.issues.length ? 'OVERLAP ' + JSON.stringify(r.issues) : 'ok'}`)
    }
    await page.close()
  }
} finally {
  await browser.close()
  server.close()
}
// A run that measured nothing proves nothing.
if (headings < WIDTHS.length * 10) {
  bad++
  console.log(`only ${headings} headings measured, expected ${WIDTHS.length * 10}`)
}
console.log(bad ? `FAIL ${bad}` : 'ALL CLEAR')
process.exit(bad ? 1 : 0)
