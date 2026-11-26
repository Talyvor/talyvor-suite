// B28.324 — Lens searches, filters and pages an agent's statement. The workspace's owner funds a new agent seven times
// and takes credits back three times, interleaved and each of its own amount, then reads the agent's statement on Lens
// as the Statements screen and the owner's own software do: the whole period first (the ledger: exactly those ten
// lines), then ?kind=fund three lines a page, following next_cursor to the end, then ?kind=withdraw, then ?q= one
// funding's entry in capitals, and that same ?q= under ?kind=withdraw. Page 2 must continue below page 1, a kind must
// return only that kind, and a search only the line it names.

import { fail } from './bank.ts'
import type { Scenario } from './scenarios.ts'

/** Lines on each page of the filtered statement: small, so seven fundings take three pages. */
export const PAGE = 3

/** The moves, oldest first: each amount once, so a line read twice or of the wrong kind cannot hide. */
export const MOVES: ReadonlyArray<{ kind: 'fund' | 'withdraw'; amount: number }> = [
  { kind: 'fund', amount: 40_001 }, { kind: 'fund', amount: 40_002 }, { kind: 'withdraw', amount: 1_003 },
  { kind: 'fund', amount: 40_004 }, { kind: 'fund', amount: 40_005 }, { kind: 'withdraw', amount: 1_006 },
  { kind: 'fund', amount: 40_007 }, { kind: 'fund', amount: 40_008 }, { kind: 'withdraw', amount: 1_009 },
  { kind: 'fund', amount: 40_010 },
]

export interface SearchLine { posting_id: number; entry_id: string; kind: string; amount_ulxc: number }
export interface SearchPage { lines: SearchLine[] | null; next_cursor?: string; accounts?: { account: string; closing_ulxc: number }[] | null }

export interface SearchReads {
  /** The whole period's statement, oldest first. */
  all: SearchPage
  /** ?kind=fund&limit=PAGE, then each next_cursor in turn. */
  fundPages: SearchPage[]
  withdrawals: SearchPage
  /** ?q= one funding's entry id, in capitals; and the same under ?kind=withdraw. */
  found: SearchPage
  foundAsWithdrawal: SearchPage
  /** The funding searched for. */
  sought: string
}

/**
 * The oracle: the agent's statement holds exactly the moves made; ?kind=fund pages them newest first, PAGE a page, each
 * page below the one before and every funding once; ?kind=withdraw is only the withdrawals; ?q= finds the one line it
 * names, and none once filtered to a kind that line is not; and a filtered page's totals are still the period's.
 */
export function statementSearchVerdict(r: SearchReads): { pass: boolean; detail: string } {
  const wrong: string[] = []
  const all = r.all.lines ?? []
  const signed = MOVES.map((m) => ({ kind: m.kind, amount_ulxc: m.kind === 'fund' ? m.amount : -m.amount }))
  const shown = (ls: ReadonlyArray<{ kind: string; amount_ulxc: number }>) => ls.map((l) => `${l.kind} ${l.amount_ulxc}`).join(', ')
  if (shown(all) !== shown(signed)) wrong.push(`the agent's statement is [${shown(all)}], want the moves made [${shown(signed)}]`)

  const newest = [...all].reverse()
  const funds = newest.filter((l) => l.kind === 'fund')
  const paged = r.fundPages.flatMap((p) => p.lines ?? [])
  const sizes = r.fundPages.map((p) => (p.lines ?? []).length)
  const wantSizes = Array.from({ length: Math.ceil(funds.length / PAGE) }, (_, i) => Math.min(PAGE, funds.length - i * PAGE))
  if (sizes.join(',') !== wantSizes.join(',')) wrong.push(`kind=fund pages of ${PAGE} came as [${sizes.join(', ')}] line(s), want [${wantSizes.join(', ')}]`)
  const others = paged.filter((l) => l.kind !== 'fund')
  if (others.length > 0) wrong.push(`kind=fund returned ${shown(others)}`)
  const ids = paged.map((l) => l.posting_id)
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i)
  if (twice.length > 0) wrong.push(`posting(s) ${[...new Set(twice)].join(', ')} came on two pages`)
  if (shown(paged) !== shown(funds)) wrong.push(`kind=fund paged newest first is [${shown(paged)}], want [${shown(funds)}]`)
  const last = r.fundPages[r.fundPages.length - 1]
  if (last !== undefined && last.next_cursor) wrong.push(`the last kind=fund page still names a next_cursor`)

  const taken = r.withdrawals.lines ?? []
  const wantTaken = all.filter((l) => l.kind === 'withdraw')
  if (shown(taken) !== shown(wantTaken)) wrong.push(`kind=withdraw returned [${shown(taken)}], want [${shown(wantTaken)}]`)

  const found = r.found.lines ?? []
  if (found.length !== 1 || found[0]?.entry_id !== r.sought) wrong.push(`q=${r.sought.toUpperCase()} returned [${shown(found)}], want the one funding it names`)
  const none = r.foundAsWithdrawal.lines ?? []
  if (none.length !== 0) wrong.push(`kind=withdraw&q=${r.sought.toUpperCase()} returned [${shown(none)}], want none: that line is a funding`)

  const totals = (p: SearchPage) => JSON.stringify((p.accounts ?? []).map((a) => [a.account, a.closing_ulxc]))
  if (r.fundPages[0] !== undefined && totals(r.fundPages[0]) !== totals(r.all)) wrong.push(`a filtered page's totals ${totals(r.fundPages[0])} are not the period's ${totals(r.all)}`)

  return wrong.length === 0
    ? { pass: true, detail: `the agent's statement holds the ${all.length} moves made; kind=fund came ${sizes.join(' + ')} newest first, each page below the last; ` +
      `kind=withdraw only the ${taken.length} withdrawals; q= found the one funding it names, and none under kind=withdraw` }
    : { pass: false, detail: wrong.join('; ') }
}

