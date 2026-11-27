import { describe, expect, it } from 'vitest'
import { keptOf, platformFeeBPS } from '../src/fees.ts'
import type { Fees, LensClient } from '../src/lens.ts'
import { COMPANY_AGENTS, cast, seat, seatKey } from '../src/plans.ts'
import type { PublicPlan } from '../src/lens.ts'
import { pastAgentsVerdict } from '../src/pricing.ts'
import { notThePlansRefusal, seatsRefusal } from '../src/seats.ts'
import { type Scenario, journeyFor } from '../src/scenarios.ts'

const s = (id: string, more: Partial<Scenario> = {}): Scenario => ({ id, title: id, owner: 'talyvor-lens', run: async () => ({ pass: true, detail: '' }), ...more })

describe('every scenario on the plan it needs (B35.7)', () => {
  it('puts a user that opens agents on Company, past Company’s agents on Group, a counterparty on Group, and a gate on a workspace of its own', () => {
    const c = cast([
      [s('reads')],
      [s('wallet', { agents: 2 })],
      [s('wallets', { agents: COMPANY_AGENTS }), s('one-more', { agents: 1 })],
      [s('pays-3', { agents: 1, partners: [3] }), s('seats-studio', { plan: 'business_studio', own: true }), s('gate', { plan: 'business_company', own: true, agents: 26 })],
    ])
    expect(c.plans).toEqual(['business_studio', 'business_company', 'business_group', 'business_group'])
    expect(c.own).toEqual([{ user: 3, scenario: 'seats-studio', plan: 'business_studio' }, { user: 3, scenario: 'gate', plan: 'business_company' }])
  })

  it("casts a 10-user run so no shared workspace's scenarios open more agents than its plan holds", () => {
    const journeys = Array.from({ length: 10 }, (_, i) => journeyFor(i, 10, []))
    const c = cast(journeys)
    const holds: Record<string, number> = { business_studio: 3, business_company: COMPANY_AGENTS, business_group: Infinity }
    journeys.forEach((j, i) => expect(j.filter((x) => x.own !== true).reduce((n, x) => n + (x.agents ?? 0), 0)).toBeLessThanOrEqual(holds[c.plans[i]]))
    // User 9 is every catalog-v4 scenario's other company; seats-studio, each paid plan's agent gate, BYOK and a plan change (B34.5,
    // each bought with the test card) run on their own.
    expect(c.plans[9]).toBe('business_group')
    // B34.6 — and every way into Lens's gateway, each on a workspace nothing else touches; B34.7 — and every Lens setting;
    // B34.8 — and evals, outputs and attribution, nodes, PoVI, LENS and credits bought.
    // B32.53 — and a private room, on a Team workspace of its own (Free opens no private room).
    // B28.279 — and the ledger under concurrency, each on a Team workspace nothing else moves money in.
    // B28.280 — and Stripe's webhooks, each on a workspace whose ledger nothing else writes.
    // B28.281 — and an agent's rules, on a Team workspace nothing else moves money in.
    // B28.283 — and the pool, on a workspace whose sharing and personal-data detection nothing else switches.
    // B28.284 — and a prompt injection, on a workspace whose ledger nothing else writes.
    // B28.285 — and the addresses Lens must never reach and the documents it must not unpack without end.
    // B28.286 — and the session's writes from elsewhere, and a script in an answer or a private room's message (Team).
    // B28.287 — and the keys no read may return and the credentials no upstream may receive.
    // B28.288 — and a burst Lens's rate limiter must refuse.
    // B28.295 — and the room screens nothing else reached: an invite link's screen, and a contribution decided and run (Team).
    // B32.75 — and a sale's earning released on the journal, bought by a workspace whose bill nothing else adds to.
    // B32.76 — and a listing's four offers and a price change, bought by a workspace whose bill nothing else adds to.
    // B32.78 — and a listing rented and used under its licence, with an agent of its own, on a workspace whose bill nothing else adds to.
    // B32.79 — and a listing's free trial uses and the billed one after them, on a workspace whose bill nothing else adds to.
    // B32.80 — and an agent's licences judged by its rules, with two agents of its own, on a workspace whose bill nothing else adds to.
    // B32.81 — and an agent shopping over MCP within its commitment and a max price, with an agent of its own, on a workspace whose bill nothing else adds to.
    // B32.82 — and Free's room limits and a private room joined by an invite link, on a Free workspace of its own that the scenario puts on Team.
    // B32.83 — and a room's messages, streamed, scanned, edited, deleted and limited per minute, on a Team workspace of its own with a private room.
    // B32.84 — and a room's contributions, proposed, forked with lineage and voted on, on a Free workspace of its own.
    // B32.85 — and a room's wallet, funded, its budget refused past Free's maximum, and spent by a member given may_spend.
    // B32.86 — and runs in a room, on the room's budget or the member's own, and the room's AI asked on the room's budget.
    // B32.87 — and a room's prizes, refused over the budget, awarded and cleared, and closed unawarded at the deadline.
    // B32.88 — and an agent in a room over MCP, billed within its rules and refused above them, every call logged.
    // B32.66 — and tax on three buyers' rents, their receipts, and a seller withheld from the payout run and then paid.
    // B32.89 — and the trust panel, counting only paying buyers not linked to the seller.
    // B32.92 — and a buyer's tax profile, a valid VAT number making a business and a never-issued one a consumer.
    // B32.95 — and a seller's tax details, saved and read back masked, kept when a save leaves them out.
    // B32.96 — and a seller's weekly statement, its lines summing to its net before and after the payout run pays it.
    // B32.97 — and a self-billing seller's paid week, carrying its self-billed invoice with the payout's figures.
    // B32.98 — and the annual platform-reporting export, its GB seller's figures the journal's and its US seller left out.
    // B30.117 — and verification levels, reached in order, a Test pass counting for test money only.
    // B30.126 — and saved outside payees, a no-match confirmed only by a passkey's signature, a sanctioned one refused.
    // B30.122 — and each money capability's terms, listed unaccepted on a new workspace, fx's accepted and the next version 409.
    // B30.116 — and the Verification screen, L1 then L2 reached from its forms.
    // B30.103 — and the Capability terms screen and an agent's credential, one agent on Free.
    // B30.118 — and an agent's Know Your Agent credential, revoked by a rule change and by a pause.
    // B32.65 — and a family of three remixes, the rent of the youngest split up the family and refunded.
    // B32.93 — and two buyers' per-use buys, each taxed by its treatment, the paid one's tax cleared to tax:GB.
    // B32.94 — and two buyers' paid bills, each receipted in turn as its bill, the DE business's reverse charged.
    // B32.100 — and a $20.00 rent read in pounds by a GB consumer, VAT included as its bill charges it, and by a GB business "+ VAT".
    // B28.162 — and a listing's version 2 uploaded with a changelog, a use pinned to version 1 still running version 1.
    // B28.426 — and a paid skill used in Chat, its two questions two billed uses on a bill nothing else adds to.
    // B41.60 — and a room's spec, read by the room's AI and replaced by its update, on a Free workspace of its own.
    // B41.61 — and a room opened from a Track issue's screen, private, on a Team workspace of its own.
    // B40.7 — and an assistant on /mcp preparing a two-payee batch, one agent on Free.
    // B40.21 — and that batch approved once with a passkey, on Free.
    // B40.12 — and a payment asked for in Chat, prepared and read back, a voice one needing approval, on Free.
    // B40.31 — and the phone app's device-key routes through the BFF, on Free.
    // B40.27 — and an assistant's prepared batch under a signed mandate, on Free.
    // B40.25 — and the official MCP SDK client paying with agent_pay on an agent's own key, two agents on Free.
    // B40.29 — and an agent's two-item batch paid once on one device-key approval, its record verified, one agent on Free.
    // B40.32 — and an agent's speech through Lens, one charge each at the catalog's price, one agent on Free.
    // B41.1 — and the Pay screen's bills inbox, one PDF invoice added twice and read into one bill, on Free.
    // B41.2 — and three bills paid on one approval card, on Free.
    // B40.22 — and an invoice, its copy and a changed-details invoice, paid once each, on Free.
    // B46.21 — and a Room's earnings split equally among three members and paid out, on a Team workspace of its own.
    // B41.7 — and one search box finding a supplier's payee, payment and bill, on Free.
    // B52.28 — and a Scan agent's watch, read back and stopped, beside the public track record, on Free.
    // B52.34 — and an assistant's Connect token paying from one of two agents inside its rules, on Free.
    // B48.27 — and an agent's USDC payments screened by address and under the Travel Rule, on Free.
    // B41.44 — and a contribution's two reviewers drawn by Lens and its quality their median, on Free.
    // B41.52 — and a room's open tasks board, claimed by one member and read by another, on Free.
    // B28.66 — and where alerts go, a budget's alerts queued once to each channel, on Free.
    // B61.48 — and an Instant transfer quote and what Pay offers, a question, a complaint and a data copy asked for, on Free.
    // B61.67 — and an Instant transfer sent from an agent the owner funded, on Free.
    // B48.38 — and an agent's crypto sends under the owner's signed spend permission, on Free.
    // B48.21 — and an agent's crypto wallet end to end, with a second user's agent it pays and is paid by, on Free.
    // B30.107 — and accounts, payments and FX, every step on the statements, one agent on a workspace of its own.
    // B30.128 — and an outside business's mandate pulls on an agent's account, one agent on a workspace of its own.
    // B28.67 — and an agent cashed out with a passkey, on a workspace of its own whose passkey asks no other scenario to sign.
    // B28.79 — and an agent's streamed answer longer than 30 s, billed once, on a Company workspace of its own.
    // B28.245 — and an agent added with a name far bigger than the app reads, refused, on a workspace of its own.
    expect(c.own.map((o) => `${o.scenario}:${o.plan}`).sort()).toEqual(['account-statements:business_studio', 'agent-allowances:business_studio', 'agent-card-account:business_studio', 'agent-card-replace:business_studio', 'agent-cards:business_studio', 'agent-crypto-spend-permission:business_studio', 'agent-crypto-wallet:business_studio', 'agent-resume-signed:business_studio', 'agent-rules-unbypassable:business_company', 'agent-wallet-kinds:business_studio', 'agent-wallet:business_studio', 'alert-channels:business_studio', 'approval-own-request:business_studio', 'approval-reused:business_studio', 'batch-approval-pays-once:business_studio', 'bills-duplicate-changed-details:business_studio', 'bills-inbox:business_studio', 'bills-pay-all-due:business_studio', 'budget-ids-validated:business_studio', 'budgets-by-category:business_studio', 'bulk-payouts:business_studio', 'buyer-tax-profile:business_studio', 'byok-addon:business_studio', 'capability-terms:business_studio', 'card-dispute-screen:business_studio', 'charged-after-hang-up:business_studio', 'chat-first-message:business_studio', 'chat-listing:business_studio', 'chat-payment-card:business_studio', 'coach-week:business_studio', 'compliance:business_studio', 'connect-approve:business_studio', 'connect-contact:business_studio', 'connect-mcp:business_studio', 'connect-oauth:business_studio', 'connect-pay:business_studio', 'connect-recurring:business_studio', 'credits-top-up:business_studio', 'csrf-every-write:business_studio', 'csrf-refused:business_studio', 'currency-convert-margin:business_studio', 'daily-briefing:business_studio', 'device-key-approval:business_studio', 'device-keys-bff:business_studio', 'evals:business_studio', 'file-bomb-bounded:business_studio', 'gateway-auth:business_studio', 'gateway-keys:business_studio', 'gateway-mcp:business_studio', 'gateway-providers:business_studio', 'gateway-sessions:business_studio', 'help-complaint:business_studio', 'help-request:business_studio', 'injection-exfil-room-message:business_studio', 'injection-exfil-web-page:business_studio', 'injection-exfil:business_studio', 'instant-transfer-offered:business_studio', 'instant-transfer-quote:business_studio', 'instant-transfer-send:business_studio', 'invoice-pay-link:business_studio', 'invoices-screen:business_studio', 'keys-not-forwarded:business_studio', 'keys-unlisted:business_studio', 'kya-credential:business_studio', 'ledger-call-once:business_company', 'ledger-moves-at-once:business_company', 'lens-tokens:business_studio', 'limit-alerts:business_studio', 'lineage:business_studio', 'low-balance-alert:business_studio', 'market-abuse:business_studio', 'market-agent-commitment:business_studio', 'market-agent-mcp:business_studio', 'market-bill-invoices:business_studio', 'market-bill-tax:business_studio', 'market-buyer-currency:business_studio', 'market-discovery:business_studio', 'market-earnings-payout:business_studio', 'market-journal:business_studio', 'market-listing-as-model:business_studio', 'market-offers:business_studio', 'market-receipts:business_studio', 'market-rent:business_studio', 'market-trial:business_studio', 'market-trust:business_studio', 'market-versions:business_studio', 'mcp-pay-retried-once:business_studio', 'mcp-sdk-agent-pay:business_studio', 'money-accounts:business_studio', 'money-layer-contract:business_studio', 'money-mandates:business_studio', 'money-tampered:business_company', 'monitoring:business_studio', 'month-plan:business_studio', 'named-ids-isolated:business_studio', 'nodes:business_studio', 'one-search:business_studio', 'outputs-attribution:business_studio', 'outside-payees:business_studio', 'passkey-enrol-signed:business_studio', 'passkey-recovery:business_studio', 'pay-payee-by-name:business_studio', 'pay-saved-payee-by-name:business_studio', 'pay-screen:business_studio', 'payee-cooling-off:business_studio', 'payee-details-lock:business_studio', 'payment-request-batch:business_studio', 'payments-out:business_studio', 'permission-mandate:business_studio', 'phone-approve:business_studio', 'phone-bearer:business_studio', 'phone-key-web:business_studio', 'phone-pay-payee:business_studio', 'phone-stop-everything:business_studio', 'phone-widget-pause:business_studio', 'physical-card:business_studio', 'plan-agents-company:business_company', 'plan-agents-group:business_group', 'plan-change:business_studio', 'platform-report:business_studio', 'pool-isolation:business_studio', 'povi:business_studio', 'provider-key-hidden:business_group', 'rate-limits-hold:business_studio', 'request-body-bounded:business_studio', 'room-agent-mcp:business_studio', 'room-contribution-record:business_studio', 'room-contributions:business_studio', 'room-decide-run:business_company', 'room-earnings-payout:business_company', 'room-from-issue:business_company', 'room-invite-limits:business_studio', 'room-invite-screen:business_company', 'room-messages:business_company', 'room-objections:business_studio', 'room-points:business_studio', 'room-prizes:business_studio', 'room-rate-card:business_studio', 'room-reviews:business_studio', 'room-runs:business_studio', 'room-shared-ownership:business_studio', 'room-spec:business_company', 'room-takeover:business_studio', 'room-tasks:business_studio', 'room-wallet:business_studio', 'rooms-moderation:business_studio', 'rooms-private:business_company', 'scan-agents:business_studio', 'scan-report:business_studio', 'screening-travel-rule:business_studio', 'script-inert:business_company', 'seats-company:business_company', 'seats-studio:business_studio', 'second-approver:business_studio', 'self-billed-invoice:business_studio', 'seller-tax-details:business_studio', 'seller-week-statement:business_studio', 'settings-config-budgets:business_studio', 'settings-guardrails:business_studio', 'settings-operator-only:business_studio', 'settings-prompts:business_studio', 'settings-stored-answers:business_studio', 'settings-switches:business_studio', 'settings-tare-distill:business_studio', 'single-use-card-screen:business_studio', 'speech-through-lens:business_studio', 'spending-screen:business_studio', 'ssrf-refused:business_studio', 'standing-orders:business_studio', 'stream-outlives-30s:business_company', 'subscriptions-view:business_studio', 'tax-and-payouts:business_studio', 'terms-credential-screens:business_studio', 'trust-layer:business_studio', 'verification-levels:business_studio', 'verification-screen:business_studio', 'voice-chat-pay:business_studio', 'wallet-cash-out:business_studio', 'wallet-statements:business_studio', 'webhook-replayed:business_studio', 'webhook-unsigned:business_studio', 'workspace-limits-raised:business_studio', 'workspace-roles-lens:business_studio', 'workspace-roles:business_studio', 'xss-shown-back:business_company', 'your-data-request:business_studio'])
  })

  it('creates each plan’s workspaces in one call, each user at its index and each gate’s own beside it', async () => {
    const calls: [number, string | undefined][] = []
    const lens = {
      createUsers: async (count: number, plan?: string) => {
        calls.push([count, plan])
        return Array.from({ length: count }, (_, n) => ({ index: n, workspaceID: `${plan}-${n}`, token: 't', expiresAt: '', plan }))
      },
    } as unknown as LensClient
    const seated = await seat(lens, { plans: ['business_company', 'business_group', 'business_company'], own: [{ user: 1, scenario: 'seats-studio', plan: 'business_studio' }] })
    expect(calls).toEqual([[1, 'business_studio'], [2, 'business_company'], [1, 'business_group']])
    expect(seated.users.map((u) => `${u.index} ${u.workspaceID}`)).toEqual(['0 business_company-0', '1 business_group-0', '2 business_company-1'])
    expect(seated.own.get(seatKey(1, 'seats-studio'))).toMatchObject({ index: 1, workspaceID: 'business_studio-0', plan: 'business_studio' })
  })

  // B61.90 — the business ladder as Lens states it (GET /v1/public/plans, talyvor-lens B61.57 defaults).
  const plan = (id: PublicPlan['id'], name: string, agents: number, people: number): PublicPlan =>
    ({ id, name, price_minor: null, agents, people, gates: { agents, seats: people, own_provider_keys: 'none', slack_teams_approvals: false } })
  const ladder = [plan('business_studio', 'Studio', 3, 1), plan('business_company', 'Company', 25, 5), plan('business_group', 'Group', -1, 25), plan('business_custom', 'Custom', -1, -1)]

  it("judges Company's 26th agent by the plan's refusal in Lens's plain sentence, with LENS_PLAN_GATES in its setting (B17.460)", () => {
    const refusal = { error: 'Company allows 25 agents, and all 25 are in use. Group allows unlimited agents.', setting: 'LENS_PLAN_GATES', plan: 'business_company', gate: 'agents', limit: 25, allows: 'business_group' }
    expect(pastAgentsVerdict({ status: 402, refusal }, ladder, ladder[1], '26th').pass).toBe(true)
    expect(pastAgentsVerdict({ status: 402, refusal: { ...refusal, setting: undefined } }, ladder, ladder[1], '26th').pass).toBe(false)
    expect(pastAgentsVerdict({ status: 402, refusal: { ...refusal, error: `LENS_PLAN_GATES: ${refusal.error}` } }, ladder, ladder[1], '26th').pass).toBe(false)
    expect(pastAgentsVerdict({ status: 201, agent: { id: 'ag_26' } }, ladder, ladder[1], '26th'))
      .toEqual({ pass: false, detail: 'a Company workspace with 25 agents made a 26th, ag_26' })
  })
})

