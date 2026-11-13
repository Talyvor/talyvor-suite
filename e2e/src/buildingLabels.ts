// B56.13 — A BUILDING LABEL IS TRUE OR IT FAILS THE NIGHT (Nick, 1 Nov 2026: "yes to labels. but make sure they are
// true to what they state"). After the scenarios the run reads apps/web/src/labels/building.json from this checkout,
// the queue (--build-md), Lens's public reads — /v1/public/plan-gates' built, /v1/public/fees' charged,
// /v1/public/labels — and /status.json, and opens the app's public pages signed out. The report gets a Building labels
// section, and each of these FAILs on its own:
//   an entry that names no item, an item the queue lacks, or one no longer OPEN, CLAIMED or BLOCKED;
//   an entry whose switch Lens reports built, or a fee of which it reports charged;
//   a capability Lens labels live while /status.json has a rail its money moves on in test;
//   a Building chip on a public page whose key building.json does not have.
// Each FAIL files one item, once (filing.ts, `e2e-scenario: building-labels-<kind>-<key>`): "Take Building off
// <feature>" for talyvor-suite. A Live label is Lens's own answer, so "Take Live off <capability>" goes to talyvor-lens.

import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type QueueItem, queueItems } from './b28.ts'

/** The registry the app draws every Building chip from (StatusLabel.tsx), in this checkout. */
export const BUILDING_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../apps/web/src/labels/building.json')

/** One entry of building.json. */
export interface BuildingEntry {
  key: string
  feature: string
  item: string
}

/** The plan gates (GET /v1/public/plan-gates' names) an entry stands for, as PriceCard draws them. */
export const ENTRY_GATES: Readonly<Record<string, readonly string[]>> = {
  slack_teams_approvals: ['slack_teams_approvals'], sso: ['sso'], edge: ['edge'],
}

/** The fees (GET /v1/public/fees' names) an entry stands for, as PriceCard draws them. */
export const ENTRY_FEES: Readonly<Record<string, readonly string[]>> = {
  merchant_fees: ['merchant_fee_bps', 'merchant_a2a_fee_bps'], lending_fee: ['lending_fee_bps'], fx_margin: ['fx_margin_bps'],
}

/** /status.json's card_payments, which money entering by card moves on (Lens economy.RailCards). */
const CARDS = 'cards'

/**
 * The rails on /status.json each capability's money moves on: talyvor-lens internal/economy/labels.go capabilityRails,
 * card payments and the partner services. Its money-layer rails are not on /status.json, so they are not here.
 */
export const CAPABILITY_RAILS: Readonly<Record<string, readonly string[]>> = {
  spend_on_talyvor: [CARDS], buy_marketplace_listings: [CARDS], rent_and_subscribe_listings: [CARDS], lineage_royalties: [CARDS],
  move_between_own_agents: [CARDS], company_credit_line: [CARDS], pay_another_owner: [CARDS], loans_between_companies: ['capital'],
  escrow: [CARDS], cash_out: [CARDS], credit_involving_a_person: ['capital'], interest_and_yield: ['account'], invest_and_trade: ['broker'],
  agent_card: ['agent_token'], currency_accounts: ['account'], account_details: ['account'], payments_in: ['account'],
  payments_out: ['account'], pay_by_bank: ['account'], fx: ['fx'], stablecoins: ['stablecoin'], x402: ['stablecoin'],
  merchant_acceptance: ['account'], b2b_credit: ['capital'], seller_advances: ['capital'], lending_marketplace: ['capital'],
  trade_equities: ['broker'], trade_crypto: ['broker'], trade_prediction: ['broker'], treasury_sweep: ['account'], price_lock: [CARDS],
  cover: ['insurer'], payouts_to_people: ['account'],
}

/** The statuses under which an item is still being built. */
const BUILDING = new Set(['OPEN', 'CLAIMED', 'BLOCKED'])

export type FaultKind = 'no-item' | 'not-in-queue' | 'shipped' | 'built' | 'charged' | 'live-on-test' | 'unknown-chip'

export interface LabelFault {
  kind: FaultKind
  /** The building.json key, or the capability Lens labels live. */
  key: string
  /** The feature in plain words: building.json's, or the capability's key. */
  feature: string
  detail: string
  repo: 'talyvor-suite' | 'talyvor-lens'
  /** The build item that holds it: the one filed, or the one already open. */
  item?: string
}

/** What the section judges, as read. A source left undefined was not read, and nothing is judged from it. */
export interface LabelSources {
  entries: readonly BuildingEntry[]
  queue?: readonly QueueItem[]
  built?: Readonly<Record<string, boolean>>
  charged?: Readonly<Record<string, boolean>>
  labels?: Readonly<Record<string, string>>
  cardPayments?: string
  rails?: readonly { service: string; mode: string }[]
  /** Each public page opened and the keys of the Building chips it drew; the "What the labels mean" legend names none. */
  pages: readonly { path: string; chips: readonly string[] }[]
}

