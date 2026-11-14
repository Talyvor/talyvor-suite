import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Crumb, Dialog, Field, Icon, Input, Row, Select, showSnack } from '@talyvor/ui/pocket'
import { getJSONArray } from '../../lib/api'
import { useAuthMeReader } from '../../lib/authMe'
import { isSessionExpired, isUnconfigured } from '../../lib/productState'
import { MemberAddError, addMember } from './membersApi'
import { PLAN_KEY, readWorkspacePlan, type WorkspacePlan } from './agentBankApi'
import { formatLimit, planName, usePricing, type PlanGates } from '../marketing/pricingApi'

// Members — the workspace roster, LIVE from GET /api/members (the BFF proxies Track's
// /v1/workspaces/{ws}/members, the workspace resolved from the session per request, the session
// email sent as the membership join key). Track answers 503 where it is not wired; that state is
// DETECTED from the response (lib/productState.ts), never written here.
//
// B57.44 — Pocket's w-members: the crumb Settings › Members, the count of people and owners, each
// member with an initial, a name, their role and "you". Add a member opens a dialog that says the
// plan's seats first, from GET /api/plan: at the limit it is "Free has 1 seat" with Close and See
// plans, before anyone tries; below it, the seats and then the form. A 402 still reads in Lens's words.
//
// ⚠ AN EMPTY ROSTER IS A CONTRADICTION ON THIS ROUTE, NOT A FRESH WORKSPACE. Track authorises the
// read from the same `members` table it then lists, so an authorised caller is always in their own
// result set (measured against Track's real handler under W1.1.6). The branch says what it means.

/** Track internal/member/mgmt_handler.go memberView, verbatim. */
export interface RosterMember {
  id: string
  name: string
  email: string
  role: 'owner' | 'member'
  avatar_url: string
}

/**
 * The membership join key, compared the way the upstream compared it: the BFF sends the session
 * email and Track matches `members.email` with SQL `=`. So the comparison is EXACT — case-folding
 * here would mark a row the upstream did not match, on the screen whose whole subject is identity.
 */
