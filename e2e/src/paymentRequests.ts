// B40.27 — an assistant prepares a batch, and nothing is paid (Lens B40.3), on Lens's API, once a run, on a workspace of its own.
//
// The owner opens a GBP account on test money, saves three payees — the plumber, a stranger and a TESTNOMATCH one — and signs a
// permission mandate (as B40.26 does) letting Chat and voice pay the plumber and the no-match payee up to £100 a payment. A
// three-item batch from Chat — £120 to the plumber, £50 to the stranger, £30 to the no-match payee — is pending_approval: the
// first two need approval (limits.per_payment, scope) and the third is blocked because its name did not match; its payload_hash
// is the SHA-256 of its canonical and it carries both approval links. The same Idempotency-Key again is the same request; the
// same key with a changed amount answers 409. £90 to the plumber by voice needs approval (clients.voice); an "iban" in the
// arguments is refused. And nothing moved: the account still holds nothing and the workspace has no payment.

import { createHash, randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import type { Scenario } from './scenarios.ts'

interface Item { position: number; payee_id: string; decision: string; reason: string; rule?: string; mandate_id?: string; payment_id?: string; pay_status?: string }
interface Request { id: string; kind: string; status: string; canonical: string; payload_hash: string; approval_url: string; deep_link: string; items: Item[] | null }
interface Account { id: string; currency: string; test_minor: number; live_minor: number }

const PLUMBER = { name: 'Nightly Plumbing Ltd', country: 'GB', sort_code: '040004', account_number: '24681357' }
const STRANGER = { name: 'Nightly Stranger Consulting Ltd', country: 'GB', sort_code: '040004', account_number: '13572468' }
const NOMATCH = { name: 'Nightly TESTNOMATCH Supplies Ltd', country: 'GB', sort_code: '040004', account_number: '97531864' }
const item = (payee: string, minor: number, reference: string) => ({ payee_id: payee, currency: 'GBP', amount_minor: minor, reference })

export function paymentRequestBatch(): Scenario {
  return {
    id: 'payment-request-batch',
    owner: 'talyvor-lens',
    own: true,
    feature: 'Agent Wallets',
    items: ['B40.27'],
    title: 'an assistant prepares a three-item batch under a signed mandate — two need approval, a no-match payee blocked, the payload hashed, ' +
      'both approval links; the same key is the same request, a changed amount 409; £90 by voice needs approval; an iban refused; nothing paid',
    run: async (ctx) => {
      const { lens } = ctx.env
      const [owner] = await lens.createUsers(1)
      const call = async <T>(method: string, path: string, body: object | undefined, note: string, headers: Record<string, string> = {}): Promise<Answered<T>> => {
        const got = await lens.act<T>(owner, method, path, body, headers)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }
      const prepare = (key: string, body: object, note: string) =>
        call<Request>('POST', '/v1/money/payment-requests', body, note, { 'Idempotency-Key': key })

      // An account for money to sit in, and three saved payees.
      const opened = await call<Account>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the owner opens a GBP account on test money')
      if (opened.status !== 201 || !opened.ok) return fail(`opening a GBP account must answer 201; Lens answered ${said(opened)}`)
      const ids: string[] = []
      for (const [p, note] of [[PLUMBER, 'the plumber'], [STRANGER, 'a stranger'], [NOMATCH, 'a TESTNOMATCH payee']] as const) {
        const saved = await call<{ id: string }>('POST', '/v1/money/payees', p, `the owner saves ${note}`)
        if (saved.status !== 201 || !saved.ok) return fail(`saving ${note} must answer 201; Lens answered ${said(saved)}`)
        ids.push(saved.value.id)
      }
      const [plumber, stranger, nomatch] = ids

      // B40.26's signed mandate: Chat and voice may pay the plumber and the no-match payee up to £100 a payment.
      const reg = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const key = softPasskey(reg.value.rp_id)
      const registered = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly request passkey'), 'the owner registers a P-256 passkey')
      if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)
      const terms = await call<{ canonical: string; challenge: string }>('POST', '/v1/money/permission-mandates/prepare', {
        principal: { type: 'person', name: 'Nightly Person' }, clients: ['chat', 'voice'], scope: { payees: [plumber, nomatch], currencies: ['GBP'] },
        limits: { per_payment: { GBP: 10_000 } }, new_payee: { policy: 'confirmation_of_payee' }, expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      }, 'the owner prepares a mandate: the plumber and the no-match payee, £100 a payment')
      if (!terms.ok) return fail(`preparing the mandate must answer 200; Lens answered ${said(terms)}`)
      const signed = await call<{ id: string; status: string }>('POST', '/v1/money/permission-mandates',
        { canonical: terms.value.canonical, assertion: key.assert(terms.value.challenge) }, 'the owner signs the mandate with the passkey')
      if (signed.status !== 201 || !signed.ok || signed.value.status !== 'active') return fail(`the signed mandate must answer 201 active; Lens answered ${said(signed)}`)
      const mandate = signed.value.id

      // The batch.
      const run = randomUUID()
      const batch = { client: 'chat', items: [item(plumber, 12_000, 'INV-1'), item(stranger, 5_000, 'INV-2'), item(nomatch, 3_000, 'INV-3')] }
      const first = await prepare(`e2e-batch-${run}`, batch, 'chat prepares £120 to the plumber, £50 to a stranger and £30 to the no-match payee')
      if (first.status !== 201 || !first.ok || first.value.status !== 'pending_approval' || first.value.kind !== 'batch') {
        return fail(`the batch must answer 201 pending_approval; Lens answered ${said(first)}`)
      }
      const req = first.value
      const wrong: string[] = []
      const items = req.items ?? []
      const want = [['needs_approval', 'limits.per_payment', mandate], ['needs_approval', 'scope', mandate], ['blocked', 'payee', undefined]] as const
      want.forEach(([decision, rule, mandateID], i) => {
        const it = items[i]
        if (it === undefined || it.decision !== decision || it.rule !== rule || it.mandate_id !== mandateID || (it.reason ?? '') === '') {
          wrong.push(`item ${i + 1} must be ${decision} by ${rule}${mandateID === undefined ? '' : ` under ${mandateID}`} with a reason; Lens judged ${JSON.stringify(it)}`)
        }
      })
      if (!(items[2]?.reason ?? '').includes('did not match its account')) wrong.push(`the no-match payee's reason must say its name did not match its account; it reads "${items[2]?.reason}"`)
      const hash = createHash('sha256').update(req.canonical ?? '').digest('hex')
      if (req.payload_hash !== hash) wrong.push(`the payload_hash ${req.payload_hash} is not the SHA-256 of its canonical (${hash})`)
      if (req.approval_url !== `https://app.talyvor.com/approve/${req.id}` || req.deep_link !== `talyvor://approve/${req.id}`) {
        wrong.push(`the approval links are ${req.approval_url} and ${req.deep_link}`)
      }
      if (wrong.length > 0) return fail(wrong.join('; '))

      // The same key: the same request; with a changed amount: refused.
      const again = await prepare(`e2e-batch-${run}`, batch, 'chat prepares the same batch under the same key')
      if (again.status !== 200 || !again.ok || again.value.id !== req.id || again.value.payload_hash !== req.payload_hash) {
        return fail(`the same key and batch again must answer 200 with request ${req.id}; Lens answered ${said(again)}`)
      }
      const changed = { ...batch, items: [item(plumber, 12_001, 'INV-1'), ...batch.items.slice(1)] }
      const conflict = await prepare(`e2e-batch-${run}`, changed, 'chat prepares the batch under the same key with £120.01 to the plumber')
      if (conflict.status !== 409) return fail(`the same key with a changed amount must answer 409; Lens answered ${said(conflict)}`)

      // By voice, inside the mandate: still needs approval.
      const voice = await prepare(`e2e-voice-${run}`, { client: 'voice', items: [item(plumber, 9_000, 'INV-4')] }, 'voice prepares £90 to the plumber')
      const vi = voice.ok ? (voice.value.items ?? [])[0] : undefined
      if (voice.status !== 201 || !voice.ok || voice.value.status !== 'pending_approval' || vi?.decision !== 'needs_approval' || vi.rule !== 'clients.voice') {
        return fail(`£90 to the plumber by voice must answer 201 pending_approval, needs_approval by clients.voice; Lens answered ${said(voice)}`)
      }

      // Bank details from the assistant: refused.
      const iban = await prepare(`e2e-iban-${run}`, { client: 'chat', items: [{ ...item(plumber, 9_000, 'INV-5'), iban: 'GB33BUKB20201555555555' }] },
        'chat prepares £90 to the plumber with an iban in the arguments')
      if (iban.status !== 400 || !said(iban).includes('payee details supplied by the assistant')) {
        return fail(`an iban in the arguments must be refused 400 as payee details supplied by the assistant; Lens answered ${said(iban)}`)
      }

      // Nothing paid: the account holds nothing, the workspace has no payment, and no item was paid.
      const accounts = await call<{ accounts: Account[] | null }>('GET', '/v1/money/accounts', undefined, 'the owner lists the accounts')
      if (!accounts.ok) return fail(`the list of accounts was refused: ${said(accounts)}`)
      const gbp = (accounts.value.accounts ?? []).find((a) => a.id === opened.value.id)
      if (gbp === undefined || gbp.test_minor !== 0 || gbp.live_minor !== 0) return fail(`preparing must move no money: the GBP account reads ${JSON.stringify(gbp)}`)
      const payments = await call<{ payments: unknown[] | null }>('GET', '/v1/money/payments', undefined, 'the owner lists the payments')
      if (!payments.ok || (payments.value.payments ?? []).length !== 0) return fail(`preparing must make no payment; GET /v1/money/payments answered ${said(payments)}`)
      const status = await call<Request>('GET', `/v1/money/payment-requests/${req.id}`, undefined, 'the owner reads the batch')
      if (!status.ok || status.value.payload_hash !== req.payload_hash) return fail(`the batch must read back with its hash; Lens answered ${said(status)}`)
      const paid = (status.value.items ?? []).filter((it) => (it.payment_id ?? '') !== '' || (it.pay_status ?? '') !== '')
      if (paid.length > 0) return fail(`preparing must pay no item; Lens reads ${JSON.stringify(paid)}`)

      return {
        pass: true,
        detail: `batch ${req.id} pending_approval: £120 needs_approval (limits.per_payment), £50 needs_approval (scope), the no-match payee blocked; ` +
          'payload_hash the SHA-256 of its canonical, both approval links; the same key the same request, a changed amount 409; £90 by voice ' +
          'needs_approval (clients.voice); an iban refused 400; the GBP account holds nothing and no payment was made',
      }
    },
  }
}
