import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App, queryClient } from '../../App'

// B32.55 — room settings. The mock BFF plays Lens for a private room's owner on Free: a member who may not spend, the
// room wallet's rules — its monthly limit is the room's budget, refused above the plan's room_budget_max_usd with Lens's
// rooms_plan_limits sentence (B32.32) —, a live invite link (B32.29) and an open $50 prize (B32.35). Each change the
// screen makes is read back from the mock BFF's state, never from what the screen sent.

const ME = 'ws_me'
const OTHER = 'ws_other'
// B55.34 — Lens names every member, and a named invite whose workspace has been a member, by its workspace.
const NAMES: Record<string, string> = { [ME]: 'Ben’s lab', [OTHER]: 'Ana’s studio' }
const PLAN_MAX_ULXC = 1_000_000_000 // Free's room_budget_max_usd, $100, at the peg

const LATE = 'ws_late'

function mockBff(split = 'equal') {
  const members = [
    { workspace_id: ME, workspace_name: NAMES[ME], role: 'owner', may_spend: true, terms_version: 1, terms_current: true, joined_at: '2026-10-01T09:00:00Z' },
    { workspace_id: OTHER, workspace_name: NAMES[OTHER], role: 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '2026-10-02T09:00:00Z' },
  ]
  // B55.28: a member still under the first terms, whom a payout leaves out.
  if (split === 'owner_decides') {
    members.push({ workspace_id: LATE, workspace_name: 'Cal’s shop', role: 'member', may_spend: false, terms_version: 0, terms_current: false, joined_at: '2026-10-03T09:00:00Z' })
  }
  const keys: string[] = []
  let rules = {
    max_per_request_ulxc: 0, hourly_limit_ulxc: 0, daily_limit_ulxc: 0, weekly_limit_ulxc: 0, monthly_limit_ulxc: 200_000_000,
    approval_above_ulxc: 0, requests_per_minute: 0, allowed_models: null, allowed_providers: null, allowed_listings: null,
    allowed_payees: null, blocked_payees: null, active_from: '', active_until: '', timezone: '',
  }
  const invites = [
    { id: 'rinv_1', room_id: 'room_1', kind: 'link', max_uses: 10, uses: 2, expires_at: '2026-10-14T09:00:00Z', live: true,
      created_by_workspace_id: ME, created_at: '2026-10-07T09:00:00Z' } as Record<string, unknown>,
  ]
  const prizes = [
    { id: 'rprz_1', room_id: 'room_1', poster_workspace_id: ME, title: 'Best pricing prompt', criteria: 'Wins the most deals',
      amount_usd_micros: 50_000_000, deadline: '2026-10-31T23:59:59Z', status: 'open', created_at: '2026-10-07T09:00:00Z' } as Record<string, unknown>,
  ]
  const sent: { method: string; url: string; body: Record<string, unknown> }[] = []
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    if (method !== 'GET') sent.push({ method, url, body })
    const json = (v: unknown, status = 200) =>
      new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (url === '/auth/me') return json({ mode: 'oidc', authenticated: true, user: { sub: 'u1', email: 'u1@example.com' } })
    // B55.14: Lens judges a change to an agent's rules first; these do not loosen them.
    if (url.endsWith('/rules-challenge')) return json({ looser: false, changes: [], allow_credentials: [] })
    if (url === '/api/rooms') return json({ rooms: [], joined: [], invited: null })
    if (url === '/api/rooms/room_1') {
      return json({
        id: 'room_1', owner_workspace_id: ME, title: 'Agent pricing', topic: 'research', description: '', visibility: 'private',
        status: 'open', terms_version: 1, member_count: members.length, created_at: '', last_activity_at: '2026-10-07T10:00:00Z',
        terms: { version: 1, split_rule: split, remix_share_bps: 1000, default_price_usd_micros: 100_000, spend_policy: 'members_with_spend', created_at: '' },
        members, agents: null, me: members[0],
        wallet: {
          agent_id: 'ag_room', name: 'Room: Agent pricing', balance_ulxc: 50_000_000, monthly_limit_ulxc: 200_000_000,
          spent_this_month_ulxc: 0, max_per_request_ulxc: 0, approval_above_ulxc: 0, budget_max_ulxc: PLAN_MAX_ULXC,
          spend_policy: 'members_with_spend', may_spend: true,
        },
      })
    }
    const member = /^\/api\/rooms\/room_1\/members\/([^/]+)$/.exec(url)
    if (member && method === 'PATCH') {
      const m = members.find((x) => x.workspace_id === decodeURIComponent(member[1]))!
      if (typeof body.may_spend === 'boolean') m.may_spend = body.may_spend
      return json(m)
    }
    if (url === '/api/agents/ag_room/rules') {
      if (method === 'PUT') {
        if (Number(body.monthly_limit_ulxc) > PLAN_MAX_ULXC) {
          return json({ error: 'a monthly limit of 2,000 LXC is above the room’s budget: rooms_plan_limits (LENS_ROOMS_PLAN_LIMITS): your free plan allows a room a budget of at most $100 (1,000 LXC) a month — the team plan allows $5000' }, 402)
        }
        rules = { ...rules, ...body } as typeof rules
      }
      return json(rules)
    }
    if (url === '/api/agents/approvals')
      return json({ approvals: [{ id: 'apr_1', agent_id: 'ag_room', amount_ulxc: 1_000_000, model: 'gpt-5', status: 'expired', created_at: '2026-10-06T09:00:00Z' }] })
    if (url === '/api/rooms/room_1/invites') return json({ invites })
    const invite = /^\/api\/rooms\/room_1\/invites\/([^/]+)$/.exec(url)
    if (invite && method === 'DELETE') {
      const i = invites.find((x) => x.id === invite[1])!
      Object.assign(i, { live: false, revoked_at: '2026-10-07T11:00:00Z' })
      return json(i)
    }
    if (url === '/api/rooms/room_1/contributions') {
      return json({ contributions: [{ id: 'c_1', room_id: 'room_1', listing_id: 'l_1', version: 1, kind: 'prompt', title: 'Pricing prompt',
        author_workspace_id: OTHER, status: 'accepted', tally: 2, up: 2, down: 0, my_vote: 1, created_at: '2026-10-07T09:30:00Z' }] })
    }
    if (url === '/api/rooms/room_1/prizes') return json({ prizes })
    const award = /^\/api\/rooms\/room_1\/prizes\/([^/]+)\/award$/.exec(url)
    if (award && method === 'POST') {
      const p = prizes.find((x) => x.id === award[1])!
      // nosemgrep: javascript.lang.security.insecure-object-assign.insecure-object-assign -- test-only: a fetch mock updating its own fixture object
      Object.assign(p, { status: 'awarded', contribution_id: body.contribution_id, winner_workspace_id: OTHER, awarded_at: '2026-10-07T11:00:00Z' })
      return json({ prize: p, licence: { use_id: 'u_1' } })
    }
    if (url === '/api/rooms/room_1/owner' && method === 'POST') {
      // B41.48: Lens makes the member the owner, the old owner an editor, and clears every member's may_spend.
      for (const m of members) {
        m.may_spend = false
        m.role = m.workspace_id === body.workspace_id ? 'owner' : m.role === 'owner' ? 'editor' : m.role
      }
      return json({})
    }
    if (url === '/api/money/accounts') {
      return json({ accounts: [{ id: 'macc_room', agent_id: 'ag_room', currency: 'USD', purpose: 'agent', status: 'open', name: 'Room: Agent pricing',
        balance_minor: 50_000, test_minor: 50_000, live_minor: 0 }] })
    }
    if (url === '/api/rooms/room_1/payouts' && method === 'POST') {
      // B55.28: Lens pays the owner's half and holds the member's, who has no verified payout details.
      keys.push(new Headers(init?.headers).get('Idempotency-Key') ?? '')
      const half = Number(body.amount_minor) / 2
      const p = (ws: string, status: string) => ({ id: `pay_${ws}`, kind: 'room_split', source: `room:room_1:${keys.at(-1)}`, recipient_workspace_id: ws,
        amount_minor: half, currency: body.currency, status, created_at: '' })
      return json({ agreement: 'room room_1 terms v1 equal', payouts: [p(ME, 'completed'), p(OTHER, 'held')] })
    }
    if (url === '/api/money/earnings-payouts') {
      const held = (id: string, source: string, minor: number) => ({ id, kind: 'room_split', source, recipient_workspace_id: ME, amount_minor: minor,
        currency: 'USD', status: 'held', created_at: '' })
      return json({ payouts: [held('pay_1', 'room:room_1:k1', 3_000), held('pay_2', 'room:room_1:k2', 1_500), held('pay_3', 'room:room_9:k1', 99_900)] })
    }
    if (url === '/api/room-invites/rinvtok_abc') {
      return json({
        room: { id: 'room_1', owner_workspace_id: ME, title: 'Agent pricing', topic: 'research', description: '', visibility: 'private',
          status: 'open', terms_version: 1, member_count: members.length, created_at: '', last_activity_at: '' },
        terms: { version: 1, split_rule: 'equal', remix_share_bps: 1000, default_price_usd_micros: 100_000, spend_policy: 'members_with_spend', created_at: '' },
        expires_at: '2026-10-14T09:00:00Z', uses_left: 8,
      })
    }
    if (url === '/api/room-invites/rinvtok_abc/join' && method === 'POST') {
      return json({ room_id: 'room_1', member: { workspace_id: OTHER, role: 'member', may_spend: false, terms_version: 1 } }, 201)
    }
    return new Response('null', { status: 404 })
  })
  return { sent, keys, invites, members }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  queryClient.clear()
})