function isSessionRow(m: RosterMember, sessionEmail: string | null): boolean {
  return sessionEmail !== null && m.email === sessionEmail
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`
const seatsWord = (n: number) => (n < 0 ? 'unlimited seats' : `${formatLimit(n)} ${n === 1 ? 'seat' : 'seats'}`)

/** Whether the plan takes another member: false only when Lens said its seats and every one is taken. */
export function seatsFull(plan: WorkspacePlan | undefined, members: number): boolean {
  return plan !== undefined && plan.seats >= 0 && members >= plan.seats
}

/** The next plan up that takes more members than this one, as /api/pricing's plan gates state them. */
export function nextSeats(gates: PlanGates | undefined, plan: WorkspacePlan): { name: string; seats: number } | null {
  if (!gates) return null
  const at = gates.order.indexOf(plan.plan)
  if (at < 0) return null
  for (const id of gates.order.slice(at + 1)) {
    const seats = gates.plans[id]?.seats
    if (seats !== undefined && (seats < 0 || (plan.seats >= 0 && seats > plan.seats))) return { name: planName(id), seats }
  }
  return null
}

/** "Free has 1, and you are in it. Team has 5." — the plan's seats, said before anyone is added. */
export function seatsLine(plan: WorkspacePlan, members: number, youAreIn: boolean, next: { name: string; seats: number } | null): string {
  const name = planName(plan.plan)
  const taken =
    plan.seats < 0
      ? `${name} has unlimited seats.`
      : members === 1 && youAreIn
        ? `${name} has ${formatLimit(plan.seats)}, and you are in it.`
        : `${name} has ${formatLimit(plan.seats)}, and ${formatLimit(Math.min(members, plan.seats))} ${members === 1 ? 'is' : 'are'} taken.`
  const up = next ? ` ${next.name} has ${next.seats < 0 ? 'unlimited seats' : formatLimit(next.seats)}.` : ''
  return `Each person takes one of your plan’s seats. ${taken}${seatsFull(plan, members) ? up : ''}`
}

/** What the dialog says when an add is refused. A 402 is Lens's own sentence and is drawn verbatim. */
function addRefusal(err: unknown, email: string): string {
  if (isSessionExpired(err)) return 'Sign in again to add a member.'
  if (err instanceof MemberAddError) {
    if (err.status === 402 && err.sentence) return err.sentence
    if (err.code === 'MEMBER_EXISTS') return `${email} is already a member of this workspace.`
    if (err.code === 'OWNER_REQUIRED') return 'Only an owner of this workspace can add members.'
    if (err.code === 'SEATS_UNCHECKED')
      return 'Your plan’s seats couldn’t be checked just now, so nobody was added. Try again shortly.'
  }
  return 'Nobody was added. You can try again.'
}

function SeePlans() {
  return (
    <Button asChild variant="primary">
      <Link to="/plans">See plans</Link>
    </Button>
  )
}

/** B32.72, B57.44 — Add a member: the plan's seats first, then (while one is free) the email and the role. */
function AddMemberDialog({ members, youAreIn, onClose }: { members: number; youAreIn: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const plan = useQuery({ queryKey: PLAN_KEY, queryFn: readWorkspacePlan, retry: false })
  const pricing = usePricing()
  const gates = pricing.status === 'ok' ? pricing.pricing.plan_gates : undefined
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'member' | 'owner'>('member')
  const [sent, setSent] = useState('')
  const add = useMutation({
    mutationFn: () => addMember(email.trim(), role),
    onMutate: () => setSent(email.trim()),
    onSuccess: (m) => {
      // The new row is drawn from Track's answer at once; the refetch then confirms it.
      qc.setQueryData<RosterMember[]>(['members'], (old) => [...(old ?? []).filter((r) => r.id !== m.id), m])
      void qc.invalidateQueries({ queryKey: ['members'] })
      void qc.invalidateQueries({ queryKey: PLAN_KEY })
      showSnack({ title: `Added: ${m.email}`, line: `They are ${m.role === 'owner' ? 'an owner' : 'a member'} of this workspace.` })
      onClose()
    },
  })

  if (plan.isPending) {
    return (
      <Dialog open onClose={onClose} title="Add a member">
        <p>Reading your plan’s seats…</p>
      </Dialog>
    )
  }

  const served = plan.data
  const next = served ? nextSeats(gates, served) : null

  if (served && seatsFull(served, members)) {
    return (
      <Dialog
        open
        onClose={onClose}
        title={`${planName(served.plan)} has ${seatsWord(served.seats)}`}
        actions={
          <>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
            <SeePlans />
          </>
        }
      >
        <p data-testid="member-seats">{seatsLine(served, members, youAreIn, next)}</p>
      </Dialog>
    )
  }

  const planRefusal = add.error instanceof MemberAddError && add.error.status === 402
  const submit = () => {
    if (email.trim() && !add.isPending) add.mutate()
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a member"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {planRefusal ? <SeePlans /> : null}
          <Button type="submit" form="add-member" variant="primary" disabled={!email.trim() || add.isPending}>
            {add.isPending ? 'Adding…' : 'Add member'}
          </Button>
        </>
      }
    >
      <p data-testid="member-seats">
        {served ? seatsLine(served, members, youAreIn, next) : 'Each person takes one of your plan’s seats.'}
      </p>
      <form
        id="add-member"
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Email">
          <Input
            type="email"
            autoComplete="off"
            spellCheck={false}
            value={email}
            placeholder="name@company.com"
            onChange={(e) => setEmail(e.target.value)}
            disabled={add.isPending}
          />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value === 'owner' ? 'owner' : 'member')} disabled={add.isPending}>
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </Select>
        </Field>
      </form>
      {add.isError ? (
        <p role="alert" data-testid="member-add-refusal" className="text-ink">
          {addRefusal(add.error, sent)}
        </p>
      ) : null}
    </Dialog>
  )
}

function Initial({ name }: { name: string }) {
  return (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-cloud-2 text-body font-bold text-ink">
      {(name.trim().charAt(0) || '?').toUpperCase()}
    </span>
  )
}

export function Members() {
  const q = useQuery({
    queryKey: ['members'],
    // getJSONArray, not getJSON: an empty list arrives as JSON `null` from Go's `var out []T` idiom.
    queryFn: () => getJSONArray<RosterMember>('/api/members'),
  })
  const [adding, setAdding] = useState(false)

  // A passive reader of the gate's /auth/me probe; `user` is null in disabled mode, where nothing may be marked.
  const me = useAuthMeReader()
  const sessionEmail = me.data?.user?.email ?? null

  const roster = [...(q.data ?? [])].sort(
    (a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name),
  )

  // Each state is computed from the query object, not inferred from the array: `data` is undefined both while
  // loading and on error, and a failed read must never read as a workspace with nobody in it.
  const unconfigured = isUnconfigured(q.error)
  const failed = q.isError && !unconfigured
  const served = !q.isError && !q.isPending && q.data !== undefined
  const contradiction = served && roster.length === 0
  const owners = roster.filter((m) => m.role === 'owner').length
  const youAreIn = roster.some((m) => isSessionRow(m, sessionEmail))
  const youAreNotOwner = roster.some((m) => isSessionRow(m, sessionEmail) && m.role !== 'owner')

  return (
    <div className="grid min-w-0 gap-5">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: 'Members' }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-reading text-ink-2">
          Everyone who can reach this workspace.
          {served && roster.length > 0 ? (
            <>
              {' '}
              <span data-testid="member-count">{people(roster.length)}</span>, of whom {owners}{' '}
              {owners === 1 ? 'is an owner' : 'are owners'}.
            </>
          ) : null}
        </p>
        {served && roster.length > 0 && !youAreNotOwner ? (
          <Button icon={<Icon name="plus" size={18} />} onClick={() => setAdding(true)}>
            Add a member
          </Button>
        ) : null}
      </div>

      {q.isPending ? (
        <p className="text-body text-ink-2">Reading members…</p>
      ) : unconfigured ? (
        <p className="max-w-2xl text-body text-ink-2">Members aren’t reachable from this session, so nobody is shown.</p>
      ) : failed ? (
        <p className="max-w-2xl text-body text-ink-2">
          {isSessionExpired(q.error)
            ? 'The members can’t be read until you sign in again.'
            : 'Couldn’t read the members. This is a fault, not an empty list.'}
        </p>
      ) : contradiction ? (
        <p data-testid="roster-contradiction" className="max-w-2xl text-body text-ink-2">
          The members came back with nobody in them, including you. That should not happen, so nothing is shown rather than an empty
          workspace.
        </p>
      ) : (
        <Card tone="white">
          {roster.map((m) => {
            const you = isSessionRow(m, sessionEmail)
            const role = m.role === 'owner' ? 'Owner' : 'Member'
            return (
              <Row
                key={m.id}
                leading={<Initial name={m.name || m.email} />}
                title={m.name || m.email}
                line={you ? `${role} · you` : role}
                action={<Chip>{role}</Chip>}
              />
            )
          })}
        </Card>
      )}

      {youAreNotOwner ? (
        <p data-testid="who-can-add" className="max-w-2xl text-body text-ink-2">
          Only an owner of this workspace can add members. Ask one of the owners above.
        </p>
      ) : null}

      {adding ? <AddMemberDialog members={roster.length} youAreIn={youAreIn} onClose={() => setAdding(false)} /> : null}
    </div>
  )
}
