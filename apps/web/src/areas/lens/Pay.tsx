import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, CardHeader, Input, Pill, focusRing, type PillStatus } from '@talyvor/ui'
import { Card } from './walletBrand'
import { Region, RegionScreen } from '../../components/Region'
import { formatWhen } from './format'
import { Note, readFailure } from './WalletMoney'
import { APPROVALS_KEY, BOOK_KEY, PASSKEYS_KEY } from './AgentBank'
import { MONEY_ACCOUNTS_KEY } from './Invoices'
import { assertOver, signApproval, signPayee } from './passkeys'
import {
  type AgentApproval,
  type AssistantRequest,
  type Bill,
  type AgentSchedule,
  type CurrencyAccount,
  type Mandate,
  type MandateTerms,
  type OutsidePayee,
  type OutsidePayment,
  type PayeeRequest,
  type PayoutBatch,
  agentBankApi,
  formatMinor,
  formatULXC,
  minorOf,
  newMoveKey,
  refusalText,
} from './agentBankApi'

// Pay.tsx — B30.96: money out of an account. Saved payees outside Talyvor, each checked against its account by the account
// partner (Lens B30.16); a payment to one, from the company's or an agent's account (B30.17), with an agent's requests that
// wait for a person's approval shown here; standing orders (B30.18); mandates a payee pulls within (B30.19); and bulk
// payouts from a CSV, validated row by row and paid on one approval (B30.21). Lens decides everything — which account may
// pay, the agent's rules, screening, what posts — and a refusal shows its sentence. Every amount is Lens's minor units.

export const PAYEES_KEY = ['money-payees']
export const PAYMENTS_KEY = ['money-payments']
export const MANDATES_KEY = ['money-mandates']
export const PAYOUTS_KEY = ['money-payouts']
export const SCHEDULES_KEY = ['agent-schedules']
export const ASSISTANT_REQUESTS_KEY = ['money-assistant-requests']
export const BILLS_KEY = ['money-bills']
const EVERY: AgentSchedule['every'][] = ['hour', 'day', 'week', 'month']

const PAYMENT_STATUS: Record<string, { text: string; pill: PillStatus }> = {
  pending: { text: 'Pending', pill: 'held' },
  sent: { text: 'Sent', pill: 'held' },
  completed: { text: 'Completed', pill: 'settled' },
  failed: { text: 'Failed', pill: 'slashed' },
  returned: { text: 'Returned', pill: 'slashed' },
}
const CHECK: Record<string, { text: string; pill: PillStatus }> = {
  exact_match: { text: 'Exact match', pill: 'settled' },
  close_match: { text: 'Close match', pill: 'held' },
  no_match: { text: 'No match', pill: 'slashed' },
}

const select = `h-8 rounded-control border border-rule bg-surface px-2 text-body text-ink transition-colors duration-200 hover:border-rule-strong ${focusRing}`
const field = 'flex flex-col gap-1 text-caption text-muted'

/** A date typed in the form, at nine in the morning UTC, as Lens wants a time. */
const morningOf = (date: string) => `${date}T09:00:00Z`
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
const status = (s: string, of: Record<string, { text: string; pill: PillStatus }>) => of[s] ?? { text: s, pill: 'idle' as PillStatus }

/** The payee's account details, as it gave them. */
function detailsOf(p: PayeeRequest): string {
  if (p.iban) return `${p.iban}${p.bic ? ` · ${p.bic}` : ''}`
  if (p.routing_number) return `${p.routing_number} · ${p.account_number ?? ''}`
  return `${p.sort_code ?? ''} · ${p.account_number ?? ''}`
}

export function PayScreen() {
  const accounts = useQuery({ queryKey: MONEY_ACCOUNTS_KEY, queryFn: agentBankApi.moneyAccounts })
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees })
  const payments = useQuery({ queryKey: PAYMENTS_KEY, queryFn: agentBankApi.payments })
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book })
  const asked = useQuery({ queryKey: ASSISTANT_REQUESTS_KEY, queryFn: agentBankApi.assistantRequests })
  const askedPayees = (asked.data?.requests ?? []).filter((r) => r.kind === 'payee')
  const askedMandates = (asked.data?.requests ?? []).filter((r) => r.kind === 'mandate')
  const open = (accounts.data?.accounts ?? []).filter((a) => a.status === 'open')
  const agentAccounts = open.filter((a) => a.purpose === 'agent')
  const saved = payees.data?.payees ?? []
  const sent = payments.data?.payments ?? []
  const agentName = (id: string | undefined) => book.data?.agents?.find((x) => x.id === id)?.name ?? id ?? ''
  const accountName = (a: CurrencyAccount) => `${a.purpose === 'agent' ? agentName(a.agent_id) : 'The company'} · ${a.currency}`
  const payeeName = (id: string | undefined) => saved.find((p) => p.id === id)?.name ?? id ?? ''
  const reading = (q: { isError: boolean; isPending: boolean; error: unknown }, what: string) =>
    q.isError ? <p className="text-body text-muted">{readFailure(q.error, what)}</p> : q.isPending ? <p className="text-body text-muted">Reading…</p> : null

  return (
    <RegionScreen>
      <Region index="00" label="Pay" heading="Send money from an account" sectionClassName="pb-10 pt-4 wide:pb-12" className="flex max-w-2xl flex-col gap-3">
        <p className="text-body text-muted">
          Save the people and companies you pay, then send money from the company’s or an agent’s account in pounds, euros or dollars:
          one payment, a standing order, a mandate the payee pulls within, or a file of payouts approved once. An agent’s own request
          above its approval amount waits here for you.
        </p>
        {askedPayees.length + askedMandates.length > 0 ? (
          <p className="text-body text-ink" data-testid="pay-asked">
            Your assistant is waiting for you: <span className="font-figure">{askedPayees.length}</span> {askedPayees.length === 1 ? 'payee' : 'payees'} to save and{' '}
            <span className="font-figure">{askedMandates.length}</span> {askedMandates.length === 1 ? 'mandate' : 'mandates'} to sign, below.
          </p>
        ) : null}
        {payments.isSuccess ? (
          <p className="text-body text-ink" data-testid="pay-count">
            <span className="font-figure">{sent.length}</span> {sent.length === 1 ? 'payment' : 'payments'} out,{' '}
            <span className="font-figure">{sent.filter((p) => p.status === 'completed').length}</span> completed
          </p>
        ) : null}
      </Region>
      <Region index="01" label="Payees" heading="People and companies you pay" className="flex max-w-2xl flex-col gap-3">
        {askedPayees.length > 0 ? <AssistantPayees requests={askedPayees} /> : null}
        {reading(payees, 'Your payees') ?? <Payees payees={saved} />}
      </Region>

      <Region index="02" label="Send" heading="Pay a saved payee" className="flex max-w-2xl flex-col gap-3">
        {reading(accounts, 'Your accounts') ??
          (open.length === 0 ? (
            <p className="text-body text-muted" data-testid="pay-no-account">No currency account yet: open the company’s account on Invoices, then pay from it here.</p>
          ) : (
            <SendPayment accounts={open} payees={saved} sent={sent} accountName={accountName} />
          ))}
        <Waiting agentName={agentName} />
        {reading(payments, 'Your payments') ??
          (sent.length > 0 ? (
            <Card>
              <CardHeader>Payments out</CardHeader>
              <ul>
                {sent.map((p) => (
                  <PaymentRow key={p.id} p={p} />
                ))}
              </ul>
            </Card>
          ) : null)}
      </Region>
      <Region index="03" label="Standing orders" heading="Pay the same amount on a schedule" className="flex max-w-2xl flex-col gap-3">
        {reading(accounts, 'Your accounts') ??
          (agentAccounts.length === 0 ? (
            <p className="text-body text-muted">A standing order runs from an agent’s account: open one on Invoices first.</p>
          ) : (
            <StandingOrders accounts={agentAccounts} payees={saved} accountName={accountName} payeeName={payeeName} agentName={agentName} />
          ))}
      </Region>
      <Region index="04" label="Mandates" heading="Let a payee pull within limits you set" className="flex max-w-2xl flex-col gap-3">
        {reading(accounts, 'Your accounts') ??
          (agentAccounts.length === 0 ? (
            <p className="text-body text-muted">A mandate is on an agent’s account: open one on Invoices first.</p>
          ) : (
            <Mandates accounts={agentAccounts} payees={saved} accountName={accountName} agentName={agentName} />
          ))}
      </Region>
      <Region index="05" label="Bulk payouts" heading="Pay many at once from a file" className="flex max-w-2xl flex-col gap-3">
        <Payouts />
      </Region>
      <Region index="06" label="Bills" heading="Bills you received" className="flex max-w-2xl flex-col gap-3">
        <Bills payeeName={payeeName} />
      </Region>
      {askedMandates.length > 0 ? (
        <Region index="07" label="Assistant permissions" heading="Sign what an assistant may pay for you" className="flex max-w-2xl flex-col gap-3">
          <AssistantMandates requests={askedMandates} payeeName={payeeName} />
        </Region>
      ) : null}
    </RegionScreen>
  )
}

