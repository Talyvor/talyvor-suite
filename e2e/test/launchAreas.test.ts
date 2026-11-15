import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { inventory } from '../src/coverage.ts'
import { type Control, type FiledRequest, deadControls, filedFaults, screenMatcher } from '../src/helpScreen.ts'
import { instantTransferQuote, offeredFaults, quoteFaults } from '../src/instantTransfer.ts'
import { hiddenPaths } from '../src/launch.ts'
import { LensClient } from '../src/lens.ts'
import { labelFaults, launchScreens } from '../src/sandboxLabel.ts'
import type { ScenarioCtx, Verdict } from '../src/scenarios.ts'

// B61.48 — the scenarios of the launch version's three areas that had none: Instant transfer, Help and the Sandbox label. Each
// passes on a sound copy and FAILs on a broken one: instant-transfer-quote against the stub Lens (selftest/stub-launch.ts) with
// each of its planted defects, and the app's halves through the judges they read the screens with.

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../..')

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

const stubs: ChildProcess[] = []
afterAll(() => {
  for (const s of stubs) s.kill()
})

async function quoteOnStub(broken: string): Promise<Verdict> {
  const port = await freePort()
  const stub = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../selftest/stub-lens.ts', import.meta.url).pathname], {
    env: { ...process.env, STUB_PORT: String(port), LENS_SYNTHETIC_KEY: 'instant-transfer', STUB_BREAK: broken },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  stubs.push(stub)
  await new Promise<void>((resolve, reject) => {
    stub.stdout?.on('data', (b: Buffer) => /stub lens on/.test(b.toString()) && resolve())
    stub.on('exit', (code) => reject(new Error(`the stub exited ${code}`)))
  })
  const lens = new LensClient(`http://127.0.0.1:${port}`, 'instant-transfer')
  const [user] = await lens.createUsers(1)
  return instantTransferQuote().run({ app: { user }, env: { lens }, evidence: [] } as unknown as ScenarioCtx)
}

