import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Facts, Field, Input, Select } from '@talyvor/ui/pocket'
import { formatWhen } from './format'
import { assertOver } from './passkeys'
import { Note, PanelForm, readFailure } from './WalletMoney'
import {
  AgentBankError,
  type Agent,
  type Permission,
  type SpendPermission,
  type TokenLimit,
  USDC_ON_BASE,
  refusalText,
  spendPermissionApi,
  usdcMinorOf,
} from './agentBankApi'

// AgentWalletLimits.tsx — B48.48: an agent's Limits and permissions, under its USDC wallet (AgentMoneyWallet.tsx). What
// its key may pay — an allowance per day, week or month, the most in one payment, the addresses it may only pay or may
// never pay, and when that ends — as Lens B48.3 holds it; a change is prepared by Lens as its canonical JSON and kept
// only once the passkey that owns the agent's account signed exactly that. Freeze is signing one with no tokens: from
// then on every payment from the wallet is refused until the owner signs new limits.

export const spendPermissionKey = (id: string) => ['agent-spend-permission', id]

const PERIOD_WORDS: Record<TokenLimit['period'], string> = { day: 'a day', week: 'a week', month: 'a month' }

const usdc = (minor: number) => `${(minor / 1e6).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`
const typed = (minor: number | undefined) => (minor ? String(minor / 1e6) : '')
const addresses = (text: string) => text.split(/[\s,]+/).filter(Boolean)
const listText = (xs: string[] | null | undefined) => (xs ?? []).join(', ')

/** "30 Jun 2027": the day a permission ends, in UTC, as it was signed. */
const endText = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** The permission's end as the date field shows it, in UTC. */
const dayOf = (iso: string | undefined) => (iso ? iso.slice(0, 10) : '')

/**
 * What the owner's passkey signs, then kept: Lens prepares p, the passkey that owns the agent's account signs its
 * challenge, and Lens keeps it. The phone's key cannot sign in a browser.
 */
async function signPermission(agent: Agent, p: Permission): Promise<SpendPermission> {
  const { owners } = await spendPermissionApi.owners(agent.id)
  const person = (owners ?? []).find((o) => o.role === 'person')
  if (!person?.credential_id) {
    throw new Error(
      person?.device_id
        ? `The phone that owns ${agent.name}’s wallet signs its limits. Change them in the Talyvor app on that phone.`
        : `${agent.name}’s wallet has no passkey to sign its limits.`,
    )
  }
  const { canonical, challenge } = await spendPermissionApi.prepare(agent.id, p)
  const assertion = await assertOver({ challenge, allow_credentials: [person.credential_id] })
  return spendPermissionApi.set(agent.id, canonical, assertion)
}

function failure(err: unknown): string {
  if (err instanceof AgentBankError) return refusalText(err)
  return err instanceof Error && err.message ? err.message : 'Nothing changed. You can try again.'
}

/** The permission in force, as facts. */
function InForce({ sp }: { sp: SpendPermission }) {
  const p = sp.permission
  const tokens = p.tokens ?? []
  return (
    <Facts
      facts={[
        ...tokens.flatMap((l) => {
          const name = l.token === USDC_ON_BASE ? 'USDC on Base' : l.token
          const amount = (m: number) => (l.token === USDC_ON_BASE ? usdc(m) : `${m} units`)
          return [
            { label: `Allowance, ${name}`, value: `${amount(l.allowance)} ${PERIOD_WORDS[l.period]}` },
            { label: 'Most in one payment', value: amount(l.per_payment) },
          ]
        }),
        { label: 'Pays only', value: (p.allowed ?? []).length > 0 ? listText(p.allowed) : 'Any address it is not blocked from' },
        ...((p.blocked ?? []).length > 0 ? [{ label: 'Never pays', value: <span className="break-all">{listText(p.blocked)}</span> }] : []),
        { label: 'Ends', value: endText(p.expires) },
        { label: 'Signed', value: formatWhen(sp.signed_at) },
      ]}
    />
  )
}