export interface BuildingLabelsReport {
  read_at: string
  /** building.json's entries, each with its item's status in the queue (absent when the queue was not read or lacks it). */
  entries: (BuildingEntry & { status?: string })[]
  /** The capabilities Lens labels, and those it labels live. */
  labelled: number
  live: string[]
  pages: { path: string; chips: string[] }[]
  faults: LabelFault[]
  /** Each source that could not be read, and why: nothing was judged from it. */
  unread: string[]
}

export const labelMarker = (f: Pick<LabelFault, 'kind' | 'key'>): string => `building-labels-${f.kind}-${f.key}`

/** Every way the Building labels and Lens's Live labels state what is not so. Pure. */
export function labelFaults(s: LabelSources): LabelFault[] {
  const out: LabelFault[] = []
  const take = (e: BuildingEntry, kind: FaultKind, detail: string) => out.push({ kind, key: e.key, feature: e.feature, detail, repo: 'talyvor-suite' })
  for (const e of s.entries) {
    const at = `building.json's \`${e.key}\` (${e.feature})`
    if (!/^B\d+\.\d+$/.test(e.item ?? '')) take(e, 'no-item', `${at} names no build item (${JSON.stringify(e.item ?? null)})`)
    else if (s.queue !== undefined) {
      const i = s.queue.find((q) => q.id === e.item)
      if (i === undefined) take(e, 'not-in-queue', `${at} names ${e.item}, which the queue does not have`)
      else if (!BUILDING.has(i.status)) take(e, 'shipped', `${at} names ${e.item}, which the queue marks ${i.status}, not OPEN, CLAIMED or BLOCKED`)
    }
    const built = (ENTRY_GATES[e.key] ?? []).filter((g) => s.built?.[g] === true)
    if (built.length > 0) take(e, 'built', `${at}: Lens's /v1/public/plan-gates reports ${built.join(' and ')} built`)
    const charged = (ENTRY_FEES[e.key] ?? []).filter((f) => s.charged?.[f] === true)
    if (charged.length > 0) take(e, 'charged', `${at}: Lens's /v1/public/fees reports ${charged.join(' and ')} charged`)
  }
  if (s.labels !== undefined && (s.cardPayments !== undefined || s.rails !== undefined)) {
    for (const [capability, label] of Object.entries(s.labels)) {
      if (label !== 'live') continue
      const onTest = (CAPABILITY_RAILS[capability] ?? []).filter((r) =>
        (r === CARDS ? s.cardPayments : s.rails?.find((x) => x.service === r)?.mode) === 'test')
      if (onTest.length > 0) {
        out.push({ kind: 'live-on-test', key: capability, feature: capability, repo: 'talyvor-lens',
          detail: `Lens's /v1/public/labels labels \`${capability}\` live while /status.json has ${onTest.map((r) => (r === CARDS ? 'card_payments' : `the ${r} rail`)).join(' and ')} in test` })
      }
    }
  }
  const known = new Set(s.entries.map((e) => e.key))
  const unknown = new Map<string, string[]>()
  for (const p of s.pages) for (const k of p.chips) if (!known.has(k)) unknown.set(k, [...new Set([...(unknown.get(k) ?? []), p.path])])
  for (const [k, paths] of unknown) {
    out.push({ kind: 'unknown-chip', key: k, feature: k, repo: 'talyvor-suite',
      detail: `${paths.join(', ')} draw${paths.length === 1 ? 's' : ''} a Building chip for \`${k}\`, which building.json does not have` })
  }
  return out
}

/** The section from what was read. Pure. */
export function buildingLabelsReport(s: LabelSources, unread: string[], readAt = new Date().toISOString()): BuildingLabelsReport {
  return {
    read_at: readAt,
    entries: s.entries.map((e) => {
      const status = s.queue?.find((q) => q.id === e.item)?.status
      return status === undefined ? { ...e } : { ...e, status }
    }),
    labelled: Object.keys(s.labels ?? {}).length,
    live: Object.entries(s.labels ?? {}).filter(([, l]) => l === 'live').map(([c]) => c).sort(),
    pages: s.pages.map((p) => ({ path: p.path, chips: [...p.chips] })),
    faults: labelFaults(s),
    unread,
  }
}

const SETTLE_MS = 20_000

async function lensJSON<T>(lensURL: string, path: string, unread: string[]): Promise<T | undefined> {
  try {
    const res = await fetch(lensURL + path, { headers: { Accept: 'application/json' } })
    if (res.status !== 200) {
      unread.push(`${path} answered ${res.status}`)
      return undefined
    }
    return (await res.json()) as T
  } catch (e) {
    unread.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
    return undefined
  }
}

