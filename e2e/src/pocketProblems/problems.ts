// B55.44 — POCKET'S 25 APP PROBLEMS, each pressed in the real app every night, and never back. The Pocket review found 25
// problems in the live app (Talyvor HQ claude/talyvor-pocket-fix-gate-2026-11-06.md); B55, B56 and B57 fix them. Each has
// one scenario here (index.ts) that does what a person does and asserts the fixed behaviour, named by the items that fix it.
//
// B55.52 — the items include the ones split off later (B55.45 to B55.51), and an open B55 item whose FOUND line names a
// problem counts as one of its items even before it is listed here (unlistedFixes), so no problem reads back while a fix is open.
//
// While any of a problem's items is not DONE, a FAIL is reported only: the items are being built. Once all are DONE, a FAIL
// means the problem is BACK: it files one item at the top of B55 naming them (filing.ts, `e2e-scenario: pocket-NN`), and the
// report's "Pocket problems" section says so. This file is data and pure functions, so the report and filing read it without
// a browser.

import { queueItems } from '../b28.ts'

export interface PocketProblem {
  n: number
  /** The problem as the Pocket review named it. */
  problem: string
  /** What passing means. */
  passing: string
  /** The items that fix it. */
  items: readonly string[]
  /** Where a FAIL that is back is filed: the repo of its first fix item. */
  repo: string
  /** Found by reading the code, not by running it (B55.44's CHECKS): a PASS on the first night is said on the PR. */
  byCode?: true
}

export const POCKET: readonly PocketProblem[] = [
  { n: 1, problem: 'Passkey and phone key block each other', passing: 'a workspace whose first key is a web passkey adds the phone\'s key, and the reverse, each let in from the other device', items: ['B55.1', 'B55.3', 'B55.4', 'B55.6', 'B55.50'], repo: 'talyvor-lens', byCode: true },
  { n: 2, problem: 'Phone cannot resume or start every agent once a key exists', passing: 'both work from the phone with Face ID', items: ['B55.5'], repo: 'talyvor-mobile' },
  { n: 3, problem: 'Expired approval blanks pages', passing: 'the morning after an untouched request, Approvals, Agent Wallets and the room\'s settings draw and say Expired', items: ['B55.7', 'B55.8', 'B55.9'], repo: 'talyvor-suite' },
  { n: 4, problem: 'Phone-only key: web cannot approve or resume', passing: 'the web shows no failing button and says where to approve', items: ['B55.2'], repo: 'talyvor-suite' },
  { n: 5, problem: 'Prepared payment has no list or button on the web', passing: 'listed on Approvals and Home with Review, counted in the badge', items: ['B55.10', 'B55.11'], repo: 'talyvor-suite' },
  { n: 6, problem: 'Payment a signed permission covers is never paid', passing: 'paid when prepared, without a tap, and both sides told', items: ['B55.21', 'B55.22'], repo: 'talyvor-lens' },
  { n: 7, problem: 'New workspace never named', passing: 'first Home asks for the name, the sidebar never shows the raw id', items: ['B55.39'], repo: 'talyvor-suite', byCode: true },
  { n: 8, problem: 'Machine text reaches people', passing: 'no raw id, prefix, code, µLXC or status on any screen the run visits', items: ['B55.29', 'B55.30', 'B55.31', 'B55.32', 'B55.33', 'B55.11', 'B55.42', 'B55.46', 'B55.50', 'B55.51'], repo: 'talyvor-lens' },
  { n: 9, problem: 'Loosening rules needs no passkey', passing: 'every loosening control asks for the passkey or the phone, tightening saves at once', items: ['B55.13', 'B55.14'], repo: 'talyvor-lens' },
  { n: 10, problem: 'Pause every agent does not stop pull mandates', passing: 'a payee\'s pull is refused until agents start again', items: ['B55.23'], repo: 'talyvor-lens', byCode: true },
  { n: 11, problem: 'No screen removes a passkey, the last key can go', passing: 'any key but the last is removable, the last never is', items: ['B55.15', 'B55.16', 'B55.17', 'B55.6', 'B55.48'], repo: 'talyvor-lens' },
  { n: 12, problem: 'Room payouts only in Lens\'s API', passing: 'the owner pays members by the split from the app', items: ['B55.28'], repo: 'talyvor-suite' },
  { n: 13, problem: 'USDC account breaks Invoices', passing: 'Invoices and Pay draw with a USDC wallet, six decimals', items: ['B55.26', 'B55.27'], repo: 'talyvor-suite', byCode: true },
  { n: 14, problem: '"Billed monthly on your card" while cards are off', passing: 'no marketplace screen says "on your card"', items: ['B55.36'], repo: 'talyvor-suite' },
  { n: 15, problem: 'Lock-screen Approve missing for an agent\'s approval', passing: 'approved from the lock screen with Face ID', items: ['B55.12', 'B55.47'], repo: 'talyvor-lens' },
  { n: 16, problem: 'Phone sends a payment at once', passing: 'confirm step and Face ID every time, first-payment questions once', items: ['B55.25'], repo: 'talyvor-mobile' },
  { n: 17, problem: 'Declining does not stop asking', passing: 'not asked again for 24 hours, owner not pinged again', items: ['B55.18', 'B55.19', 'B55.20'], repo: 'talyvor-lens', byCode: true },
  { n: 18, problem: 'Room members and budget refusals show ids', passing: 'names everywhere, refusals in words', items: ['B55.34', 'B55.35', 'B55.29'], repo: 'talyvor-lens' },
  { n: 19, problem: 'Chat\'s help names two providers', passing: 'it lists all seven', items: ['B55.37'], repo: 'talyvor-suite' },
  { n: 20, problem: 'Dollars written US$ and $', passing: '$450.00 everywhere, dollars first beside LXC', items: ['B55.38', 'B55.27', 'B55.30', 'B55.49'], repo: 'talyvor-suite' },
  { n: 21, problem: 'Spending notice reads as an approval', passing: 'it reads as itself and opens Spending', items: ['B55.43'], repo: 'talyvor-suite', byCode: true },
  { n: 22, problem: 'Revoking the only phone key locks the workspace', passing: 'refused, with words', items: ['B55.15', 'B55.16'], repo: 'talyvor-lens', byCode: true },
  { n: 23, problem: 'USDC payment blanks Spending, Budgets, Subscriptions, Limit alerts', passing: 'all four draw', items: ['B55.26', 'B55.45'], repo: 'talyvor-suite', byCode: true },
  { n: 24, problem: '"Spending:" raw refusals, "ai software", "mcp:" names', passing: 'none shown', items: ['B55.42', 'B55.46'], repo: 'talyvor-suite' },
  { n: 25, problem: 'Money written three ways on the new pages', passing: 'one format', items: ['B55.38', 'B55.30'], repo: 'talyvor-suite' },
]

