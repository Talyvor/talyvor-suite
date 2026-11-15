// B61.48 — Help (the launch version's 'support' area), once a run, on a workspace of its own each. In the app, Settings › Help and
// complaints files a question and says so, and a complaint goes through the complaint form with its reference; Settings › Your data
// asks for a copy and lists the request. Each one is read back on Lens (GET /v1/workspaces/{ws}/requests) as what was sent, of the
// kind sent. And neither page has a dead control: every link leads to a screen the app has, every button can be pressed or says why not.

import type { Page } from 'playwright'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario, ScenarioCtx, Verdict } from './scenarios.ts'
import { call, said } from './settings.ts'

const TIMEOUT_MS = 30_000

/** One request as Lens answers it (internal/support). */
export interface FiledRequest {
  id: number
  kind: string
  state: string
  reference: string
  message: string
}

/** What a page says once a request is sent: the snack, and the request's own row in its list. */
export interface Shown {
  snack: string
  row: string
}

const KIND_TITLE: Record<string, string> = { support: 'Question or problem', complaint: 'Complaint', data_export: 'A copy of your data' }

/**
 * What is wrong with a request filed on a page: Lens must hold exactly one of `kind` with `message`, received; the page must say
 * it was sent (`said`) and list it by its kind's title as Received, a complaint with Lens's reference on both.
 */
export function filedFaults(kind: string, message: string, said: readonly string[], filed: readonly FiledRequest[], shown: Shown): string[] {
  const faults: string[] = []
  const mine = filed.filter((r) => r.message === message)
  if (mine.length !== 1) return [`Lens must hold the one request sent with "${message}"; it holds ${mine.length}: ${JSON.stringify(filed).slice(0, 300)}`]
  const [r] = mine
  if (r.kind !== kind) faults.push(`the request was sent as ${kind} but Lens filed it as ${r.kind}`)
  if (r.state !== 'received') faults.push(`a request just sent is received; Lens has it ${r.state}`)
  if (kind === 'complaint' && !/^\S{4,}$/.test(r.reference)) faults.push(`a complaint gets a reference as soon as it is sent; Lens's is "${r.reference}"`)
  for (const s of said) if (!shown.snack.includes(s)) faults.push(`the page must say "${s}" once it is sent; it says "${shown.snack.slice(0, 200)}"`)
  if (kind === 'complaint' && r.reference !== '' && !shown.snack.includes(r.reference)) faults.push(`the page must give the complaint's reference ${r.reference}; it says "${shown.snack.slice(0, 200)}"`)
  for (const s of [KIND_TITLE[kind] ?? kind, 'Received', ...(kind === 'complaint' ? [r.reference] : [])]) {
    if (!shown.row.includes(s)) faults.push(`the page must list the request with "${s}"; its row reads "${shown.row.slice(0, 200)}"`)
  }
  return faults
}

/** A link or a button as the page draws it. */
export interface Control {
  tag: 'a' | 'button'
  name: string
  href?: string
  disabled: boolean
  /** a disabled button's reason, read from its aria-describedby */
  reason: string
}

/** The app's screens as react-router patterns, :params matching one segment. */
export const screenMatcher = (patterns: readonly string[]): ((path: string) => boolean) => {
  const res = patterns.filter((p) => p !== '*' && !p.endsWith('/*')).map((p) => new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+').replace(/\/$/, '')}/?$`))
  return (path) => res.some((r) => r.test(path))
}

/** Every dead control: a link that leads nowhere, or to no screen the app has; a button disabled without saying why. */
export function deadControls(controls: readonly Control[], isScreen: (path: string) => boolean, origin: string): string[] {
  const dead: string[] = []
  for (const c of controls) {
    const name = c.name.replace(/\s+/g, ' ').trim() || '(unnamed)'
    if (c.tag === 'button') {
      if (c.disabled && c.reason.trim() === '') dead.push(`the button "${name}" is disabled and says nowhere why`)
      continue
    }
    const href = (c.href ?? '').trim()
    const url = href === '' || href === '#' ? undefined : URL.parse(href, origin)
    // Only a page, a mail or a call is somewhere to go: any other scheme (javascript:, data:, …) leads nowhere.
    if (url === undefined || url === null || !['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
      dead.push(`the link "${name}" leads nowhere (href "${href}")`)
      continue
    }
    if (url.protocol === 'mailto:' || url.protocol === 'tel:') continue
    if (url.origin === new URL(origin).origin && !url.pathname.startsWith('/api/') && !isScreen(url.pathname)) {
      dead.push(`the link "${name}" leads to ${url.pathname}, which is no screen of the app`)
    }
  }
  return dead
}

/** The page's links and buttons, each with what makes it live or dead. */
async function controlsOn(page: Page): Promise<Control[]> {
  return page.locator('main a, main button').evaluateAll((els) => els.map((el) => {
    const described = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)
    return {
      tag: el.tagName === 'A' ? 'a' as const : 'button' as const,
      name: el.getAttribute('aria-label') ?? el.textContent ?? '',
      ...(el.tagName === 'A' ? { href: el.getAttribute('href') ?? '' } : {}),
      disabled: el instanceof HTMLButtonElement && el.disabled,
      reason: described.map((id) => document.getElementById(id)?.textContent ?? '').join(' ') || (el.getAttribute('title') ?? ''),
    }
  }))
}

const text = async (page: Page, selector: string): Promise<string> => {
  const at = page.locator(selector).first()
  return at.waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await at.textContent()) ?? '').replace(/\s+/g, ' ').trim(), () => '')
}

