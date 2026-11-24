import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Crumb, Dialog, Field, Icon, Input, Row, Select, showSnack } from '@talyvor/ui/pocket'
import { useAccount } from './agentBankApi'
import { ACCOUNTS_KEY, readAccounts, switchAccount } from './accountsApi'
import { accountName } from './YourAccounts'
import { readFailure } from './WalletMoney'
import { amountMinor } from './Wallets'
import { minorText } from './OperatorCompliance'
import { setSecondApproverSigned } from './passkeys'
import { useKeys } from './AgentBank'
import {
  APPROVING_ROLES,
  GIVEN_ROLES_KEY,
  MY_ROLES_KEY,
  ROLES,
  ROLE_LINE,
  ROLE_NAME,
  SECOND_APPROVER_KEY,
  refusal,
  roleName,
  rolesApi,
  teamTitle,
  type GivenRole,
  type Role,
  type RoleAccount,
  type SecondApproverLine,
} from './rolesApi'

// TeamRoles.tsx — B28.70: /settings/team. A Business account's owner gives people a role (Viewer, Finance, Approver,
// Admin) by their email, sees who has signed in with one and takes it away. Everyone can open an account someone gave
// them a role in: they prove their email with a code mailed to it, and the account joins Your accounts. Lens decides
// what a role may do on every request (talyvor-lens B28.342), so a Viewer's fund is refused there and moves nothing.
//
// B57.211 — drawn in Pocket as w-members: the page's line with Give a role at its end, which opens the form in a
// dialog as Add a member does; Your team and Accounts shared with you are white cards side by side (7 and 5), each
// person or account a w-members row with its initial and its role as a chip. Remove asks first, as w-security's
// Remove does for a key. The BFF calls and their words are unchanged.
// B28.40: the owner names a second approver, an Approver or Admin who has signed in, and the amount above which a
// payment needs two people's approvals, one of them theirs (talyvor-lens B28.315). Setting it asks for the passkey.

export const TEAM_PATH = '/settings/team'

const ENTER_EMAIL = 'Enter an email address.'

function Initial({ of }: { of: string }) {
  return (
    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-pill bg-cloud-2 text-body font-bold text-ink">
      {(of.trim().charAt(0) || '?').toUpperCase()}
    </span>
  )
}

/** A white card's own heading and the line under it, as Members' invite links. */
function CardHeading({ id, children, line }: { id: string; children: React.ReactNode; line?: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <h2 id={id} className="font-display text-reading font-bold text-ink">
        {children}
      </h2>
      {line ? <p className="text-body text-ink-2">{line}</p> : null}
    </div>
  )
}

/** Give a role, as w-members' Add a member: the email, the role and what that role may do, then Give role. */
function GiveRoleDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [empty, setEmpty] = useState(false)
  const give = useMutation({
    mutationFn: () => rolesApi.give(email.trim(), role),
    onSuccess: async (r) => {
      showSnack({ title: 'Role given', line: `${r.email} is now ${roleName(r.role)}.` })
      onClose()
      await qc.invalidateQueries({ queryKey: GIVEN_ROLES_KEY })
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Give a role"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="give-role" disabled={give.isPending}>
            {give.isPending ? 'Giving…' : 'Give role'}
          </Button>
        </>
      }
    >
      <p>They open your company’s account by proving this email with a code we send to it.</p>
      <form
        id="give-role"
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          setEmpty(!email.trim())
          if (email.trim() && !give.isPending) give.mutate()
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
            disabled={give.isPending}
          />
        </Field>
        <Field label="Role">
          <Select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={give.isPending}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_NAME[r]}
              </option>
            ))}
          </Select>
        </Field>
        <p data-testid="role-line" className="text-body text-ink-2">
          {ROLE_LINE[role]}
        </p>
      </form>
      {empty ? (
        <p role="alert" className="text-danger">
          {ENTER_EMAIL}
        </p>
      ) : null}
      {give.isError ? (
        <p role="alert" className="text-danger">
          {refusal(give.error, 'That role wasn’t given. Try again.')}
        </p>
      ) : null}
    </Dialog>
  )
}

