// B17.526 SELF-TEST — the run's browser never hands a link to the Mac. A local page holds a mailto:, a tel:
// and an http link; a context from the run's own browser pool (run.ts's Browsers) clicks each. The mailto
// and the tel click leave the page where it was, and the page's own bubble-phase listener sees
// event.defaultPrevented true; window.open with a mailto: gives null; the http link still navigates.
//
//   pnpm --filter @talyvor/e2e selftest:links
//
// With the guard taken out of run.ts it fails: "defaultPrevented false on the mailto click". The page's
// listener then cancels the click itself, so even that run opens nothing on the Mac.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Browsers } from '../src/run.ts'

const PAGE = `<!doctype html><html><body>
<a id="mail" href="mailto:hello@talyvor.com">hello@talyvor.com</a>
<a id="tel" href="tel:+15550100">Call</a>
<a id="web" href="/next">Next</a>
<script>
  window.seen = {}
  window.addEventListener('click', (e) => {
    const a = e.target.closest('a')
    window.seen[a.id] = e.defaultPrevented
    // Only when no guard did: the self-test itself never opens Mail either.
    if (a.id !== 'web' && !e.defaultPrevented) e.preventDefault()
  })
</script></body></html>`

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(req.url === '/next' ? '<!doctype html><title>next</title><p>next</p>' : PAGE)
})
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

const incidents: string[] = []
const browsers = new Browsers(false, incidents)
const failed: string[] = []
try {
  const context = await (await browsers.get()).newContext()
  const page = await context.newPage()
  await page.goto(`${base}/`)
  for (const id of ['mail', 'tel']) {
    await page.click(`#${id}`)
    await page.waitForTimeout(300)
    const prevented = await page.evaluate((i) => (window as unknown as { seen: Record<string, boolean> }).seen[i], id)
    const at = new URL(page.url()).pathname
    console.log(`${id === 'mail' ? 'mailto' : 'tel'} click: defaultPrevented ${prevented}, page at ${at}, pages open ${context.pages().length}`)
    if (prevented !== true) failed.push(`defaultPrevented ${String(prevented)} on the ${id === 'mail' ? 'mailto' : 'tel'} click`)
    if (at !== '/') failed.push(`the ${id} click left the page for ${at}`)
  }
  if (failed.length === 0) {
    const opened = await page.evaluate(() => window.open('mailto:hello@talyvor.com') === null)
    console.log(`window.open('mailto:…'): ${opened ? 'null, nothing opened' : 'opened something'}`)
    if (!opened) failed.push('window.open with a mailto: opened something')
  }
  await page.click('#web')
  await page.waitForURL(`${base}/next`, { timeout: 5_000 }).catch(() => undefined)
  console.log(`http click: page at ${new URL(page.url()).pathname}`)
  if (new URL(page.url()).pathname !== '/next') failed.push('the http link did not navigate')
} finally {
  await browsers.close()
  server.close()
}
if (failed.length > 0) {
  console.log(`FAIL: ${failed.join('; ')}`)
  process.exit(1)
}
console.log('PASS: no link left the test browser, and the http link still navigates')