async function lensRequests(ctx: ScenarioCtx): Promise<FiledRequest[]> {
  const r = await call<{ requests: FiledRequest[] | null }>(ctx, 'GET', '/v1/workspaces/{ws}/requests', undefined)
  ctx.evidence.push({ note: "Lens's requests for the workspace", answer: said(r) })
  return r.value?.requests ?? []
}

/** Sends one request from `path` by `send`, then judges the page and Lens's copy of it. */
async function sendAndRead(ctx: ScenarioCtx, path: string, kind: string, message: string, said: string[], send: (page: Page) => Promise<void>): Promise<Verdict> {
  const page = await ctx.app.tab(path)
  try {
    await page.locator('main').waitFor({ timeout: TIMEOUT_MS })
    await send(page)
    const snack = await page.locator('[role="status"]').filter({ hasText: said[0] }).first()
      .waitFor({ timeout: TIMEOUT_MS }).then(async () => ((await page.locator('[role="status"]').allTextContents()).join(' ')).replace(/\s+/g, ' '), () => '')
    const rowSelector = message === '' ? '[data-testid^="request-"]' : `[data-testid^="request-"]:has-text(${JSON.stringify(message)})`
    const row = await text(page, rowSelector)
    ctx.evidence.push({ note: `${path}: what the page says once it is sent`, answer: `snack "${snack}"; row "${row}"` })
    const filed = await lensRequests(ctx)
    const faults = filedFaults(kind, message, said, filed, { snack, row })
    if (faults.length > 0) return fail(faults.join('; '))
    const r = filed.find((x) => x.message === message)
    return { pass: true, detail: `filed on ${path} as ${kind}${r?.reference ? ` with reference ${r.reference}` : ''}, said "${said.join(' ')}" and listed as Received; Lens holds it` }
  } finally {
    await page.close()
  }
}

export function helpRequest(): Scenario {
  return {
    id: 'help-request',
    owner: 'talyvor-suite',
    own: true,
    items: ['B61.48'],
    feature: 'Help and complaints',
    title: 'help: a question sent from Settings › Help and complaints says Sent, is listed as a question Received, and Lens holds it as support',
    run: (ctx) => {
      const message = `Nightly question ${RUN_SALT}: where do I see what my agents spent this week?`
      return sendAndRead(ctx, '/settings/help', 'support', message, ['Sent', 'A person at Talyvor reads it and answers on this page.'], async (page) => {
        await page.getByLabel('Your message').fill(message)
        await page.getByRole('button', { name: 'Send', exact: true }).click()
      })
    },
  }
}

export function helpComplaint(): Scenario {
  return {
    id: 'help-complaint',
    owner: 'talyvor-suite',
    own: true,
    items: ['B61.48'],
    feature: 'Help and complaints',
    title: "help: a complaint goes through the complaint form — Send complaint — and gets Lens's reference on the page and in its row",
    run: (ctx) => {
      const message = `Nightly complaint ${RUN_SALT}: a statement line was late.`
      return sendAndRead(ctx, '/settings/help', 'complaint', message, ['Complaint received', 'Its reference is'], async (page) => {
        await page.getByLabel('What is it?').selectOption('complaint')
        await page.getByLabel('Your message').fill(message)
        await page.getByRole('button', { name: 'Send complaint', exact: true }).click()
      })
    },
  }
}

export function yourDataRequest(): Scenario {
  return {
    id: 'your-data-request',
    owner: 'talyvor-suite',
    own: true,
    items: ['B61.48'],
    feature: 'Your data',
    title: 'help: Ask for a copy on Settings › Your data is listed there as A copy of your data, Received, and Lens holds it as data_export',
    run: (ctx) => sendAndRead(ctx, '/settings/data', 'data_export', '', ['Asked', 'When your copy is ready, Download appears on this page.'], async (page) => {
      await page.getByRole('button', { name: 'Ask for a copy', exact: true }).click()
    }),
  }
}

export function helpNoDeadControl(): Scenario {
  return {
    id: 'help-no-dead-control',
    owner: 'talyvor-suite',
    items: ['B61.48'],
    feature: 'Help and complaints',
    title: 'help: on Help and complaints and on Your data every link leads to a screen of the app and every button can be pressed or says why not',
    run: async (ctx) => {
      const isScreen = screenMatcher(ctx.env.inventory.screens.map((s) => s.path))
      const dead: string[] = []
      let counted = 0
      for (const path of ['/settings/help', '/settings/data']) {
        const page = await ctx.app.tab(path)
        try {
          await page.getByRole('button').first().waitFor({ timeout: TIMEOUT_MS })
          const controls = await controlsOn(page)
          counted += controls.length
          ctx.evidence.push({ note: `${path}: its links and buttons`, answer: JSON.stringify(controls).slice(0, 1500) })
          dead.push(...deadControls(controls, isScreen, new URL(page.url()).origin).map((d) => `${path}: ${d}`))
        } finally {
          await page.close()
        }
      }
      if (counted === 0) return fail('neither Help and complaints nor Your data drew a link or a button')
      return dead.length > 0 ? fail(dead.join('; ')) : { pass: true, detail: `${counted} links and buttons on Help and complaints and Your data, none dead` }
    },
  }
}