/** Remove, asked first as w-security asks before a key is removed. */
function RemoveRoleDialog({ given, onClose }: { given: GivenRole; onClose: () => void }) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: () => rolesApi.remove(given.email),
    onSuccess: async () => {
      showSnack({ title: 'Role removed', line: `${given.email} no longer has a role.` })
      onClose()
      await qc.invalidateQueries({ queryKey: GIVEN_ROLES_KEY })
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={<span className="break-all">{`Remove “${given.email}”?`}</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? 'Removing…' : 'Remove it'}
          </Button>
        </>
      }
    >
      <p>They can no longer open your company’s account as {roleName(given.role)}.</p>
      {remove.isError ? (
        <p role="alert" className="text-danger">
          {refusal(remove.error, 'That role wasn’t removed. Try again.')}
        </p>
      ) : null}
    </Dialog>
  )
}

/** The owner's half: the roles given, each with its chip and Remove. */
function YourTeam() {
  const given = useQuery({ queryKey: GIVEN_ROLES_KEY, queryFn: rolesApi.given, retry: false })
  const [removing, setRemoving] = useState<GivenRole | null>(null)
  return (
    <section aria-labelledby="your-team" className="min-w-0 wide:col-span-7">
      <Card tone="white" className="grid gap-3.5">
        <CardHeading id="your-team">Your team</CardHeading>
        {given.isPending ? (
          <p className="text-body text-ink-2">Reading…</p>
        ) : given.isError ? (
          <p className="text-body text-ink-2">{readFailure(given.error, 'Your team')}</p>
        ) : given.data.length === 0 ? (
          <p className="text-body text-ink-2">You haven’t given anyone a role yet.</p>
        ) : (
          <ul aria-label="Your team">
            {given.data.map((r) => (
              <li key={r.email}>
                <Row
                  leading={<Initial of={r.email} />}
                  title={<span className="break-all">{r.email}</span>}
                  wrap
                  line={r.signed_in ? 'Has signed in' : 'Hasn’t signed in yet'}
                  action={
                    <span className="flex items-center gap-2">
                      <Chip>{roleName(r.role)}</Chip>
                      <Button size="sm" variant="secondary" onClick={() => setRemoving(r)}>
                        Remove
                      </Button>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {given.isSuccess ? <SecondApprover team={given.data} /> : null}
      {removing ? <RemoveRoleDialog given={removing} onClose={() => setRemoving(null)} /> : null}
    </section>
  )
}

/** What went wrong saving the second approver, in words. */
function lineRefusal(err: unknown): string {
  if (err instanceof DOMException && err.name === 'NotAllowedError') return 'Cancelled. Nothing changed.'
  return refusal(err, 'The second approver wasn’t saved. Try again.')
}

/** No second approver: Lens clears the line it is sent empty. */
const NO_LINE: SecondApproverLine = { user_id: '', above_minor: 0, currency: '' }

/** The words a saved or removed second approver is told in. */
function savedSnack(l: SecondApproverLine) {
  showSnack(l.user_id ? { title: 'Second approver saved', line: `Above ${minorText(l.above_minor, l.currency)}, a payment needs two approvals.` } : { title: 'Second approver removed', line: 'One approval is enough again.' })
}

/** B57.212 — choosing the second approver and the line, in a dialog as Give a role is: Who, Above and Currency, then Save. */
function SecondApproverDialog({ people, now, currencies, signs, onClose }: { people: GivenRole[]; now: SecondApproverLine | null; currencies: string[]; signs: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [who, setWho] = useState(now && people.some((r) => r.user_id === now.user_id) ? now.user_id : (people[0]?.user_id ?? ''))
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState(now?.currency || currencies[0] || 'GBP')
  const [wrong, setWrong] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (l: SecondApproverLine) => setSecondApproverSigned(l),
    onSuccess: async (_, l) => {
      savedSnack(l)
      onClose()
      await qc.invalidateQueries({ queryKey: SECOND_APPROVER_KEY })
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Second approver"
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="second-approver-line" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <p>Above this amount, a payment needs two people to approve it, and one of them is the person you pick here.</p>
      <form
        id="second-approver-line"
        className="grid gap-3.5"
        onSubmit={(e) => {
          e.preventDefault()
          const minor = amountMinor(amount, currency)
          setWrong(minor === null ? 'Enter an amount above 0.' : null)
          if (minor !== null && !save.isPending) save.mutate({ user_id: who, above_minor: minor, currency })
        }}
      >
        <Field label="Who">
          <Select value={who} onChange={(e) => setWho(e.target.value)} disabled={save.isPending}>
            {people.map((r) => (
              <option key={r.user_id} value={r.user_id}>
                {`${r.email} · ${roleName(r.role)}`}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Above">
            <Input inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={save.isPending} />
          </Field>
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={save.isPending}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {signs ? <p className="text-caption text-ink-3">Saving asks for your passkey.</p> : null}
      </form>
      {wrong ? (
        <p role="alert" className="text-danger">
          {wrong}
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-danger">
          {lineRefusal(save.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

/** B57.212 — Remove asks first, as a role's Remove does, and is signed as saving is. */
function RemoveSecondApproverDialog({ email, signs, onClose }: { email: string; signs: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: () => setSecondApproverSigned(NO_LINE),
    onSuccess: async () => {
      savedSnack(NO_LINE)
      onClose()
      await qc.invalidateQueries({ queryKey: SECOND_APPROVER_KEY })
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title={<span className="break-all">{`Remove “${email}” as second approver?`}</span>}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? 'Removing…' : 'Remove it'}
          </Button>
        </>
      }
    >
      <p>One approval is enough again, whatever the amount.</p>
      {signs ? <p className="text-caption text-ink-3">Removing asks for your passkey.</p> : null}
      {remove.isError ? (
        <p role="alert" className="text-danger">
          {lineRefusal(remove.error)}
        </p>
      ) : null}
    </Dialog>
  )
}

/**
 * B28.40 — the owner's second approver: who, and above which amount a payment needs two approvals.
 * B57.212 — drawn in Pocket: the line set is a w-members row (initial, who, the amount, their role as a chip) with Remove,
 * which asks first; Choose or Change opens the line in a dialog, as Give a role does.
 */
function SecondApprover({ team }: { team: GivenRole[] }) {
  const { shows } = useAccount()
  const { thisBrowserSigns } = useKeys()
  const currencies = [...(shows?.bankTransfers !== false ? ['GBP', 'EUR', 'USD'] : []), ...(shows?.onChain ? ['USDC'] : [])]
  const line = useQuery({ queryKey: SECOND_APPROVER_KEY, queryFn: rolesApi.secondApprover, retry: false })
  const people = team.filter((r) => APPROVING_ROLES.includes(r.role) && !!r.user_id)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)
  const person = (id: string) => team.find((r) => r.user_id === id)
  const named = (id: string) => person(id)?.email ?? 'someone no longer in your team'
  const now = line.data && line.data.user_id && line.data.above_minor > 0 ? line.data : null
  const role = now ? person(now.user_id)?.role : undefined
  return (
    <Card tone="white" className="mt-4 grid gap-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CardHeading id="second-approver" line="Above an amount you choose, a payment needs two people to approve it, and one of them is your second approver.">
          Second approver
        </CardHeading>
        {line.isSuccess && people.length > 0 ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {now ? 'Change' : 'Choose'}
          </Button>
        ) : null}
      </div>
      {line.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : line.isError ? (
        <p className="text-body text-ink-2">{readFailure(line.error, 'Your second approver')}</p>
      ) : (
        <>
          {now ? (
            <ul aria-label="Second approver" data-testid="second-approver-now">
              <li>
                <Row
                  leading={<Initial of={named(now.user_id)} />}
                  title={<span className="break-all">{named(now.user_id)}</span>}
                  wrap
                  line={`Above ${minorText(now.above_minor, now.currency)}`}
                  action={
                    <span className="flex items-center gap-2">
                      {role ? <Chip>{roleName(role)}</Chip> : null}
                      <Button size="sm" variant="secondary" onClick={() => setRemoving(true)}>
                        Remove
                      </Button>
                    </span>
                  }
                />
              </li>
            </ul>
          ) : (
            <p className="text-body text-ink-2">No second approver: one approval is enough.</p>
          )}
          {people.length === 0 ? (
            <p className="text-body text-ink-2">Give someone the Approver or Admin role. Once they have signed in, you can pick them here.</p>
          ) : null}
        </>
      )}
      {editing ? <SecondApproverDialog people={people} now={now} currencies={currencies} signs={thisBrowserSigns} onClose={() => setEditing(false)} /> : null}
      {removing && now ? <RemoveSecondApproverDialog email={named(now.user_id)} signs={thisBrowserSigns} onClose={() => setRemoving(false)} /> : null}
    </Card>
  )
}

/** Everyone's half: prove an email with a code, and open the accounts a role was given in. */
function SharedWithYou({ span }: { span: 5 | 7 }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [empty, setEmpty] = useState<'email' | 'code' | null>(null)
  const mine = useQuery({ queryKey: MY_ROLES_KEY, queryFn: rolesApi.mine, retry: false })
  const ask = useMutation({
    mutationFn: () => rolesApi.sendCode(email.trim()),
    onSuccess: (r) => {
      setSentTo(r.email)
      setCode('')
    },
  })
  const check = useMutation({
    mutationFn: () => rolesApi.checkCode(sentTo ?? '', code.trim()),
    onSuccess: async (r) => {
      setSentTo(null)
      setEmail('')
      setCode('')
      showSnack({ title: 'Email proved', line: r.email })
      await Promise.all([qc.invalidateQueries({ queryKey: MY_ROLES_KEY }), qc.invalidateQueries({ queryKey: ACCOUNTS_KEY })])
    },
  })
  const open = useMutation({
    mutationFn: (a: RoleAccount) => switchAccount(a.id),
    onSuccess: async () => {
      navigate('/', { replace: true })
      // The session is on the other account now: nothing read for the one it left is kept.
      await qc.resetQueries()
    },
  })
  return (
    <section aria-labelledby="shared-with-you" className={span === 5 ? 'min-w-0 wide:col-span-5' : 'min-w-0 wide:col-span-7'}>
    <Card tone="white" className="grid gap-3.5">
      <CardHeading id="shared-with-you" line="Someone gave a role to your email? Prove it’s yours with a code we send to it, and their account opens from Your accounts.">
        Accounts shared with you
      </CardHeading>
      {mine.isPending ? (
        <p className="text-body text-ink-2">Reading…</p>
      ) : mine.isError ? (
        <p className="text-body text-ink-2">{readFailure(mine.error, 'Accounts shared with you')}</p>
      ) : (
        <>
          {mine.data.emails.length > 0 ? <p className="break-all text-body text-ink-2">Proved: {mine.data.emails.join(', ')}</p> : null}
          {mine.data.accounts.length > 0 ? (
            <ul aria-label="Accounts shared with you">
              {mine.data.accounts.map((a) => (
                <li key={a.id}>
                  <Row
                    leading={<Initial of={accountName(a)} />}
                    title={accountName(a)}
                    line={<span className="break-all">{a.email}</span>}
                    wrap
                    action={
                      <span className="flex items-center gap-2">
                        <Chip>{roleName(a.role)}</Chip>
                        {a.current ? (
                          <Chip tone="good">Current</Chip>
                        ) : (
                          <Button size="sm" disabled={open.isPending} onClick={() => open.mutate(a)}>
                            Open
                          </Button>
                        )}
                      </span>
                    }
                  />
                </li>
              ))}
            </ul>
          ) : mine.data.emails.length > 0 ? (
            <p className="text-body text-ink-2">No account has given a role to these emails yet.</p>
          ) : null}
        </>
      )}
      {open.isError ? (
        <p role="alert" className="text-body text-danger">
          That account didn’t open. Try again.
        </p>
      ) : null}
      {sentTo === null ? (
        <form
          className="grid gap-3 border-t border-line pt-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            setEmpty(email.trim() ? null : 'email')
            if (email.trim() && !ask.isPending) ask.mutate()
          }}
        >
          <Field label="Your email">
            <Input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          {empty === 'email' ? (
            <p role="alert" className="text-body text-danger">
              {ENTER_EMAIL}
            </p>
          ) : null}
          {ask.isError ? (
            <p role="alert" className="text-body text-danger">
              {refusal(ask.error, 'That code didn’t send. Try again.')}
            </p>
          ) : null}
          <div>
            <Button type="submit" variant="secondary" disabled={ask.isPending}>
              {ask.isPending ? 'Sending…' : 'Send code'}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="grid gap-3 border-t border-line pt-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            setEmpty(code.trim() ? null : 'code')
            if (code.trim() && !check.isPending) check.mutate()
          }}
        >
          <p className="text-body text-ink-2">We sent a code to {sentTo}. It works for 10 minutes.</p>
          <Field label="Code">
            <Input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          {empty === 'code' ? (
            <p role="alert" className="text-body text-danger">
              Enter the code from the email.
            </p>
          ) : null}
          {check.isError ? (
            <p role="alert" className="text-body text-danger">
              {refusal(check.error, 'That code isn’t right, or it has run out. Ask for a new one.')}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={check.isPending}>
              {check.isPending ? 'Checking…' : 'Confirm'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setSentTo(null)}>
              Use another email
            </Button>
          </div>
        </form>
      )}
    </Card>
    </section>
  )
}

/** /settings/team — Team and roles. */
export function TeamRolesScreen() {
  const { account } = useAccount()
  const accounts = useQuery({ queryKey: ACCOUNTS_KEY, queryFn: readAccounts, retry: false })
  const here = accounts.data?.find((a) => a.current)
  // The owner's half on a Business account the person owns; a role session never gives roles.
  const business = account?.account_type === 'business'
  const owner = business && accounts.isSuccess && !here?.role
  const page = teamTitle(business)
  const [giving, setGiving] = useState(false)
  return (
    <div className="grid min-w-0 gap-5 px-gutter py-4 wide:py-6">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: page }]} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid max-w-3xl gap-1">
          <h2 className="font-display text-title font-bold text-ink">{business ? 'Who in your team can see, pay and approve' : 'Open an account someone gave you a role in'}</h2>
          {here?.role ? (
            <p className="text-reading text-ink-2">
              You are {roleName(here.role)} in {accountName(here)}. {ROLE_LINE[here.role as Role] ?? ''}
            </p>
          ) : business ? (
            <p className="text-reading text-ink-2">Give each person the role they need. Keys, passkeys and roles stay yours.</p>
          ) : null}
        </div>
        {owner ? (
          <Button icon={<Icon name="plus" size={18} />} onClick={() => setGiving(true)}>
            Give a role
          </Button>
        ) : null}
      </div>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        {owner ? <YourTeam /> : null}
        <SharedWithYou span={owner ? 5 : 7} />
      </div>
      {giving ? <GiveRoleDialog onClose={() => setGiving(false)} /> : null}
    </div>
  )
}