/** Saved payees outside Talyvor, each with what its bank said of the name; a close or no match confirmed with a passkey (B30.16). */
function Payees({ payees }: { payees: OutsidePayee[] }) {
  const qc = useQueryClient()
  const [kind, setKind] = useState<'uk' | 'iban' | 'us'>('uk')
  const [form, setForm] = useState({ name: '', country: 'GB', sort_code: '', account_number: '', iban: '', bic: '', routing_number: '' })
  const [made, setMade] = useState<OutsidePayee | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: PAYEES_KEY })
  const create = useMutation({
    mutationFn: () => {
      const body: PayeeRequest = { name: form.name.trim(), country: form.country.trim().toUpperCase() }
      if (kind === 'iban') Object.assign(body, { iban: form.iban.replace(/\s/g, '').toUpperCase(), bic: form.bic.trim().toUpperCase() })
      else if (kind === 'us') Object.assign(body, { routing_number: form.routing_number.trim(), account_number: form.account_number.trim() })
      else Object.assign(body, { sort_code: form.sort_code.replace(/\D/g, ''), account_number: form.account_number.trim() })
      return agentBankApi.createPayee(body)
    },
    onSuccess: (p) => {
      setMade(p)
      setForm({ name: '', country: 'GB', sort_code: '', account_number: '', iban: '', bic: '', routing_number: '' })
      refresh()
    },
  })
  const confirm = useMutation({ mutationFn: async (id: string) => agentBankApi.confirmPayee(id, await signPayee(id)), onSuccess: refresh })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const complete = form.name.trim() !== '' && form.country.trim().length === 2 &&
    (kind === 'iban' ? form.iban.trim() !== '' : kind === 'us' ? form.routing_number.trim() !== '' && form.account_number.trim() !== '' : form.sort_code.trim() !== '' && form.account_number.trim() !== '')
  return (
    <Card>
      <CardHeader>Payees</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {payees.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Saved payees">
            {payees.map((p) => {
              const c = status(p.check, CHECK)
              return (
                <li key={p.id} className="flex flex-col gap-1 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`payee-${p.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
                    <span>
                      {p.name} · {p.country}
                    </span>
                    <span className="flex items-center gap-2">
                      <Pill status={c.pill}>{c.text}</Pill>
                      {p.needs_confirmation ? <Pill status="held">Needs confirmation</Pill> : null}
                    </span>
                  </div>
                  <p className="text-caption text-muted">
                    <span className="font-figure">{detailsOf(p)}</span>
                    {p.suggested_name ? ` · the account is held by ${p.suggested_name}` : ''}
                    {p.screening ? ` · ${p.screening}` : ''}
                  </p>
                  {p.needs_confirmation ? (
                    <div>
                      <Button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate(p.id)}>
                        {confirm.isPending && confirm.variables === p.id ? 'Confirming…' : 'Confirm with a passkey'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-body text-muted">No payee saved yet. Save one below: its name is checked against the account before it can be paid.</p>
        )}
        {confirm.isError ? <Note ok={false}>{refusalText(confirm.error)}</Note> : null}
        <form
          className="flex flex-col gap-3"
          data-testid="new-payee"
          onSubmit={(e) => {
            e.preventDefault()
            if (complete && !create.isPending) create.mutate()
          }}
        >
          <div className="grid gap-3 wide:grid-cols-3">
            <Input aria-label="Payee’s name" placeholder="Name on the account" className="wide:col-span-2" value={form.name} onChange={(e) => set({ name: e.target.value })} />
            <Input aria-label="Country" placeholder="Country (GB)" className="font-figure" value={form.country} onChange={(e) => set({ country: e.target.value })} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Account details" className={select} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="uk">Sort code and account number</option>
              <option value="iban">IBAN</option>
              <option value="us">Routing and account number</option>
            </select>
            {kind === 'iban' ? (
              <>
                <Input aria-label="IBAN" placeholder="IBAN" className="min-w-56 flex-1 font-figure" value={form.iban} onChange={(e) => set({ iban: e.target.value })} />
                <Input aria-label="BIC" placeholder="BIC (optional)" className="w-36 font-figure" value={form.bic} onChange={(e) => set({ bic: e.target.value })} />
              </>
            ) : (
              <>
                {kind === 'us' ? (
                  <Input aria-label="Routing number" placeholder="Routing number" className="w-36 font-figure" value={form.routing_number} onChange={(e) => set({ routing_number: e.target.value })} />
                ) : (
                  <Input aria-label="Sort code" placeholder="Sort code" className="w-28 font-figure" value={form.sort_code} onChange={(e) => set({ sort_code: e.target.value })} />
                )}
                <Input aria-label="Account number" placeholder="Account number" className="w-40 font-figure" value={form.account_number} onChange={(e) => set({ account_number: e.target.value })} />
              </>
            )}
          </div>
          <div>
            <Button type="submit" disabled={!complete || create.isPending}>
              {create.isPending ? 'Checking…' : 'Save payee'}
            </Button>
          </div>
          {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
          {made !== null ? (
            <Note ok>
              {made.name} saved: {status(made.check, CHECK).text.toLowerCase()}
              {made.suggested_name ? ` — the account is held by ${made.suggested_name}` : ''}
              {made.needs_confirmation ? '. Confirm it with a passkey before the first payment.' : '.'}
            </Note>
          ) : null}
        </form>
      </div>
    </Card>
  )
}

/** B40.35 — payees an assistant asked to add: none is a payee until the person presses Save, through the same route as the form. */
function AssistantPayees({ requests }: { requests: AssistantRequest[] }) {
  const qc = useQueryClient()
  const [made, setMade] = useState<OutsidePayee | null>(null)
  const done = () => {
    void qc.invalidateQueries({ queryKey: ASSISTANT_REQUESTS_KEY })
    void qc.invalidateQueries({ queryKey: PAYEES_KEY })
  }
  const save = useMutation({
    mutationFn: async (r: AssistantRequest & { kind: 'payee' }) => {
      const p = await agentBankApi.createPayee(r.details)
      await agentBankApi.dismissAssistantRequest(r.id)
      return p
    },
    onSuccess: (p) => {
      setMade(p)
      done()
    },
  })
  const dismiss = useMutation({ mutationFn: agentBankApi.dismissAssistantRequest, onSuccess: done })
  return (
    <Card>
      <CardHeader>Payees your assistant asked to add</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <p className="text-caption text-muted">Check each against what the payee told you. Nothing is saved, or can be paid, until you press Save.</p>
        <ul className="flex flex-col gap-2" aria-label="Payees your assistant asked to add">
          {requests.map((r) =>
            r.kind === 'payee' ? (
              <li key={r.id} className="flex flex-col gap-2 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`asked-payee-${r.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
                  <span>
                    {r.details.name} · {r.details.country}
                  </span>
                  <Pill status="held">Asked by {r.assistant}</Pill>
                </div>
                <p className="text-caption text-muted">
                  <span className="font-figure">{detailsOf(r.details)}</span>
                  {' · '}
                  <span className="font-figure">{formatWhen(r.created_at)}</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="primary" disabled={save.isPending} onClick={() => save.mutate(r)}>
                    {save.isPending && save.variables?.id === r.id ? 'Checking…' : 'Save payee'}
                  </Button>
                  <Button type="button" disabled={dismiss.isPending} onClick={() => dismiss.mutate(r.id)}>
                    Dismiss
                  </Button>
                </div>
              </li>
            ) : null,
          )}
        </ul>
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
        {dismiss.isError ? <Note ok={false}>{refusalText(dismiss.error)}</Note> : null}
        {made !== null ? (
          <Note ok>
            {made.name} saved: {status(made.check, CHECK).text.toLowerCase()}
            {made.needs_confirmation ? '. Confirm it with a passkey before the first payment.' : '.'}
          </Note>
        ) : null}
      </div>
    </Card>
  )
}

const NEW_PAYEE: Record<string, (hours: number) => string> = {
  always_ask: () => 'The first payment to any payee always waits for your approval.',
  confirmation_of_payee: () => 'A payee is paid without asking only once its name matches its account.',
  cooling_off: (h) => `A newly added payee is paid without asking only ${h} hours after it was added.`,
}

/** A drafted mandate in plain words: exactly the terms the passkey signs. */
export function mandateInWords(assistant: string, t: MandateTerms, payeeName: (id: string) => string): string[] {
  const money = (m: Record<string, number> | null | undefined) =>
    Object.entries(m ?? {})
      .map(([cur, minor]) => formatMinor(minor, cur))
      .join(' or ')
  const to = [
    ...(t.scope.payees ?? []).map(payeeName),
    ...(t.scope.payee_categories ?? []).map((c) => `any payee in ${c}`),
    ...(t.scope.sellers ?? []).map((id) => `marketplace seller ${id}`),
    ...(t.scope.rooms ?? []).map((id) => `room ${id}`),
  ]
  const lim = t.limits ?? {}
  const limits = [
    [lim.per_payment, 'a payment'],
    [lim.per_day, 'a day'],
    [lim.per_month, 'a month'],
    [lim.batch_total, 'a batch'],
  ]
    .filter(([m]) => Object.keys(m ?? {}).length > 0)
    .map(([m, per]) => `${money(m as Record<string, number>)} ${per as string}`)
  if ((lim.payments_per_hour ?? 0) > 0) limits.push(`${lim.payments_per_hour} payments an hour`)
  return [
    `Payments ${assistant} prepares for ${to.join(', ')}, in ${(t.scope.currencies ?? []).join(', ')}, are paid without asking you again.`,
    limits.length > 0 ? `At most ${limits.join(', ')}.` : 'No limit on amounts.',
    ...(Object.keys(t.requires_approval_above ?? {}).length > 0 ? [`A payment above ${money(t.requires_approval_above)} waits for your approval.`] : []),
    (NEW_PAYEE[t.new_payee.policy] ?? (() => `New payees: ${t.new_payee.policy}.`))(t.new_payee.cooling_off_hours ?? 0),
    `Until ${formatWhen(t.expires_at)}. You can revoke it at any time.`,
  ]
}

/** B40.35 — permission mandates an assistant drafted: none has any effect until the person's passkey signs it (Lens B40.2). */
function AssistantMandates({ requests, payeeName }: { requests: AssistantRequest[]; payeeName: (id: string) => string }) {
  const qc = useQueryClient()
  const [signed, setSigned] = useState(false)
  const done = () => void qc.invalidateQueries({ queryKey: ASSISTANT_REQUESTS_KEY })
  const sign = useMutation({
    mutationFn: async (id: string) => {
      const prepared = await agentBankApi.prepareAssistantMandate(id)
      return agentBankApi.signAssistantMandate(id, prepared.canonical, await assertOver(prepared))
    },
    onSuccess: () => {
      setSigned(true)
      done()
    },
  })
  const dismiss = useMutation({ mutationFn: agentBankApi.dismissAssistantRequest, onSuccess: done })
  return (
    <>
      {requests.map((r) =>
        r.kind === 'mandate' ? (
          <Card key={r.id}>
            <CardHeader>{r.assistant} asks for a permission mandate</CardHeader>
            <div className="flex flex-col gap-3 px-gutter py-3" data-testid={`asked-mandate-${r.id}`}>
              <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-ink">
                {mandateInWords(r.assistant, r.details, payeeName).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="text-caption text-muted">
                Drafted <span className="font-figure">{formatWhen(r.created_at)}</span>. It does nothing until you sign it.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="primary" disabled={sign.isPending} onClick={() => sign.mutate(r.id)}>
                  {sign.isPending && sign.variables === r.id ? 'Signing…' : 'Sign with a passkey'}
                </Button>
                <Button type="button" disabled={dismiss.isPending} onClick={() => dismiss.mutate(r.id)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </Card>
        ) : null,
      )}
      {sign.isError ? <Note ok={false}>{refusalText(sign.error)}</Note> : null}
      {dismiss.isError ? <Note ok={false}>{refusalText(dismiss.error)}</Note> : null}
      {signed ? <Note ok>Signed. The mandate is in force until it ends or you revoke it.</Note> : null}
    </>
  )
}

/** The two scam questions asked before a first payment to a payee (B41.13). */
const SCAM_QUESTIONS = [
  { key: 'urgent', text: 'Were you told to pay urgently?' },
  { key: 'by_message', text: 'Did the bank details arrive by email or chat?' },
] as const
type ScamAnswers = Partial<Record<(typeof SCAM_QUESTIONS)[number]['key'], boolean>>

/** One payment to a saved payee, from the company's or an agent's account (B30.17). */
function SendPayment({
  accounts,
  payees,
  sent,
  accountName,
}: {
  accounts: CurrencyAccount[]
  payees: OutsidePayee[]
  sent: OutsidePayment[]
  accountName: (a: CurrencyAccount) => string
}) {
  const qc = useQueryClient()
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [key, setKey] = useState(newMoveKey)
  const [made, setMade] = useState<OutsidePayment | null>(null)
  const [answers, setAnswers] = useState<ScamAnswers>({})
  const [stillPay, setStillPay] = useState(false)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const payee = payees.find((p) => p.id === payeeID)
  const minor = minorOf(amount)
  // B41.13: before the first payment to a payee, both questions are answered; a yes to either needs a second confirmation.
  const first = payee !== undefined && !sent.some((p) => p.payee_id === payee.id)
  const risky = SCAM_QUESTIONS.some((q) => answers[q.key] === true)
  const checked = !first || (SCAM_QUESTIONS.every((q) => answers[q.key] !== undefined) && (!risky || stillPay))
  const complete = account !== undefined && payee !== undefined && !payee.needs_confirmation && minor !== null && checked
  const pay = useMutation({
    mutationFn: () =>
      agentBankApi.payOutside({ account_id: account?.id ?? '', payee_id: payeeID, amount_minor: minor ?? 0, currency: account?.currency ?? '', reference: reference.trim(), idempotency_key: key }),
    onSuccess: (p) => {
      setMade(p)
      setAmount('')
      setReference('')
      setKey(newMoveKey())
      setAnswers({})
      setStillPay(false)
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY })
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    },
  })
  return (
    <Card>
      <CardHeader>Send</CardHeader>
      <form
        className="flex flex-col gap-3 px-gutter py-3"
        data-testid="send-payment"
        onSubmit={(e) => {
          e.preventDefault()
          if (complete && !pay.isPending) pay.mutate()
        }}
      >
        <div className="grid gap-3 wide:grid-cols-2">
          <label className={field}>
            From
            <select aria-label="From" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {accountName(a)}
                </option>
              ))}
            </select>
            <span>
              Holds <span className="font-figure">{formatMinor(account?.test_minor ?? 0, account?.currency ?? 'GBP')}</span>
            </span>
          </label>
          <label className={field}>
            To
            <select
              aria-label="To"
              className={`${select} w-full`}
              value={payeeID}
              onChange={(e) => {
                setPayeeID(e.target.value)
                setAnswers({})
                setStillPay(false)
              }}
            >
              <option value="">Choose a payee</option>
              {payees.map((p) => (
                <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                  {p.name}
                  {p.needs_confirmation ? ' (confirm first)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className={field}>
            Amount in {account?.currency ?? 'GBP'}
            <Input aria-label={`Amount in ${account?.currency ?? 'GBP'}`} inputMode="decimal" placeholder="20.00" className="font-figure" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className={field}>
            Reference
            <Input aria-label="Reference" placeholder="What the payee sees" value={reference} onChange={(e) => setReference(e.target.value)} />
          </label>
        </div>
        {first ? (
          <fieldset className="flex flex-col gap-2 border-t border-rule pt-3" data-testid="scam-check">
            <legend className="text-body text-ink">First payment to {payee.name}: two quick questions</legend>
            {SCAM_QUESTIONS.map((q) => (
              <div key={q.key} role="radiogroup" aria-label={q.text} className="flex flex-wrap items-center gap-3 text-body text-ink">
                <span className="min-w-0 flex-1">{q.text}</span>
                {([true, false] as const).map((yes) => (
                  <label key={String(yes)} className="flex items-center gap-1 text-caption text-muted">
                    <input
                      type="radio"
                      name={`scam-${q.key}`}
                      className={`h-4 w-4 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                      checked={answers[q.key] === yes}
                      onChange={() => {
                        setAnswers((a) => ({ ...a, [q.key]: yes }))
                        setStillPay(false)
                      }}
                    />
                    {yes ? 'Yes' : 'No'}
                  </label>
                ))}
              </div>
            ))}
            {risky ? (
              <div role="alert" className="flex flex-col gap-2 rounded-control border border-rule-strong px-3 py-2" data-testid="scam-warning">
                <p className="flex flex-wrap items-center gap-2 text-body text-ink">
                  <Pill status="slashed">Stop and check</Pill>
                  <span>This could be a scam.</span>
                </p>
                <p className="text-caption text-ink">
                  Fraudsters rush people into paying, and they send or change bank details by email or chat. Before you pay, call {payee.name} on a
                  number you already have — not one from the message — and check the details. Money sent to a fraudster is often not recovered.
                </p>
                <label className="flex items-start gap-2 text-caption text-ink">
                  <input
                    type="checkbox"
                    className={`mt-0.5 h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
                    checked={stillPay}
                    onChange={(e) => setStillPay(e.target.checked)}
                  />
                  <span>I have checked the details with {payee.name} directly and still want to pay.</span>
                </label>
              </div>
            ) : null}
          </fieldset>
        ) : null}
        <div>
          <Button type="submit" variant="primary" disabled={!complete || pay.isPending}>
            {pay.isPending ? 'Sending…' : 'Send'}
          </Button>
        </div>
        {pay.isError ? <Note ok={false}>{refusalText(pay.error)}</Note> : null}
        {made !== null ? (
          <Note ok>
            <span className="font-figure">{formatMinor(made.amount_minor, made.currency)}</span> to {made.payee_name}: {status(made.status, PAYMENT_STATUS).text.toLowerCase()}
            {made.detail ? ` — ${made.detail}` : ''}.
          </Note>
        ) : null}
      </form>
    </Card>
  )
}

/** An agent's own payments out that its rules sent to a person: approve or deny here, signed once the workspace has a passkey. */
function Waiting({ agentName }: { agentName: (id: string) => string }) {
  const qc = useQueryClient()
  const approvals = useQuery({ queryKey: APPROVALS_KEY, queryFn: agentBankApi.approvals })
  const keys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: agentBankApi.passkeys })
  const signed = (keys.data?.passkeys ?? []).length > 0
  const waiting = (approvals.data?.approvals ?? []).filter((a) => a.status === 'pending' && a.payee?.kind === 'outside')
  const decide = useMutation({
    mutationFn: async ({ a, decision }: { a: AgentApproval; decision: 'approve' | 'deny' }) =>
      agentBankApi.decide(a.id, decision, signed ? await signApproval(a.id) : undefined),
    onSuccess: () => void qc.invalidateQueries({ queryKey: APPROVALS_KEY }),
  })
  if (approvals.isError) return <p className="text-body text-muted">{readFailure(approvals.error, 'The agents’ requests')}</p>
  if (waiting.length === 0) return null
  return (
    <Card>
      <CardHeader>Waiting for your approval</CardHeader>
      <ul>
        {waiting.map((a) => (
          <li key={a.id} className="flex flex-col gap-2 border-b border-rule px-gutter py-3 last:border-b-0" data-testid={`approval-${a.id}`}>
            <p className="text-body text-ink">
              {agentName(a.agent_id)} asked to pay {a.payee?.name} <span className="font-figure">{formatULXC(a.amount_ulxc)}</span>
              {a.memo ? ` — ${a.memo}` : ''}
            </p>
            <p className="text-caption text-muted">
              Asked <span className="font-figure">{formatWhen(a.created_at)}</span>. Approved, the agent’s next identical request goes through, once.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ a, decision: 'approve' })}>
                Approve
              </Button>
              <Button type="button" disabled={decide.isPending} onClick={() => decide.mutate({ a, decision: 'deny' })}>
                Deny
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {decide.isError ? (
        <div className="px-gutter pb-3">
          <Note ok={false}>{refusalText(decide.error)}</Note>
        </div>
      ) : null}
    </Card>
  )
}

function PaymentRow({ p }: { p: OutsidePayment }) {
  const s = status(p.status, PAYMENT_STATUS)
  return (
    <li className="flex flex-col gap-1 border-b border-rule px-gutter py-3 last:border-b-0" data-testid={`payment-${p.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-body text-ink">{p.payee_name}</span>
        <span className="flex items-center gap-2">
          <span className="text-body font-figure text-ink">{formatMinor(p.amount_minor, p.currency)}</span>
          <Pill status={s.pill}>{s.text}</Pill>
        </span>
      </div>
      <p className="text-caption text-muted">
        {p.reference ? `${p.reference} · ` : ''}
        <span className="font-figure">{formatWhen(p.created_at)}</span>
        {p.detail ? ` · ${p.detail}` : ''}
      </p>
    </li>
  )
}

/** A standing order: an agent's schedule to a saved payee, each tick a payment out judged by its rules when it runs (B30.18). */
function StandingOrders({
  accounts,
  payees,
  accountName,
  payeeName,
  agentName,
}: {
  accounts: CurrencyAccount[]
  payees: OutsidePayee[]
  accountName: (a: CurrencyAccount) => string
  payeeName: (id: string | undefined) => string
  agentName: (id: string) => string
}) {
  const qc = useQueryClient()
  const schedules = useQuery({ queryKey: SCHEDULES_KEY, queryFn: agentBankApi.schedules })
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [payeeID, setPayeeID] = useState('')
  const [amount, setAmount] = useState('')
  const [every, setEvery] = useState<AgentSchedule['every']>('week')
  const [first, setFirst] = useState(() => inDays(7))
  const [end, setEnd] = useState('')
  const [memo, setMemo] = useState('')
  const [made, setMade] = useState<AgentSchedule | null>(null)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const payee = payees.find((p) => p.id === payeeID)
  const minor = minorOf(amount)
  const complete = account !== undefined && payee !== undefined && !payee.needs_confirmation && minor !== null && first !== ''
  const refresh = () => void qc.invalidateQueries({ queryKey: SCHEDULES_KEY })
  const create = useMutation({
    mutationFn: () =>
      agentBankApi.schedule(account?.agent_id ?? '', {
        to_agent_id: '',
        to_listing_id: '',
        to_payee_id: payeeID,
        amount_ulxc: 0,
        amount_minor: minor ?? 0,
        currency: account?.currency ?? '',
        memo: memo.trim(),
        every,
        first_run_at: morningOf(first),
        ...(end !== '' ? { end_at: morningOf(end) } : {}),
      }),
    onSuccess: (s) => {
      setMade(s)
      setAmount('')
      setMemo('')
      refresh()
    },
  })
  const stop = useMutation({ mutationFn: (sid: string) => agentBankApi.stopSchedule(sid), onSuccess: refresh })
  const orders = (schedules.data?.schedules ?? []).filter((s) => s.to_payee_id)
  return (
    <Card>
      <CardHeader>Standing orders</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {schedules.isError ? (
          <p className="text-body text-muted">{readFailure(schedules.error, 'Your standing orders')}</p>
        ) : orders.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Standing orders">
            {orders.map((s) => (
              <li key={s.id} className="flex flex-col gap-1 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`standing-order-${s.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
                  <span>
                    <span className="font-figure">{formatMinor(s.amount_minor ?? 0, s.currency ?? 'GBP')}</span> every {s.every} to {payeeName(s.to_payee_id)} from{' '}
                    {agentName(s.from_agent_id)}
                  </span>
                  <Pill status={s.active ? 'settled' : 'idle'}>{s.active ? 'Active' : 'Stopped'}</Pill>
                </div>
                <p className="text-caption text-muted">
                  Next <span className="font-figure">{formatWhen(s.next_run_at)}</span>
                  {s.end_at ? (
                    <>
                      {' '}
                      · until <span className="font-figure">{formatWhen(s.end_at)}</span>
                    </>
                  ) : null}
                  {s.memo ? ` · ${s.memo}` : ''}
                </p>
                {s.active ? (
                  <div>
                    <Button type="button" disabled={stop.isPending} onClick={() => stop.mutate(s.id)}>
                      Stop
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body text-muted">{schedules.isPending ? 'Reading…' : 'No standing order yet.'}</p>
        )}
        {stop.isError ? <Note ok={false}>{refusalText(stop.error)}</Note> : null}
          <form
            className="flex flex-col gap-3"
            data-testid="new-standing-order"
            onSubmit={(e) => {
              e.preventDefault()
              if (complete && !create.isPending) create.mutate()
            }}
          >
            <div className="grid gap-3 wide:grid-cols-2">
              <label className={field}>
                From
                <select aria-label="Standing order from" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountName(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                To
                <select aria-label="Standing order to" className={`${select} w-full`} value={payeeID} onChange={(e) => setPayeeID(e.target.value)}>
                  <option value="">Choose a payee</option>
                  {payees.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                      {p.name}
                      {p.needs_confirmation ? ' (confirm first)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Amount in {account?.currency ?? 'GBP'}
                <Input aria-label="Standing order amount" inputMode="decimal" placeholder="10.00" className="font-figure" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className={field}>
                Every
                <select aria-label="Every" className={`${select} w-full`} value={every} onChange={(e) => setEvery(e.target.value as AgentSchedule['every'])}>
                  {EVERY.map((x) => (
                    <option key={x} value={x}>
                      {x}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                First payment on
                <Input aria-label="First payment on" type="date" className="font-figure" value={first} onChange={(e) => setFirst(e.target.value)} />
              </label>
              <label className={field}>
                Until (optional)
                <Input aria-label="Until" type="date" className="font-figure" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
            </div>
            <Input aria-label="Standing order memo" placeholder="Memo (optional)" value={memo} onChange={(e) => setMemo(e.target.value)} />
            <div>
              <Button type="submit" disabled={!complete || create.isPending}>
                {create.isPending ? 'Setting up…' : 'Set up standing order'}
              </Button>
            </div>
            {create.isError ? <Note ok={false}>{refusalText(create.error)}</Note> : null}
            {made !== null ? (
              <Note ok>
                <span className="font-figure">{formatMinor(made.amount_minor ?? 0, made.currency ?? 'GBP')}</span> every {made.every}, first on{' '}
                <span className="font-figure">{formatWhen(made.next_run_at)}</span>.
              </Note>
            ) : null}
          </form>
      </div>
    </Card>
  )
}

/** A mandate from an agent's account: a Talyvor company or an outside business pulls within it (B30.19). */
function Mandates({
  accounts,
  payees,
  accountName,
  agentName,
}: {
  accounts: CurrencyAccount[]
  payees: OutsidePayee[]
  accountName: (a: CurrencyAccount) => string
  agentName: (id: string) => string
}) {
  const qc = useQueryClient()
  const mandates = useQuery({ queryKey: MANDATES_KEY, queryFn: agentBankApi.mandates })
  const [accountID, setAccountID] = useState(accounts[0]?.id ?? '')
  const [kind, setKind] = useState<'company' | 'business'>('business')
  const [form, setForm] = useState({ workspace: '', business: '', payee: '', name: '', pull: '', month: '', expires: inDays(365) })
  const [made, setMade] = useState<Mandate | null>(null)
  const account = accounts.find((a) => a.id === accountID) ?? accounts[0]
  const pull = minorOf(form.pull)
  const month = minorOf(form.month)
  const complete = account !== undefined && pull !== null && month !== null && form.expires !== '' &&
    (kind === 'company' ? form.workspace.trim() !== '' : form.business.trim() !== '' && form.payee !== '')
  const refresh = () => void qc.invalidateQueries({ queryKey: MANDATES_KEY })
  const grant = useMutation({
    mutationFn: () =>
      agentBankApi.grantMandate({
        account_id: account?.id ?? '',
        payee_workspace_id: kind === 'company' ? form.workspace.trim() : '',
        payee_business_id: kind === 'business' ? form.business.trim() : '',
        payee_id: kind === 'business' ? form.payee : '',
        payee_name: form.name.trim(),
        max_per_pull_minor: pull ?? 0,
        max_per_month_minor: month ?? 0,
        expires_at: `${form.expires}T23:59:59Z`,
      }),
    onSuccess: (m) => {
      setMade(m)
      setForm({ workspace: '', business: '', payee: '', name: '', pull: '', month: '', expires: inDays(365) })
      refresh()
    },
  })
  const revoke = useMutation({ mutationFn: (id: string) => agentBankApi.revokeMandate(id), onSuccess: refresh })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  const row = (m: Mandate, granted: boolean) => (
    <li key={m.id} className="flex flex-col gap-1 border-b border-rule pb-2 last:border-b-0 last:pb-0" data-testid={`mandate-${m.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
        <span>
          {granted ? `${m.payee_name} pulls from ${agentName(m.agent_id)}` : `${m.payee_name} lets you pull`} · up to <span className="font-figure">{formatMinor(m.max_per_pull_minor, m.currency)}</span> a pull,{' '}
          <span className="font-figure">{formatMinor(m.max_per_month_minor, m.currency)}</span> a month
        </span>
        <Pill status={m.status === 'active' ? 'settled' : 'slashed'}>{m.status === 'active' ? 'Active' : 'Revoked'}</Pill>
      </div>
      <p className="text-caption text-muted">
        Pulled this month <span className="font-figure">{formatMinor(m.pulled_this_month_minor, m.currency)}</span> · expires{' '}
        <span className="font-figure">{formatWhen(m.expires_at)}</span>
      </p>
      {granted && m.status === 'active' ? (
        <div>
          <Button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(m.id)}>
            Revoke
          </Button>
        </div>
      ) : null}
    </li>
  )
  const granted = mandates.data?.granted ?? []
  const received = mandates.data?.received ?? []
  return (
    <Card>
      <CardHeader>Mandates</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        {mandates.isError ? (
          <p className="text-body text-muted">{readFailure(mandates.error, 'Your mandates')}</p>
        ) : granted.length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Mandates granted">
            {granted.map((m) => row(m, true))}
          </ul>
        ) : (
          <p className="text-body text-muted">{mandates.isPending ? 'Reading…' : 'No mandate granted yet.'}</p>
        )}
        {received.length > 0 ? (
          <>
            <p className="text-caption text-label">Received</p>
            <ul className="flex flex-col gap-2" aria-label="Mandates received">
              {received.map((m) => row(m, false))}
            </ul>
          </>
        ) : null}
        {revoke.isError ? <Note ok={false}>{refusalText(revoke.error)}</Note> : null}
          <form
            className="flex flex-col gap-3"
            data-testid="new-mandate"
            onSubmit={(e) => {
              e.preventDefault()
              if (complete && !grant.isPending) grant.mutate()
            }}
          >
            <div className="grid gap-3 wide:grid-cols-2">
              <label className={field}>
                On
                <select aria-label="Mandate on" className={`${select} w-full`} value={account?.id ?? ''} onChange={(e) => setAccountID(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountName(a)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={field}>
                Payee
                <select aria-label="Mandate payee kind" className={`${select} w-full`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                  <option value="business">An outside business, paid to a saved payee</option>
                  <option value="company">A Talyvor company, by its workspace id</option>
                </select>
              </label>
              {kind === 'company' ? (
                <Input aria-label="Payee’s workspace id" placeholder="Their workspace id" className="font-figure" value={form.workspace} onChange={(e) => set({ workspace: e.target.value })} />
              ) : (
                <>
                  <Input aria-label="Business id" placeholder="The business’s id, as it names itself" className="font-figure" value={form.business} onChange={(e) => set({ business: e.target.value })} />
                  <label className={field}>
                    Paid out to
                    <select aria-label="Paid out to" className={`${select} w-full`} value={form.payee} onChange={(e) => set({ payee: e.target.value })}>
                      <option value="">Choose a saved payee</option>
                      {payees.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.needs_confirmation}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <Input aria-label="Payee’s name" placeholder="Payee’s name (optional)" value={form.name} onChange={(e) => set({ name: e.target.value })} />
              <label className={field}>
                Most per pull, {account?.currency ?? 'GBP'}
                <Input aria-label="Most per pull" inputMode="decimal" placeholder="5.00" className="font-figure" value={form.pull} onChange={(e) => set({ pull: e.target.value })} />
              </label>
              <label className={field}>
                Most per month, {account?.currency ?? 'GBP'}
                <Input aria-label="Most per month" inputMode="decimal" placeholder="20.00" className="font-figure" value={form.month} onChange={(e) => set({ month: e.target.value })} />
              </label>
              <label className={field}>
                Expires on
                <Input aria-label="Expires on" type="date" className="font-figure" value={form.expires} onChange={(e) => set({ expires: e.target.value })} />
              </label>
            </div>
            <div>
              <Button type="submit" disabled={!complete || grant.isPending}>
                {grant.isPending ? 'Granting…' : 'Grant mandate'}
              </Button>
            </div>
            {grant.isError ? <Note ok={false}>{refusalText(grant.error)}</Note> : null}
            {made !== null ? (
              <Note ok>
                Granted to {made.payee_name}.
                {made.pull_key ? (
                  <>
                    {' '}
                    Give the business this key once; it is not shown again: <span className="font-figure" data-testid="mandate-pull-key">{made.pull_key}</span>
                  </>
                ) : null}
              </Note>
            ) : null}
          </form>
      </div>
    </Card>
  )
}

/** A file of payouts (payee_id, amount, currency, reference), validated row by row by Lens and paid on one approval (B30.21). */
function Payouts() {
  const qc = useQueryClient()
  const batches = useQuery({ queryKey: PAYOUTS_KEY, queryFn: agentBankApi.payouts })
  const [file, setFile] = useState<File | null>(null)
  const [key, setKey] = useState(newMoveKey)
  const [made, setMade] = useState<PayoutBatch | null>(null)
  const refresh = () => void qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
  const upload = useMutation({
    mutationFn: async () => agentBankApi.uploadPayouts(await (file as File).text(), key),
    onSuccess: (b) => {
      setMade(b)
      setFile(null)
      setKey(newMoveKey())
      refresh()
    },
  })
  const list = batches.data?.payouts ?? []
  return (
    <Card>
      <CardHeader>Bulk payouts</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <form
          className="flex flex-col gap-3"
          data-testid="payout-upload"
          onSubmit={(e) => {
            e.preventDefault()
            if (file !== null && !upload.isPending) upload.mutate()
          }}
        >
          <p className="text-caption text-muted">
            A CSV with a header row — <span className="font-figure">payee_id,amount,currency,reference</span> — and up to 1,000 rows, each a saved payee’s id, an amount such as{' '}
            <span className="font-figure">12.34</span>, GBP, EUR or USD and a reference. Every row is checked before anything moves; one approval pays the valid ones from the company’s
            account.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input aria-label="Payouts CSV" type="file" accept=".csv,text/csv" className="file:mr-3 file:border-0 file:bg-transparent file:text-caption file:text-ink" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <Button type="submit" disabled={file === null || upload.isPending}>
              {upload.isPending ? 'Checking rows…' : 'Upload and check'}
            </Button>
          </div>
          {upload.isError ? <Note ok={false}>{refusalText(upload.error)}</Note> : null}
        </form>
        {made !== null ? <Batch b={made} /> : null}
        {list.filter((b) => b.id !== made?.id).length > 0 ? (
          <ul className="flex flex-col gap-2" aria-label="Payout batches">
            {list
              .filter((b) => b.id !== made?.id)
              .map((b) => (
                <li key={b.id}>
                  <Batch b={b} />
                </li>
              ))}
          </ul>
        ) : null}
      </div>
    </Card>
  )
}

/** One batch: its counts and totals, every row's result once read, and its one approval. */
function Batch({ b }: { b: PayoutBatch }) {
  const qc = useQueryClient()
  const [shown, setShown] = useState(b.rows !== undefined && b.rows !== null)
  const detail = useQuery({ queryKey: [...PAYOUTS_KEY, b.id], queryFn: () => agentBankApi.payout(b.id), enabled: shown, initialData: b.rows ? b : undefined })
  const approve = useMutation({
    mutationFn: () => agentBankApi.approvePayout(b.id),
    onSuccess: (next) => {
      qc.setQueryData([...PAYOUTS_KEY, b.id], next)
      setShown(true)
      void qc.invalidateQueries({ queryKey: PAYOUTS_KEY })
      void qc.invalidateQueries({ queryKey: PAYMENTS_KEY })
      void qc.invalidateQueries({ queryKey: MONEY_ACCOUNTS_KEY })
    },
  })
  const batch = detail.data ?? b
  const totals = Object.entries(batch.totals_minor ?? {})
  const rows = batch.rows ?? []
  return (
    <div className="flex flex-col gap-2 rounded-card border border-rule p-3" data-testid={`payout-${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
        <span>
          <span className="font-figure">{batch.rows_total}</span> rows: <span className="font-figure">{batch.rows_valid}</span> valid,{' '}
          <span className="font-figure">{batch.rows_invalid}</span> invalid
          {totals.length > 0 ? (
            <>
              {' '}
              · <span className="font-figure">{totals.map(([c, n]) => formatMinor(n, c)).join(', ')}</span> to pay
            </>
          ) : null}
        </span>
        <Pill status={batch.status === 'approved' ? 'settled' : batch.status === 'awaiting_approval' ? 'held' : 'idle'}>
          {batch.status === 'awaiting_approval' ? 'Awaiting approval' : batch.status === 'approved' ? 'Approved' : batch.status}
        </Pill>
      </div>
      <p className="text-caption text-muted">
        Uploaded <span className="font-figure">{formatWhen(batch.created_at)}</span>
        {batch.approved_at ? (
          <>
            {' '}
            · approved <span className="font-figure">{formatWhen(batch.approved_at)}</span>
          </>
        ) : null}
      </p>
      {shown ? (
        rows.length > 0 ? (
          <ul className="flex flex-col gap-1" aria-label="Rows">
            {rows.map((r) => (
              <li key={r.line} className="flex flex-wrap items-center justify-between gap-2 text-caption text-ink" data-testid={`payout-row-${r.line}`}>
                <span className="min-w-0">
                  <span className="font-figure">{r.line}</span> · {r.payee_name || r.payee_id}
                  {r.reference ? ` · ${r.reference}` : ''}
                  {r.detail ? <span className="text-muted"> — {r.detail}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-figure">{formatMinor(r.amount_minor, r.currency)}</span>
                  <Pill status={r.status === 'invalid' || r.status === 'failed' || r.status === 'returned' ? 'slashed' : r.status === 'completed' ? 'settled' : r.status === 'valid' ? 'idle' : 'held'}>
                    {r.status}
                  </Pill>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-muted">{detail.isError ? readFailure(detail.error, 'Its rows') : 'Reading rows…'}</p>
        )
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {!shown ? (
          <Button type="button" onClick={() => setShown(true)}>
            Rows
          </Button>
        ) : null}
        {batch.status === 'awaiting_approval' && batch.rows_valid > 0 ? (
          <Button type="button" disabled={approve.isPending} onClick={() => approve.mutate()}>
            {approve.isPending ? 'Paying…' : `Approve and pay ${batch.rows_valid} ${batch.rows_valid === 1 ? 'row' : 'rows'}`}
          </Button>
        ) : null}
      </div>
      {approve.isError ? <Note ok={false}>{refusalText(approve.error)}</Note> : null}
    </div>
  )
}

const PAYEE_MATCH: Record<string, { text: (name: string) => string; pill: PillStatus }> = {
  matched: { text: (name) => `Saved payee: ${name}`, pill: 'settled' },
  bank_details_differ: { text: (name) => `Bank details differ from ${name}`, pill: 'slashed' },
  new_payee: { text: () => 'New payee', pill: 'held' },
}
const MISSING: Record<string, string> = { supplier: 'supplier', amount: 'amount', currency: 'currency', due_date: 'due date', invoice_number: 'invoice number' }

/** B41.1 — the bills inbox: an invoice uploaded as a file becomes one bill, matched to a saved payee or marked a new payee (Lens B41.101). */
function Bills({ payeeName }: { payeeName: (id: string | undefined) => string }) {
  const qc = useQueryClient()
  const bills = useQuery({ queryKey: BILLS_KEY, queryFn: agentBankApi.bills })
  const [file, setFile] = useState<File | null>(null)
  const upload = useMutation({
    mutationFn: () => agentBankApi.uploadBill(file as File),
    onSuccess: () => {
      setFile(null)
      void qc.invalidateQueries({ queryKey: BILLS_KEY })
    },
  })
  const list = bills.data?.bills ?? []
  // B41.2 — pay all due: the ticked bills become one payment request (Lens B41.102), approved once on its card at /approve/<id>.
  const navigate = useNavigate()
  const [unticked, setUnticked] = useState<Set<string>>(new Set())
  const [payKey, setPayKey] = useState(newMoveKey)
  const due = list.filter(payable)
  const ticked = due.filter((b) => !unticked.has(b.id))
  const pay = useMutation({
    mutationFn: () => agentBankApi.payBills(ticked.map((b) => b.id), payKey),
    onSuccess: (r) => {
      setPayKey(newMoveKey())
      void qc.invalidateQueries({ queryKey: BILLS_KEY })
      navigate(`/approve/${encodeURIComponent(r.id)}`)
    },
  })
  return (
    <Card>
      <CardHeader>Bills inbox</CardHeader>
      <div className="flex flex-col gap-3 px-gutter py-3">
        <form
          className="flex flex-col gap-3"
          data-testid="bill-upload"
          onSubmit={(e) => {
            e.preventDefault()
            if (file !== null && !upload.isPending) upload.mutate()
          }}
        >
          <p className="text-caption text-muted">
            Add an invoice you received — a PDF, Word, HTML or text file — and Talyvor reads its supplier, amount, due date and invoice number and finds the saved payee. Bank details
            printed on an invoice are shown, never paid on their own: a bill is paid to a saved payee. The same invoice added twice is one bill.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Invoice file"
              type="file"
              accept=".pdf,.docx,.html,.htm,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/html,text/plain,text/markdown"
              className="file:mr-3 file:border-0 file:bg-transparent file:text-caption file:text-ink"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button type="submit" disabled={file === null || upload.isPending}>
              {upload.isPending ? 'Reading invoice…' : 'Add bill'}
            </Button>
          </div>
          {upload.isError ? <Note ok={false}>{refusalText(upload.error)}</Note> : null}
          {upload.isSuccess ? (
            <Note ok>{upload.data.created ? `Added: ${upload.data.bill.supplier || 'a bill'}` : `Already in your inbox: ${upload.data.bill.supplier || 'this bill'}`}</Note>
          ) : null}
        </form>
        {bills.isError ? (
          <p className="text-body text-muted">{readFailure(bills.error, 'Your bills')}</p>
        ) : bills.isPending ? (
          <p className="text-body text-muted">Reading…</p>
        ) : list.length === 0 ? (
          <p className="text-body text-muted" data-testid="bills-empty">
            No bills yet: add an invoice you received above.
          </p>
        ) : (
          <>
            <ul className="flex flex-col gap-2" aria-label="Bills">
              {list.map((b) => (
                <BillRow
                  key={b.id}
                  b={b}
                  payeeName={payeeName}
                  ticked={payable(b) ? !unticked.has(b.id) : undefined}
                  onTick={() => {
                    setUnticked((s) => (s.has(b.id) ? new Set([...s].filter((x) => x !== b.id)) : new Set(s).add(b.id)))
                    setPayKey(newMoveKey())
                  }}
                />
              ))}
            </ul>
            {due.length > 0 ? (
              <div className="flex flex-col gap-2" data-testid="bills-pay">
                <p className="text-caption text-muted">
                  Pay the bills you tick as one batch: one card shows their count, total and every payee, and you approve it once with a passkey. Each bill is then paid
                  separately, with its invoice number as the reference, and never twice.
                  {list.some((b) => b.status === 'due' && !b.payee_id) ? ' A bill whose supplier is not a saved payee can be paid once you save the supplier as a payee.' : ''}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="primary" disabled={ticked.length === 0 || pay.isPending} onClick={() => pay.mutate()}>
                    {pay.isPending ? 'Preparing…' : `Pay ${ticked.length === 1 ? '1 bill' : `${ticked.length} bills`}`}
                  </Button>
                  {ticked.length > 0 ? (
                    <span className="text-caption text-muted" data-testid="bills-pay-total">
                      Total <span className="font-figure">{totalOf(ticked)}</span>
                    </span>
                  ) : (
                    <span className="text-caption text-muted">Tick at least one bill.</span>
                  )}
                </div>
                {pay.isError ? <Note ok={false}>{refusalText(pay.error)}</Note> : null}
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  )
}

/** B41.2 — a bill Lens can pay: still due, its amount read, and its supplier a saved payee (never the details printed on it). */
const payable = (b: Bill) => b.status === 'due' && !!b.payee_id && b.amount_minor > 0 && !!b.currency

/** Totals by currency, as one line: "£12.00, €3.00". */
const totalOf = (bills: Bill[]) =>
  Object.entries(bills.reduce<Record<string, number>>((t, b) => ({ ...t, [b.currency]: (t[b.currency] ?? 0) + b.amount_minor }), {}))
    .map(([cur, minor]) => formatMinor(minor, cur))
    .join(', ')

function BillRow({ b, payeeName, ticked, onTick }: { b: Bill; payeeName: (id: string | undefined) => string; ticked?: boolean; onTick: () => void }) {
  const match = PAYEE_MATCH[b.payee_match] ?? { text: () => b.payee_match, pill: 'idle' as PillStatus }
  const missing = (b.missing ?? []).map((m) => MISSING[m] ?? m)
  const printed = b.iban ? `${b.iban}${b.bic ? ` · ${b.bic}` : ''}` : b.routing_number ? `${b.routing_number} · ${b.account_number ?? ''}` : b.sort_code ? `${b.sort_code} · ${b.account_number ?? ''}` : ''
  return (
    <li className="flex flex-col gap-1 rounded-card border border-rule p-3" data-testid={`bill-${b.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-body text-ink">
        <span className="flex min-w-0 items-center gap-2">
          {ticked !== undefined ? (
            <input
              type="checkbox"
              className={`h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
              checked={ticked}
              onChange={onTick}
              aria-label={`Pay ${formatMinor(b.amount_minor, b.currency)} to ${b.supplier || 'this supplier'}`}
            />
          ) : null}
          <span className="min-w-0">
            {b.supplier || 'Supplier not read'}
            {b.invoice_number ? (
              <>
                {' '}
                · <span className="font-figure">{b.invoice_number}</span>
              </>
            ) : null}
          </span>
        </span>
        <span className="flex items-center gap-2">
          {b.amount_minor > 0 && b.currency ? <span className="font-figure">{formatMinor(b.amount_minor, b.currency)}</span> : null}
          <Pill status={b.status === 'paid' ? 'settled' : 'held'}>{b.status === 'paid' ? 'Paid' : 'Due'}</Pill>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted">
        <span>
          {b.due_date ? (
            <>
              Due <span className="font-figure">{b.due_date}</span>
            </>
          ) : (
            'No due date read'
          )}
          {printed ? (
            <>
              {' '}
              · printed details <span className="font-figure">{printed}</span>
            </>
          ) : null}
        </span>
        <Pill status={match.pill}>{match.text(payeeName(b.payee_id))}</Pill>
      </div>
      {missing.length > 0 ? <p className="text-caption text-muted">Could not read: {missing.join(', ')}</p> : null}
    </li>
  )
}