describe('room settings', () => {
  it('gives a member may_spend and revokes an invite link, each read back from Lens', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    const spend = await screen.findByRole('button', { name: 'Ana’s studio may spend the room’s money' })
    expect(spend.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(spend)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ana’s studio may spend the room’s money' }).getAttribute('aria-pressed')).toBe('true'))
    expect(bff.sent.find((s) => s.method === 'PATCH')).toEqual({ method: 'PATCH', url: `/api/rooms/room_1/members/${OTHER}`, body: { may_spend: true } })

    const invites = await screen.findByRole('list', { name: 'Invites' })
    expect(within(invites).getByText('Live')).toBeTruthy()
    fireEvent.click(within(invites).getByRole('button', { name: /^Revoke invite/ }))
    expect(await within(invites).findByText('Revoked')).toBeTruthy()
    expect(within(invites).queryByRole('button', { name: /^Revoke invite/ })).toBeNull()
    expect(bff.sent.find((s) => s.method === 'DELETE')?.url).toBe('/api/rooms/room_1/invites/rinv_1')
  })

  // B55.7 — the room's approvals list an expired one as Expired, and the settings still draw.
  it('shows the room’s expired approval as Expired', async () => {
    mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)
    expect(await screen.findByText('Expired')).toBeInTheDocument()
    expect(screen.getByText('Not answered within 24 hours')).toBeInTheDocument()
  })

  it('hands the room to another member, and the owner is then its editor', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    fireEvent.change(await screen.findByLabelText('New owner'), { target: { value: OTHER } })
    fireEvent.click(screen.getByRole('button', { name: 'Hand over' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, hand it over' }))
    expect(await screen.findByText(/you are its editor/)).toBeTruthy()
    expect(bff.sent).toEqual([{ method: 'POST', url: '/api/rooms/room_1/owner', body: { workspace_id: OTHER } }])
    expect(screen.queryByLabelText('New owner')).toBeNull()
  })

  it('sets the room’s monthly budget through the rules editor, showing Lens’s refusal above the plan’s maximum', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    const budget = await screen.findByTestId('room-budget')
    expect(budget.textContent).toContain('200 LXC')
    const limit = await screen.findByLabelText('Monthly limit for Room: Agent pricing, in LXC')
    fireEvent.change(limit, { target: { value: '2000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    const refusal = await screen.findByText(/rooms_plan_limits/)
    expect(refusal.textContent).toBe(
      'A monthly limit of 2,000 LXC is above the room’s budget: rooms_plan_limits (LENS_ROOMS_PLAN_LIMITS): your free plan allows a room a budget of at most $100 (1,000 LXC) a month — the team plan allows $5000.',
    )
    expect(budget.textContent).toContain('200 LXC')

    fireEvent.change(limit, { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rules' }))
    await waitFor(() => expect(screen.getByTestId('room-budget').textContent).toContain('500 LXC'))
    expect(bff.sent.filter((s) => s.url === '/api/agents/ag_room/rules').map((s) => s.body.monthly_limit_ulxc)).toEqual([2_000_000_000, 500_000_000])
  })

  it('joins a private room through an invite link, accepting its terms, and opens the room', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/invite/rinvtok_abc')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Agent pricing' })).toBeTruthy()
    const join = screen.getByRole('button', { name: 'Join room' }) as HTMLButtonElement
    expect(join.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(join)
    await waitFor(() => expect(window.location.pathname).toBe('/rooms/room_1'))
    expect(bff.sent.find((s) => s.url === '/api/room-invites/rinvtok_abc/join')?.body).toEqual({ terms_version: 1 })
  })

  it('awards an open prize to a contribution, and the prize reads as awarded', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    const prizes = await screen.findByRole('list', { name: 'Prizes' })
    const winner = within(prizes).getByLabelText('Winner of Best pricing prompt')
    await within(winner).findByRole('option', { name: 'Pricing prompt' })
    fireEvent.change(winner, { target: { value: 'c_1' } })
    fireEvent.click(within(prizes).getByRole('button', { name: 'Award Best pricing prompt' }))
    expect(await within(prizes).findByText('Awarded to “Pricing prompt”')).toBeTruthy()
    expect(within(prizes).getByRole('status').textContent).toBe('Awarded. $50.00 is on your marketplace bill, and the winner is paid when it clears.')
    expect(bff.sent.find((s) => s.url.endsWith('/award'))).toEqual({
      method: 'POST', url: '/api/rooms/room_1/prizes/rprz_1/award', body: { contribution_id: 'c_1' },
    })
  })

  // B55.28 — the owner pays the room's members by its terms from the room's dollar account.
  it('pays out by equal shares under an Idempotency-Key, and shows each member’s result', async () => {
    const bff = mockBff()
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    const form = await screen.findByRole('form', { name: 'Pay out' })
    expect((await within(form).findByTestId('room-payout-account')).textContent).toMatch(/^The room’s USD account holds (US)?\$500\.00\.$/)
    fireEvent.change(within(form).getByLabelText('Amount'), { target: { value: '90' } })
    fireEvent.click(within(form).getByRole('button', { name: /^Pay out (US)?\$90\.00$/ }))
    expect(within(form).getByText(/^Pay (US)?\$90\.00 to 2 members by this room’s terms\?$/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Pay out' }))

    const results = await screen.findByRole('list', { name: 'Payout' })
    expect(within(results).getAllByRole('listitem').map((li) => li.textContent?.replace('US$', '$'))).toEqual([
      'You: $45.00, paid',
      `${NAMES[OTHER]}: $45.00, held until ${NAMES[OTHER]} saves payout details`,
    ])
    expect(bff.sent.filter((s) => s.url === '/api/rooms/room_1/payouts')).toEqual([
      { method: 'POST', url: '/api/rooms/room_1/payouts', body: { amount_minor: 9000, currency: 'USD' } },
    ])
    expect(bff.keys).toHaveLength(1)
    expect(bff.keys[0]).not.toBe('')
  })

  it('cannot pay out while the owner’s percents do not add to 100, and leaves out a member under old terms', async () => {
    const bff = mockBff('owner_decides')
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)

    const form = await screen.findByRole('form', { name: 'Pay out' })
    fireEvent.change(within(form).getByLabelText('Amount'), { target: { value: '90' } })
    fireEvent.change(within(form).getByLabelText('Percent for you'), { target: { value: '60' } })
    fireEvent.change(within(form).getByLabelText(`Percent for ${NAMES[OTHER]}`), { target: { value: '30' } })
    const pay = within(form).getByRole('button', { name: /^Pay out/ }) as HTMLButtonElement
    expect(pay.disabled).toBe(true)
    expect(within(form).queryByLabelText('Percent for Cal’s shop')).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Not in this payout' })).getByRole('listitem').textContent).toBe(
      'Cal’s shop · Not in this payout: has not accepted the current terms.',
    )

    fireEvent.change(within(form).getByLabelText(`Percent for ${NAMES[OTHER]}`), { target: { value: '40' } })
    expect(pay.disabled).toBe(false)
    fireEvent.click(pay)
    fireEvent.click(within(form).getByRole('button', { name: 'Pay out' }))
    await screen.findByRole('list', { name: 'Payout' })
    expect(bff.sent.find((s) => s.url === '/api/rooms/room_1/payouts')?.body).toEqual({
      amount_minor: 9000, currency: 'USD', shares: { [ME]: 6000, [OTHER]: 4000 },
    })
  })

  it('tells a member what this room holds for them, linking to Payout details', async () => {
    mockBff()
    window.history.pushState({}, '', '/rooms/room_1')
    render(<App />)

    const held = await screen.findByTestId('room-held-for-you')
    expect(held.textContent?.replace('US$', '$')).toBe('$45.00 from this room is held for you. Add your payout details to receive it.')
    expect(within(held).getByRole('link').getAttribute('href')).toBe('/settings/payout-details')
  })

  // B55.35 — members and named invites read by their workspace's name, never its id.
  it('shows members and invites by name', async () => {
    const named = { room_id: 'room_1', kind: 'named', max_uses: 1, uses: 0, live: true, created_by_workspace_id: ME, created_at: '2026-10-07T09:00:00Z' }
    mockBff().invites.push(
      { ...named, id: 'rinv_2', workspace_id: OTHER, workspace_name: NAMES[OTHER] },
      { ...named, id: 'rinv_3', workspace_id: 'ws_new' }, // never a member: Lens does not name it
    )
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)
    const invites = await screen.findByRole('list', { name: 'Invites' })
    expect(within(invites).getByText('For Ana’s studio')).toBeTruthy()
    expect(within(invites).getByText('For a workspace that has not joined yet')).toBeTruthy()
    const members = screen.getByRole('list', { name: 'Members' })
    expect(within(members).getByText('You')).toBeTruthy()
    expect(within(members).getByText('Ana’s studio')).toBeTruthy()
    expect(within(screen.getByLabelText('New owner')).getByRole('option', { name: 'Ana’s studio' })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/ws_other|ws_new/)
  })

  // B55.35 — a name is the workspace's own choice, so two members of one name are told apart where the owner hands over
  // the room or lets a member spend.
  it('tells two members of the same name apart', async () => {
    const bff = mockBff()
    bff.members.push({ workspace_id: 'ws_copycat', workspace_name: NAMES[OTHER], role: 'member', may_spend: false, terms_version: 1, terms_current: true, joined_at: '2026-10-03T09:00:00Z' })
    window.history.pushState({}, '', '/rooms/room_1/settings')
    render(<App />)
    const owner = await screen.findByLabelText('New owner')
    expect(within(owner).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Ana’s studio · other', 'Ana’s studio · copycat'])
    expect(screen.getByRole('button', { name: 'Ana’s studio · copycat may spend the room’s money' })).toBeTruthy()
  })
})