describe("Track's refusal of one member too many (B17.460)", () => {
  const added = (error: string, plan: string, allows: string) => ({ status: 402, body: { error, code: 'PLAN_SEATS', plan, limit: 1, allows }, shown: `${error} See plans`, plansLink: true })
  const plan = (id: PublicPlan['id'], name: string, people: number): PublicPlan =>
    ({ id, name, price_minor: null, agents: 3, people, gates: { agents: 3, seats: people, own_provider_keys: 'none', slack_teams_approvals: false } })
  const ladder = [plan('business_studio', 'Studio', 1), plan('business_company', 'Company', 5), plan('business_group', 'Group', 25), plan('business_custom', 'Custom', -1)]

  it("writes Lens's plain sentences for Studio's second member and Company's sixth from the seats Lens states (B61.90)", () => {
    expect(seatsRefusal(ladder, ladder[0])).toEqual({ want: 'Studio allows 1 seat, and it is taken. Company allows 5.', allows: 'business_company' })
    expect(seatsRefusal(ladder, ladder[1])).toEqual({ want: 'Company allows 5 seats, and all 5 are taken. Group allows 25.', allows: 'business_group' })
    expect(seatsRefusal(ladder, ladder[2])).toEqual({ want: 'Group allows 25 seats, and all 25 are taken. Custom allows unlimited seats.', allows: 'business_custom' })
  })

  it("passes Lens's plain sentences for Studio's second member and Company's sixth, and fails the setting's name in the words", () => {
    const studio = seatsRefusal(ladder, ladder[0]).want
    const company = seatsRefusal(ladder, ladder[1]).want
    expect(notThePlansRefusal(added(studio, 'business_studio', 'business_company'), 'business_studio', 'business_company', studio)).toBeUndefined()
    expect(notThePlansRefusal(added(company, 'business_company', 'business_group'), 'business_company', 'business_group', company)).toBeUndefined()
    expect(notThePlansRefusal(added(`LENS_PLAN_GATES: ${studio}`, 'business_studio', 'business_company'), 'business_studio', 'business_company', studio)).toContain('LENS_PLAN_GATES')
    expect(notThePlansRefusal({ ...added(studio, 'business_studio', 'business_company'), status: 201 }, 'business_studio', 'business_company', studio)).toBe('the member was added (201)')
  })
})

describe('the fees Lens states (B35.7)', () => {
  const fees: Fees = { market_take_bps: 1500, services_take_bps: 500, platform_fee_bps: { business_studio: 550, business_company: 300, business_group: 100, business_custom: 100 } }

  it('takes the platform fee of the plan Lens holds the workspace to, by its key, as Lens picks it (B61.90)', () => {
    expect(['business_studio', 'business_company', 'business_group', 'nothing'].map((p) => platformFeeBPS(fees, p))).toEqual([550, 300, 100, 0])
  })

  it('leaves a payee the payment less the services fee, and a seller the sale less the take, rounded down to the µUSD', () => {
    expect(keptOf(70_000, fees.services_take_bps)).toBe(66_500)
    expect(keptOf(50_000, fees.market_take_bps)).toBe(42_500)
    expect(keptOf(33_333, fees.market_take_bps)).toBe(28_333)
  })
})
