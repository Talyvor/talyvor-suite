import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Members } from './Members'

// B57.44 — Pocket's w-members and w-members+add-member. The roster is Track's, LIVE from GET /api/members; the
// plan's seats are Lens's, from GET /api/plan, and Add a member says them BEFORE anyone tries: at the limit,
// "Free has 1 seat" with Close and See plans and no form; below it, the seats and then the form. A 402 Lens still
// answers reads in Lens's own sentence.
//
// An empty 200 roster is a CONTRADICTION on this route, not a fresh workspace: Track authorises the read from the
// same `members` table it lists, so an authorised caller is always in their own result set (W1.1.6, measured
// against Track's real handler).

const OWNER = { id: 'mem-owner', name: 'Ada Owner', email: 'ada@corp.example', role: 'owner', avatar_url: '' }
const MEMBER = { id: 'mem-1', name: 'Bo Member', email: 'bo@corp.example', role: 'member', avatar_url: '' }

const FREE = { plan: 'free', agents: 3, agents_used: 1, seats: 1 }
const TEAM = { plan: 'team', agents: 25, agents_used: 1, seats: 5 }
const GATES = {
  order: ['free', 'team', 'business', 'enterprise'],
  plans: { free: { seats: 1 }, team: { seats: 5 }, business: { seats: 25 }, enterprise: { seats: -1 } },
}

interface Bff {
  members?: { status?: number; body: unknown }
  plan?: { status?: number; body: unknown }
  add?: { status: number; body: unknown }
  me?: string | null
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function mockBff({ members = { body: [OWNER] }, plan = { body: FREE }, add, me = 'ada@corp.example' }: Bff = {}) {
  const posts: unknown[] = []
  // Track's roster as it stands: a 201 puts the added person in it, so the refetch after an add reads them.
  let roster = members.body
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input)
    if (url === '/auth/me')
      return json(me === null ? { mode: 'disabled', authenticated: false, user: null } : { mode: 'oidc', authenticated: true, user: { sub: 's', email: me } })
    if (url === '/api/plan') return json(plan.body, plan.status)
    if (url === '/api/pricing') return json({ min_usd_cents: 0, max_usd_cents: 0, preset_usd_cents: [], plan_gates: GATES })
    if (url === '/api/members' && init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      if ((add?.status ?? 201) === 201 && Array.isArray(roster)) roster = [...roster, add?.body]
      return json(add?.body ?? {}, add?.status ?? 201)
    }
    if (url === '/api/members') return json(roster, members.status)
    return json({}, 404)
  })
  return posts
}

function renderMembers() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <div data-design="pocket">
          <Members />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function openAdd() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add a member' }))
  return screen.findByRole('dialog')
}

afterEach(() => vi.restoreAllMocks())

const LINE = 'Everyone who can reach this workspace. 1 person, of whom 1 is an owner.'

describe('Members is the reference’s', () => {
  it('has the crumb Settings › Members and says who can reach the workspace', async () => {
    mockBff()
    renderMembers()
    const crumb = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumb).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings')
    expect(within(crumb).getByText('Members')).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === LINE)).toBeInTheDocument()
  })

  it('draws each member with an initial, a name, their role and "you", owners first', async () => {
    mockBff({ members: { body: [MEMBER, OWNER] } })
    renderMembers()
    expect(await screen.findByText('Owner · you')).toBeInTheDocument()
    expect(screen.getAllByText('Member')).toHaveLength(2) // the line and the chip
    const names = screen.getAllByText(/^(Ada Owner|Bo Member)$/).map((n) => n.textContent)
    expect(names).toEqual(['Ada Owner', 'Bo Member'])
    expect(screen.getByText('A')).toBeInTheDocument()
    expect(screen.getByText('B')).toBeInTheDocument()
    expect(screen.getByTestId('member-count')).toHaveTextContent('2 people')
  })

  it('marks "you" only on the row whose email is exactly the session’s', async () => {
    mockBff({ members: { body: [OWNER, MEMBER] }, me: 'ADA@corp.example' })
    renderMembers()
    await screen.findByText('Ada Owner')
    await waitFor(() => expect(screen.queryByText(/· you/)).toBeNull())
  })
})