/** Reads every source the section judges, then judges it. A source that cannot be read is named, never guessed. */
export async function readBuildingLabels(o: { appURL: string; lensURL: string; buildMd: string; buildingFile?: string }): Promise<BuildingLabelsReport> {
  const unread: string[] = []
  const entries = JSON.parse(await readFile(o.buildingFile ?? BUILDING_FILE, 'utf8')) as BuildingEntry[]
  let queue: QueueItem[] | undefined
  if (o.buildMd === 'none') unread.push('the queue: the run was given none')
  else {
    try {
      queue = queueItems(await readFile(o.buildMd, 'utf8'))
    } catch (e) {
      unread.push(`the queue at ${o.buildMd}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const lens = o.lensURL.replace(/\/$/, '')
  const gates = await lensJSON<{ built?: Record<string, boolean> }>(lens, '/v1/public/plan-gates', unread)
  const fees = await lensJSON<{ charged?: Record<string, boolean> }>(lens, '/v1/public/fees', unread)
  const labels = await lensJSON<{ labels?: Record<string, string> }>(lens, '/v1/public/labels', unread)
  const status = await lensJSON<{ card_payments?: string; rails?: { service: string; mode: string }[] | null }>(lens, '/status.json', unread)
  if (gates !== undefined && gates.built === undefined) unread.push("/v1/public/plan-gates states no built")
  if (fees !== undefined && fees.charged === undefined) unread.push("/v1/public/fees states no charged")

  const pages: { path: string; chips: string[] }[] = []
  // Loaded here, not at the top: the report and TESTERS.md import this file where no browser is installed (nightly.test.ts).
  const [{ chromium }, { PUBLIC_PAGES }] = await Promise.all([import('playwright'), import('./siteTruth.ts')])
  const browser = await chromium.launch({ headless: true, channel: 'chromium' })
  try {
    const page = await (await browser.newContext()).newPage()
    const origin = new URL(o.appURL).origin
    for (const path of PUBLIC_PAGES) {
      try {
        await page.goto(origin + path)
        await page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: SETTLE_MS }).catch(() => undefined)
        await page.waitForLoadState('networkidle', { timeout: SETTLE_MS }).catch(() => undefined)
        pages.push({ path, chips: await page.locator('[data-status-label="building"][data-status-key]').evaluateAll((els) => els.map((el) => el.getAttribute('data-status-key') ?? '')) })
      } catch (e) {
        unread.push(`${path}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  } finally {
    await browser.close()
  }
  return buildingLabelsReport({ entries, queue, built: gates?.built, charged: fees?.charged, labels: labels?.labels,
    cardPayments: status?.card_payments, rails: status?.rails ?? undefined, pages }, unread)
}

const cell = (s: string): string => s.replace(/\\/g, '\\\\').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')

/** The report's Building labels section. */
export function renderBuildingLabels(r: BuildingLabelsReport | undefined): string[] {
  if (r === undefined) return []
  const chips = r.pages.reduce((n, p) => n + p.chips.length, 0)
  const faultsOf = (key: string) => r.faults.filter((f) => f.key === key && f.repo === 'talyvor-suite' && f.kind !== 'unknown-chip')
  return ['', '### Building labels — each true to what it states (B56.13)', '',
    `${r.faults.length === 0 ? '**PASS**' : `**FAIL** ${r.faults.length}`}: ${r.entries.length} entries in building.json held to the queue and to Lens; ` +
      `${chips} Building chip${chips === 1 ? '' : 's'} on ${r.pages.length} public page${r.pages.length === 1 ? '' : 's'}; ` +
      `${r.live.length} of the ${r.labelled} capabilities Lens labels are live${r.live.length === 0 ? '' : ` (${r.live.join(', ')}), each held to its rails on /status.json`}.`, '',
    '| Entry | Feature | Item | In the queue | This run |', '|---|---|---|---|---|',
    ...r.entries.map((e) => {
      const fs = faultsOf(e.key)
      return `| \`${e.key}\` | ${cell(e.feature)} | ${e.item || '—'} | ${e.status ?? '—'} | ` +
        `${fs.length === 0 ? 'PASS' : fs.map((f) => `**FAIL** ${f.kind}${f.item === undefined ? '' : ` — build item ${f.item}`}`).join('; ')} |`
    }),
    ...(r.faults.length === 0 ? [] : ['', ...r.faults.map((f) => `- **FAIL** ${cell(f.detail)}.${f.item === undefined ? '' : ` Build item ${f.item}.`}`)]),
    ...(r.unread.length === 0 ? [] : ['', `Not read, so not judged: ${r.unread.map(cell).join('; ')}.`]), '']
}

/** The section in one line, for TESTERS.md. */
export function buildingLabelsLine(r: BuildingLabelsReport | undefined): string[] {
  if (r === undefined) return []
  return [`- **Building labels**: ${r.faults.length === 0 ? `PASS — ${r.entries.length} entries true to the queue and Lens` :
    `FAIL — ${r.faults.map((f) => `${f.kind} \`${f.key}\`${f.item === undefined ? '' : ` (${f.item})`}`).join(', ')}`}` +
    `${r.unread.length === 0 ? '' : `; not read: ${r.unread.length}`}.`]
}