export function statementSearch(): Scenario {
  return {
    id: 'statement-search',
    owner: 'talyvor-lens',
    items: ['B28.324'],
    agents: 1,
    feature: 'Statements',
    title: `an agent funded ${MOVES.filter((m) => m.kind === 'fund').length} times and taken back from ${MOVES.filter((m) => m.kind === 'withdraw').length} times: ` +
      `its statement on Lens filtered to fundings pages ${PAGE} at a time newest first, page 2 below page 1 and each once; filtered to withdrawals ` +
      'it is only those; and a search for one funding finds only that line',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const from = new Date(Date.now() - 60_000).toISOString()
      const a = await lens.createAgent(user, `Searched ${Date.now().toString(36)}`)
      for (const m of MOVES) {
        if (m.kind === 'fund') await lens.fundAgent(user, a.id, m.amount)
        else await lens.withdrawAgent(user, a.id, m.amount)
      }
      const path = `/v1/workspaces/{ws}/agents/${a.id}/statement?from=${encodeURIComponent(from)}`
      const read = async (query: string): Promise<SearchPage | string> => {
        const r = await lens.act<SearchPage>(user, 'GET', path + query)
        return r.ok ? r.value : `GET the statement${query} answered ${r.status}: ${r.error.slice(0, 200)}`
      }
      const all = await read('')
      if (typeof all === 'string') return fail(all)
      ctx.evidence.push({ note: `the agent's statement on Lens: ${JSON.stringify((all.lines ?? []).map((l) => [l.kind, l.amount_ulxc]))}` })
      const fundPages: SearchPage[] = []
      let cursor = ''
      do {
        const p = await read(`&kind=fund&limit=${PAGE}${cursor === '' ? '' : `&cursor=${encodeURIComponent(cursor)}`}`)
        if (typeof p === 'string') return fail(p)
        fundPages.push(p)
        cursor = p.next_cursor ?? ''
      } while (cursor !== '' && fundPages.length <= MOVES.length)
      ctx.evidence.push({ note: `kind=fund, ${PAGE} a page: ${JSON.stringify(fundPages.map((p) => (p.lines ?? []).map((l) => l.amount_ulxc)))}` })
      const withdrawals = await read('&kind=withdraw')
      if (typeof withdrawals === 'string') return fail(withdrawals)
      const sought = (all.lines ?? []).find((l) => l.kind === 'fund' && l.amount_ulxc === 40_005)?.entry_id
      if (sought === undefined) return fail(`the agent's statement has no funding of 40005 µLXC to search for: ${JSON.stringify(all.lines)}`)
      const found = await read(`&q=${encodeURIComponent(sought.toUpperCase())}`)
      if (typeof found === 'string') return fail(found)
      const foundAsWithdrawal = await read(`&kind=withdraw&q=${encodeURIComponent(sought.toUpperCase())}`)
      if (typeof foundAsWithdrawal === 'string') return fail(foundAsWithdrawal)
      ctx.evidence.push({ note: `kind=withdraw: ${JSON.stringify((withdrawals.lines ?? []).map((l) => l.amount_ulxc))}; q=${sought.toUpperCase()}: ` +
        `${JSON.stringify((found.lines ?? []).map((l) => [l.kind, l.amount_ulxc]))}; under kind=withdraw: ${(foundAsWithdrawal.lines ?? []).length} line(s)` })
      return statementSearchVerdict({ all, fundPages, withdrawals, found, foundAsWithdrawal, sought })
    },
  }
}