describe('instant-transfer-quote (B61.48)', () => {
  it.concurrent('passes on a Lens whose quote shows its fee, holds 30 seconds and is refused in words after', async () => {
    const v = await quoteOnStub('')
    expect(v.detail).toMatch(/^USD 5\.00 quoted at a fee of 3 \(50 bps\), rate 1, 497 arriving, locked 30 seconds; inside them a send answered 403, after them refused 409 ".*expired.*Ask for a new one/)
    expect(v.pass).toBe(true)
  })

  it.concurrent('FAILs when a quote is locked for 60 seconds', async () => {
    expect(await quoteOnStub('instant-quote-long')).toEqual({ pass: false, detail: 'a quote is locked for 30 seconds; this one for 60 seconds' })
  })

  it.concurrent('FAILs when a quote shows no fee', async () => {
    expect(await quoteOnStub('instant-fee-dropped')).toEqual({ pass: false, detail: 'the quote must show its fee; its fee_bps is 0' })
  })

  it.concurrent('FAILs when a send at an expired quote is not refused for it', async () => {
    const v = await quoteOnStub('instant-quote-expired-sent')
    expect(v.pass).toBe(false)
    expect(v.detail).toMatch(/^the refusal of a send at an expired quote must say it expired and to ask for a new one; Lens said "economy: this Instant transfer/)
  })

  it('judges a quote by its own figures', () => {
    const q = { id: 'itq_1', send_minor: 500, send_currency: 'USD', fee_bps: 30, fee_minor: 2, rate: '0.997', receive_minor: 498, receive_currency: 'USD',
      created_at: '2026-11-15T10:00:00.000Z', expires_at: '2026-11-15T10:00:30.000Z' }
    expect(quoteFaults(q, 500, 'USD')).toEqual([])
    expect(quoteFaults({ ...q, fee_minor: 1 }, 500, 'USD')).toEqual(['the fee is 30 basis points of 500, rounded up: 2; the quote shows 1'])
    expect(quoteFaults({ ...q, rate: '' }, 500, 'USD')).toEqual(['the quote must show its rate; it shows ""'])
    expect(quoteFaults({ ...q, receive_minor: 0 }, 500, 'USD')).toEqual(['the quote must show what arrives in USD; it shows 0 USD'])
  })
}, 120_000)

describe('instant-transfer-offered (B61.48)', () => {
  const links = ['Instant transfer Arrives in seconds, any day, any hour', 'Standing orders The same amount on a schedule']
  it('passes when Pay offers Instant transfer to a Hybrid account alone', () => {
    expect(offeredFaults('hybrid', { payLinks: links, formDrawn: true, landedOn: '/money/pay/instant-transfer' })).toEqual([])
    expect(offeredFaults('fiat', { payLinks: links.slice(1), formDrawn: false, landedOn: '/money/pay' })).toEqual([])
  })

  it('FAILs when a Fiat only account is offered it, or reaches its form', () => {
    expect(offeredFaults('fiat', { payLinks: links, formDrawn: true, landedOn: '/money/pay/instant-transfer' })).toEqual([
      `a Fiat only account's Pay must offer no Instant transfer; it offers ["${links[0]}"]`,
      "a Fiat only account's /money/pay/instant-transfer must go back to Pay; it landed on /money/pay/instant-transfer with the form",
    ])
  })

  it('FAILs when a Hybrid account is not offered it', () => {
    expect(offeredFaults('hybrid', { payLinks: links.slice(1), formDrawn: false, landedOn: '/money/pay' })).toHaveLength(2)
  })
})

describe('help (B61.48)', () => {
  const complaint: FiledRequest = { id: 7, kind: 'complaint', state: 'received', reference: 'C-AB12-CD34', message: 'late' }
  const said = ['Complaint received', 'Its reference is']
  const shown = { snack: 'Complaint received Its reference is C-AB12-CD34.', row: 'Complaint Reference C-AB12-CD34 Received late' }

  it('passes when the page says it was sent and lists it as Lens filed it', () => {
    expect(filedFaults('complaint', 'late', said, [complaint], shown)).toEqual([])
    expect(filedFaults('support', 'where?', ['Sent'], [{ ...complaint, kind: 'support', reference: '', message: 'where?' }],
      { snack: 'Sent A person at Talyvor reads it', row: 'Question or problem Received where?' })).toEqual([])
  })

  it('FAILs when a complaint is filed as a question, with no reference', () => {
    expect(filedFaults('complaint', 'late', said, [{ ...complaint, kind: 'support', reference: '' }], { snack: 'Sent', row: 'Question or problem Received late' })).toEqual([
      'the request was sent as complaint but Lens filed it as support',
      'a complaint gets a reference as soon as it is sent; Lens\'s is ""',
      'the page must say "Complaint received" once it is sent; it says "Sent"',
      'the page must say "Its reference is" once it is sent; it says "Sent"',
      'the page must list the request with "Complaint"; its row reads "Question or problem Received late"',
    ])
  })

  it('FAILs when nothing was filed, or it was filed twice', () => {
    expect(filedFaults('complaint', 'late', said, [], shown)[0]).toMatch(/^Lens must hold the one request sent with "late"; it holds 0/)
    expect(filedFaults('complaint', 'late', said, [complaint, { ...complaint, id: 8 }], shown)[0]).toMatch(/it holds 2/)
  })

  it('finds every dead control and passes the live ones', async () => {
    const inv = await inventory(REPO, 'none')
    const isScreen = screenMatcher(inv.screens.map((s) => s.path))
    const live: Control[] = [
      { tag: 'a', name: 'Settings', href: '/settings', disabled: false, reason: '' },
      { tag: 'a', name: 'Your data', href: '/settings/data', disabled: false, reason: '' },
      { tag: 'a', name: 'Write to us', href: 'mailto:help@talyvor.com', disabled: false, reason: '' },
      { tag: 'button', name: 'Send', disabled: true, reason: 'Write your message first.' },
    ]
    expect(deadControls(live, isScreen, 'http://app')).toEqual([])
    expect(deadControls([
      { tag: 'a', name: 'Terms', href: '#', disabled: false, reason: '' },
      { tag: 'a', name: 'Old help', href: '/help-centre', disabled: false, reason: '' },
      { tag: 'button', name: 'Send', disabled: true, reason: '' },
    ], isScreen, 'http://app')).toEqual([
      'the link "Terms" leads nowhere (href "#")',
      'the link "Old help" leads to /help-centre, which is no screen of the app',
      'the button "Send" is disabled and says nowhere why',
    ])
  })
})

describe('sandbox-label-every-screen (B61.48)', () => {
  it('opens every signed-in launch screen and no hidden or public one', async () => {
    const inv = await inventory(REPO, 'none')
    const paths = launchScreens(inv.screens, (await hiddenPaths(REPO, 'none')).screens)
    for (const p of ['/', '/money/pay', '/money/pay/instant-transfer', '/settings/help', '/settings/data']) expect(paths).toContain(p)
    for (const p of ['/chat', '/marketplace', '/rooms', '/signin', '/pricing']) expect(paths).not.toContain(p)
    expect(paths.some((p) => p.includes(':') || p.includes('*'))).toBe(false)
  })

  const shot = { path: '/money', labels: ['sandbox', 'sandbox'], top: 'sandbox', text: 'Money Sandbox Your accounts' }
  it('passes a screen with the Sandbox label on top and nothing live', () => {
    expect(labelFaults(shot)).toEqual([])
  })

  it('FAILs a screen with no label on top, a Live label, or a line calling the money test money', () => {
    expect(labelFaults({ ...shot, top: '' })).toEqual(['/money must carry the Sandbox label in its top bar; it carries none'])
    expect(labelFaults({ ...shot, top: 'unknown' })).toEqual(['/money must carry the Sandbox label in its top bar; it carries "unknown"'])
    expect(labelFaults({ ...shot, labels: ['sandbox', 'live'] })).toEqual(['/money reads as live money: it carries a Live label'])
    expect(labelFaults({ ...shot, text: 'Money Preview — Test money only. Your accounts' })).toEqual(['/money says "Money Preview — Test money only. Your accounts"'])
  })
})