/** The agent's limits, and the form that signs new ones or freezes it. */
export function WalletLimits({ agent }: { agent: Agent }) {
  const qc = useQueryClient()
  const read = useQuery({
    queryKey: spendPermissionKey(agent.id),
    queryFn: () =>
      spendPermissionApi.read(agent.id).catch((err: unknown) => {
        if (err instanceof AgentBankError && err.status === 404) return null // none signed yet
        throw err
      }),
  })
  if (read.isPending) return <p>Reading {agent.name}’s limits…</p>
  if (read.isError) return <p>{readFailure(read.error, `${agent.name}’s limits`)}</p>
  const sp = read.data
  return (
    <div className="grid gap-3" data-testid="agent-wallet-limits">
      {sp === null ? (
        <p className="text-body text-ink">No limits are signed for {agent.name} yet.</p>
      ) : sp.frozen_at ? (
        <Note ok={false}>{agent.name} is frozen: its wallet pays nothing.</Note>
      ) : (sp.permission.tokens ?? []).length === 0 ? (
        <Note ok={false}>{agent.name}’s wallet is frozen. Every payment from it is refused until you sign new limits.</Note>
      ) : (
        <InForce sp={sp} />
      )}
      {sp?.frozen_at ? null : <LimitsForm key={sp?.number ?? 0} agent={agent} sp={sp} onSigned={(next) => qc.setQueryData(spendPermissionKey(agent.id), next)} />}
    </div>
  )
}

function LimitsForm({ agent, sp, onSigned }: { agent: Agent; sp: SpendPermission | null; onSigned: (sp: SpendPermission) => void }) {
  const p = sp?.permission
  const current = (p?.tokens ?? []).find((l) => l.token === USDC_ON_BASE)
  const others = (p?.tokens ?? []).filter((l) => l.token !== USDC_ON_BASE) // carried over as they are
  const [allowance, setAllowance] = useState(typed(current?.allowance))
  const [period, setPeriod] = useState<TokenLimit['period']>(current?.period ?? 'week')
  const [perPayment, setPerPayment] = useState(typed(current?.per_payment))
  const [allowed, setAllowed] = useState(listText(p?.allowed))
  const [blocked, setBlocked] = useState(listText(p?.blocked))
  const [ends, setEnds] = useState(dayOf(p?.expires))
  const [signed, setSigned] = useState(false)

  const allowanceMinor = usdcMinorOf(allowance)
  const perPaymentMinor = usdcMinorOf(perPayment)
  // The end the owner did not change is signed exactly as it is; a new day ends at its last second, in UTC.
  const expires = ends === '' ? '' : ends === dayOf(p?.expires) && p ? p.expires : `${ends}T23:59:59Z`
  const counterparties = { allowed: addresses(allowed), blocked: addresses(blocked) }

  const save = useMutation({
    mutationFn: (tokens: TokenLimit[]) => signPermission(agent, { tokens, ...counterparties, expires }),
    onSuccess: (next, tokens) => {
      setSigned(tokens.length > 0)
      onSigned(next)
    },
  })
  const limits = (): TokenLimit[] =>
    allowanceMinor !== null && perPaymentMinor !== null ? [{ token: USDC_ON_BASE, allowance: allowanceMinor, period, per_payment: perPaymentMinor }, ...others] : others
  const ready = allowanceMinor !== null && perPaymentMinor !== null && expires !== ''

  return (
    <PanelForm onSubmit={() => (ready && !save.isPending ? save.mutate(limits()) : undefined)}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Allowance in USDC">
          <Input inputMode="decimal" placeholder="0.00" value={allowance} onChange={(e) => setAllowance(e.target.value)} />
        </Field>
        <Field label="Each">
          <Select value={period} onChange={(e) => setPeriod(e.target.value as TokenLimit['period'])}>
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </Select>
        </Field>
      </div>
      <Field label="Most in one payment, in USDC">
        <Input inputMode="decimal" placeholder="0.00" value={perPayment} onChange={(e) => setPerPayment(e.target.value)} />
      </Field>
      <Field label="Pay only these addresses">
        <Input placeholder="Any address, if you leave this empty" value={allowed} onChange={(e) => setAllowed(e.target.value)} />
      </Field>
      <Field label="Never pay these addresses">
        <Input placeholder="0x…, 0x…" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
      </Field>
      <Field label="Ends">
        <Input type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />
      </Field>
      <p className="text-body text-ink-3">Your passkey asks before anything changes.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending} disabledReason={ready ? undefined : 'Type an allowance, the most in one payment and when it ends first'}>
          {save.isPending ? 'Signing…' : 'Sign new limits'}
        </Button>
        {(p?.tokens ?? []).length > 0 ? (
          <Button
            variant="secondary"
            disabled={save.isPending}
            disabledReason={expires === '' ? 'Choose when it ends first' : undefined}
            onClick={() => (expires !== '' ? save.mutate([]) : undefined)}
          >
            Freeze {agent.name}
          </Button>
        ) : null}
      </div>
      {save.isError ? <Note ok={false}>{failure(save.error)}</Note> : null}
      {signed && save.isSuccess ? <Note ok>Signed. {agent.name}’s new limits hold from now.</Note> : null}
    </PanelForm>
  )
}
