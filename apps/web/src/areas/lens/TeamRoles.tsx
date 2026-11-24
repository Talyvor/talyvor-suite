import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, Chip, Crumb, Field, Input, Row, Select, showSnack } from '@talyvor/ui/pocket'
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

export const TEAM_PATH = '/settings/team'

const ENTER_EMAIL = 'Enter an email address.'

const initial = (s: string) => (s.charAt(0) || '?').toUpperCase()

function Avatar({ of }: { of: string }) {
  return (
    <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-tile bg-primary font-bold text-on-primary">
      {initial(of)}
    </span>
  )
}

/** The owner's half: give a role, and the roles given. */
function GiveRoles() {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('viewer')
  const [empty, setEmpty] = useState(false)
  const given = useQuery({ queryKey: GIVEN_ROLES_KEY, queryFn: rolesApi.given, retry: false })
  const give = useMutation({
    mutationFn: () => rolesApi.give(email.trim(), role),
    onSuccess: async (r) => {
      setEmail('')
      showSnack({ title: 'Role given', line: `${r.email} is now ${roleName(r.role)}.` })
      await qc.invalidateQueries({ queryKey: GIVEN_ROLES_KEY })
    },
  })
  const remove = useMutation({
    mutationFn: (r: GivenRole) => rolesApi.remove(r.email),
    onSuccess: async (_, r) => {
      showSnack({ title: 'Role removed', line: `${r.email} no longer has a role.` })
      await qc.invalidateQueries({ queryKey: GIVEN_ROLES_KEY })
    },
  })
  return (
    <>
      <Card>
        <h3 className="font-display text-reading font-bold text-ink">Give a role</h3>
        <p className="mt-1 text-body text-ink-2">They open your company’s account by proving this email with a code we send to it.</p>
        <form
          className="mt-3 grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            setEmpty(!email.trim())
            if (email.trim() && !give.isPending) give.mutate()
          }}
        >
          <Field label="Email">
            <Input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAME[r]}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-body text-ink-2">{ROLE_LINE[role]}</p>
          {empty ? (
            <p role="alert" className="text-body text-danger">
              {ENTER_EMAIL}
            </p>
          ) : null}
          {give.isError ? (
            <p role="alert" className="text-body text-danger">
              {refusal(give.error, 'That role wasn’t given. Try again.')}
            </p>
          ) : null}
          <div>
            <Button type="submit" disabled={give.isPending}>
              {give.isPending ? 'Giving…' : 'Give role'}
            </Button>
          </div>
        </form>
      </Card>
      <Card>
        <h3 className="font-display text-reading font-bold text-ink">Your team</h3>
        {given.isPending ? (
          <p className="mt-2 text-body text-ink-2">Reading…</p>
        ) : given.isError ? (
          <p className="mt-2 text-body text-ink-2">{readFailure(given.error, 'Your team')}</p>
        ) : given.data.length === 0 ? (
          <p className="mt-2 text-body text-ink-2">You haven’t given anyone a role yet.</p>
        ) : (
          <ul className="mt-2 grid gap-1" aria-label="Your team">
            {given.data.map((r) => (
              <li key={r.email}>
                <Row
                  leading={<Avatar of={r.email} />}
                  title={<span className="break-all">{r.email}</span>}
                  wrap
                  line={`${roleName(r.role)} · ${r.signed_in ? 'Has signed in' : 'Hasn’t signed in yet'}`}
                  action={
                    <Button size="sm" variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate(r)}>
                      Remove
                    </Button>
                  }
                />
              </li>
            ))}
          </ul>
        )}
        {remove.isError ? (
          <p role="alert" className="mt-2 text-body text-danger">
            {refusal(remove.error, 'That role wasn’t removed. Try again.')}
          </p>
        ) : null}
      </Card>
    </>
  )
}

/** Everyone's half: prove an email with a code, and open the accounts a role was given in. */
function SharedWithYou() {
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
    <Card>
      <h3 className="font-display text-reading font-bold text-ink">Accounts shared with you</h3>
      <p className="mt-1 text-body text-ink-2">Someone gave a role to your email? Prove it’s yours with a code we send to it, and their account opens from Your accounts.</p>
      {mine.isPending ? (
        <p className="mt-2 text-body text-ink-2">Reading…</p>
      ) : mine.isError ? (
        <p className="mt-2 text-body text-ink-2">{readFailure(mine.error, 'Accounts shared with you')}</p>
      ) : (
        <>
          {mine.data.emails.length > 0 ? <p className="mt-2 text-body text-ink-2">Proved: {mine.data.emails.join(', ')}</p> : null}
          {mine.data.accounts.length > 0 ? (
            <ul className="mt-2 grid gap-1" aria-label="Accounts shared with you">
              {mine.data.accounts.map((a) => (
                <li key={a.id}>
                  <Row
                    leading={<Avatar of={accountName(a)} />}
                    title={accountName(a)}
                    line={<span className="break-all">{`${roleName(a.role)} · ${a.email}`}</span>}
                    wrap
                    action={
                      a.current ? (
                        <Chip>Current</Chip>
                      ) : (
                        <Button size="sm" disabled={open.isPending} onClick={() => open.mutate(a)}>
                          Open
                        </Button>
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          ) : mine.data.emails.length > 0 ? (
            <p className="mt-2 text-body text-ink-2">No account has given a role to these emails yet.</p>
          ) : null}
        </>
      )}
      {open.isError ? (
        <p role="alert" className="mt-2 text-body text-danger">
          That account didn’t open. Try again.
        </p>
      ) : null}
      {sentTo === null ? (
        <form
          className="mt-3 grid gap-3"
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
          className="mt-3 grid gap-3"
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
  return (
    <div className="grid gap-5 px-gutter py-4 wide:py-6">
      <Crumb trail={[{ label: 'Settings', href: '/settings' }, { label: page }]} />
      <div className="grid max-w-2xl gap-1">
        <h2 className="font-display text-title font-bold text-ink">{business ? 'Who in your team can see, pay and approve' : 'Open an account someone gave you a role in'}</h2>
        <div className="grid gap-2 text-reading text-ink-2">
          {here?.role ? (
            <p>
              You are {roleName(here.role)} in {accountName(here)}. {ROLE_LINE[here.role as Role] ?? ''}
            </p>
          ) : business ? (
            <p>Give each person the role they need. Keys, passkeys and roles stay yours.</p>
          ) : null}
        </div>
      </div>
      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="grid gap-4 wide:col-span-7">{owner ? <GiveRoles /> : <SharedWithYou />}</div>
        {owner ? <div className="grid gap-4 wide:col-span-5"><SharedWithYou /></div> : null}
      </div>
    </div>
  )
}