// B55.52 — the pass's own items name problems without fixing them.
const PASS_ITEMS = new Set(['B55.44', 'B55.52'])

/** Each B55 item not yet DONE whose FOUND line names a problem ("problem 15", "problems 1 and 11") this list does not give it. */
export function unlistedFixes(buildMd: string): { id: string; n: number }[] {
  const status = new Map(queueItems(buildMd).map((q) => [q.id, q.status]))
  const out: { id: string; n: number }[] = []
  for (const block of buildMd.split(/^(?=## )/m)) {
    const id = /^## (B55\.\d+) — /.exec(block)?.[1]
    if (id === undefined || PASS_ITEMS.has(id) || status.get(id) === 'DONE') continue
    for (const line of block.split('\n').filter((l) => l.startsWith('FOUND'))) {
      for (const m of line.matchAll(/\bproblems? (\d+(?:(?:, | and |, and )\d+)*)/gi)) {
        for (const n of m[1].match(/\d+/g) ?? []) {
          const p = POCKET.find((x) => x.n === Number(n))
          if (p !== undefined && !p.items.includes(id) && !out.some((o) => o.id === id && o.n === p.n)) out.push({ id, n: p.n })
        }
      }
    }
  }
  return out
}

export const pocketID = (n: number): string => `pocket-${String(n).padStart(2, '0')}`

/** A scenario of this pass: its FAIL is filed by the Pocket rule (filing.ts), never as a B17 item. */
export const isPocket = (scenario: string): boolean => /^pocket-\d\d$/.test(scenario)

type Verdict = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR'

export interface PocketRow {
  n: number
  problem: string
  scenario: string
  verdict: Verdict | 'not run'
  detail: string
  /** Each fix item with its status in the queue (`not in the queue` when it is not there); `unlisted`: named only by its FOUND line. */
  items: { id: string; status: string; unlisted?: true }[]
  /** passes; fixing: a FAIL while an item is not DONE; back: a FAIL with every item DONE; cannot press; error; not run. */
  state: 'passes' | 'fixing' | 'back' | 'cannot press' | 'error' | 'not run'
  /** The item a back problem is filed under (filing.ts). */
  filed?: string
}

/** The 25 rows, from this run's verdicts and the queue as it stands (`undefined`: no queue, so no item reads DONE). */
export function pocketRows(buildMd: string | undefined, outcomes: readonly { scenario: string; status: Verdict; detail: string }[]): PocketRow[] {
  const status = new Map((buildMd === undefined ? [] : queueItems(buildMd)).map((q) => [q.id, q.status]))
  const unlisted = buildMd === undefined ? [] : unlistedFixes(buildMd)
  return POCKET.map((p) => {
    const scenario = pocketID(p.n)
    const os = outcomes.filter((o) => o.scenario === scenario)
    // The worst verdict any user saw: one FAIL is the problem.
    const o = ['FAIL', 'ERROR', 'SKIP', 'PASS'].map((v) => os.find((x) => x.status === v)).find((x) => x !== undefined)
    const items: PocketRow['items'] = [
      ...p.items.map((id) => ({ id, status: status.get(id) ?? 'not in the queue' })),
      ...unlisted.filter((u) => u.n === p.n).map((u) => ({ id: u.id, status: status.get(u.id) ?? 'not in the queue', unlisted: true as const })),
    ]
    const done = items.every((i) => i.status === 'DONE')
    const state: PocketRow['state'] = o === undefined ? 'not run' : o.status === 'PASS' ? 'passes' : o.status === 'SKIP' ? 'cannot press'
      : o.status === 'ERROR' ? 'error' : done ? 'back' : 'fixing'
    return { n: p.n, problem: p.problem, scenario, verdict: o?.status ?? 'not run', detail: o?.detail ?? '', items, state }
  })
}

const cell = (s: string): string => s.replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim()

const STATE: Record<PocketRow['state'], string> = {
  passes: 'pass',
  fixing: 'FAIL — its items are being built, reported only',
  back: '**BACK** — every item is DONE and it failed again',
  'cannot press': 'cannot be pressed yet',
  error: 'ERROR — no verdict',
  'not run': 'not run',
}

/** The report's "Pocket problems" section: 25 rows, pass or fail, with the items. */
export function renderPocket(rows: readonly PocketRow[] | undefined): string[] {
  if (rows === undefined) return []
  return [
    '', '### Pocket problems (B55.44)', '',
    `${rows.filter((r) => r.state === 'passes').length} of ${rows.length} pass; ${rows.filter((r) => r.state === 'back').length} back.`, '',
    '| # | Problem | Verdict | Items | What it saw |',
    '|---:|---|---|---|---|',
    ...rows.map((r) => `| ${r.n} | ${cell(r.problem)} | ${STATE[r.state]}${r.filed === undefined ? '' : ` (${r.filed})`} | ` +
      `${r.items.map((i) => `${i.id} ${i.status}${i.unlisted ? ' (not in problems.ts)' : ''}`).join(', ')} | ${cell(r.detail).slice(0, 400)} |`),
  ]
}

/** TESTERS.md's one line for the section. */
export function pocketLine(rows: readonly PocketRow[] | undefined): string[] {
  if (rows === undefined) return []
  const back = rows.filter((r) => r.state === 'back')
  const failing = rows.filter((r) => r.state === 'fixing')
  const unlisted = new Map<string, number[]>()
  for (const r of rows) for (const i of r.items) if (i.unlisted) unlisted.set(i.id, [...(unlisted.get(i.id) ?? []), r.n])
  return [`- **Pocket problems**: ${rows.filter((r) => r.state === 'passes').length} of ${rows.length} pass` +
    (failing.length > 0 ? `; still failing while their items are built: ${failing.map((r) => r.n).join(', ')}` : '') +
    (back.length > 0 ? `; BACK: ${back.map((r) => `${r.n}${r.filed === undefined ? '' : ` (${r.filed})`}`).join(', ')}` : '') +
    (unlisted.size > 0 ? `; problems.ts does not list: ${[...unlisted].map(([id, ns]) => `${id} for ${ns.join(', ')}`).join('; ')}` : '') + '.']
}