describe('Add a member says the plan’s seats first', () => {
  it('at the limit: "Free has 1 seat", Close and See plans, and no form — before anyone tries', async () => {
    const posts = mockBff()
    renderMembers()
    const dialog = await openAdd()
    expect(await within(dialog).findByRole('heading', { name: 'Free has 1 seat' })).toBeInTheDocument()
    expect(within(dialog).getByText('Each person takes one of your plan’s seats. Free has 1, and you are in it. Team has 5.')).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans')
    expect(within(dialog).queryByLabelText('Email')).toBeNull()
    // The close x and the Close button both close it; the reference draws both.
    fireEvent.click(within(dialog).getAllByRole('button', { name: 'Close' }).at(-1)!)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(posts).toEqual([])
  })

  it('below the limit: the seats, then the form with email and role', async () => {
    const posts = mockBff({ plan: { body: TEAM }, add: { status: 201, body: { ...MEMBER, email: 'cy@corp.example', name: 'cy@corp.example' } } })
    renderMembers()
    const dialog = await openAdd()
    const seats = await within(dialog).findByText('Each person takes one of your plan’s seats. Team has 5, and you are in it.')
    const email = within(dialog).getByLabelText('Email')
    expect(seats.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.change(email, { target: { value: 'cy@corp.example' } })
    fireEvent.change(within(dialog).getByLabelText('Role'), { target: { value: 'owner' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add member' }))
    expect(await screen.findByText('cy@corp.example')).toBeInTheDocument()
    expect(posts).toEqual([{ email: 'cy@corp.example', role: 'owner' }])
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a 402 still reads in Lens’s words, with See plans', async () => {
    const sentence = 'Free has 1 seat, and it is taken. Team has 5.'
    mockBff({ plan: { body: TEAM }, add: { status: 402, body: { error: sentence, plan: 'free', gate: 'seats', limit: 1, allows: 'team' } } })
    renderMembers()
    const dialog = await openAdd()
    fireEvent.change(await within(dialog).findByLabelText('Email'), { target: { value: 'cy@corp.example' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add member' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(sentence)
    expect(within(dialog).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans')
    expect(within(dialog).getByRole('alert').textContent).not.toMatch(/LENS_PLAN_GATES/)
  })

  it('an unread plan still offers the form, and Lens decides', async () => {
    mockBff({ plan: { status: 502, body: { error: 'x' } } })
    renderMembers()
    const dialog = await openAdd()
    expect(await within(dialog).findByLabelText('Email')).toBeInTheDocument()
    expect(within(dialog).getByText('Each person takes one of your plan’s seats.')).toBeInTheDocument()
  })

  it('a member who is not an owner is told who can add, and gets no button', async () => {
    mockBff({ members: { body: [OWNER, MEMBER] }, me: 'bo@corp.example' })
    renderMembers()
    expect(await screen.findByTestId('who-can-add')).toHaveTextContent('Only an owner of this workspace can add members.')
    expect(screen.queryByRole('button', { name: 'Add a member' })).toBeNull()
  })
})

describe('what the roster read answered', () => {
  it('a 503 reads as not reachable, with no count and no button', async () => {
    mockBff({ members: { status: 503, body: { error: 'track not configured' } } })
    renderMembers()
    expect(await screen.findByText('Members aren’t reachable from this session, so nobody is shown.')).toBeInTheDocument()
    expect(screen.queryByTestId('member-count')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add a member' })).toBeNull()
  })

  it('a failed read is a fault, never an empty list', async () => {
    mockBff({ members: { status: 500, body: { error: 'boom' } } })
    renderMembers()
    expect(await screen.findByText('Couldn’t read the members. This is a fault, not an empty list.')).toBeInTheDocument()
  })

  it('an empty answer (null or []) is the contradiction, not a fresh workspace', async () => {
    mockBff({ members: { body: null } })
    renderMembers()
    expect(await screen.findByTestId('roster-contradiction')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a member' })).toBeNull()
  })
})
