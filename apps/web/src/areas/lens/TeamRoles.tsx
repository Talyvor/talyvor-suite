import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Crumb, Dialog, Field, Icon, Input, Row, Select, showSnack } from '@talyvor/ui/pocket'
import { useAccount } from './agentBankApi'
import { ACCOUNTS_KEY, readAccounts, switchAccount } from './accountsApi'
import { accountName } from './YourAccounts'
import { readFailure } from './WalletMoney'
import {
  GIVEN_ROLES_KEY,
  MY_ROLES_KEY,
  ROLES,
  ROLE_LINE,
  ROLE_NAME,
  refusal,
  roleName,
  rolesApi,
  teamTitle,
  type GivenRole,
  type Role,
  type RoleAccount,
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
      {removing ? <RemoveRoleDialog given={removing} onClose={() => setRemoving(null)} /> : null}
    </section>
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
