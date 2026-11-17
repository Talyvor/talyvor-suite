import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button, Facts, Icon, Money, showToast } from '@talyvor/ui/pocket'
import { DEVICES_KEY, PASSKEYS_KEY } from './AgentBank'
import { lineWhen } from './AgentStatement'
import { receiptText } from './InstantTransferReceipt'
import { agentBankApi, type DeviceKey, type Passkey, type PaymentProof, type ProofPayment } from './agentBankApi'

// B62.3 — a payment's proof, from Lens B62.1's record: what the owner approved (the payee and the amount), when, with
// which key, the rule that asked them or let it pass, and what was sent. The agent's task sits above it in its own words,
// always after "The agent says:" (Lens B62.2), never as a fact. One button copies the proof as text, for a dispute.

/** What the agent says a payment is for, as every screen shows it: after these words and nothing else. A span inside a line. */
export function TaskSays({ task, className, inline = false }: { task?: string; className?: string; inline?: boolean }) {
  if (!task) return null
  const Tag = inline ? 'span' : 'p'
  return (
    <Tag className={className ?? 'text-body text-ink-2'} data-receipt-line data-testid="agent-says">
      The agent says: “{task}”
    </Tag>
  )
}

/** The rule that sent a payment to the owner, or let it pass, in words. */
export const PROOF_RULE: Record<string, string> = {
  approval_above: 'It was above the amount the agent’s rules ask you about',
  prepared: 'An assistant prepared it, so it waited for you',
  within_rules: 'Inside the agent’s rules, so it needed no approval',
  always_allow: 'You always allow this payee',
  mandate: 'Within a mandate you signed in advance',
  no_rules: 'The agent has no rules, so it needed no approval',
}

/** The key that signed, in words: "Face ID on Nick’s iPhone", "Passkey on MacBook Pro". */
export function proofKeyWords(p: Pick<PaymentProof, 'key_kind' | 'key_id'>, passkeys: Passkey[], devices: DeviceKey[]): string {
  switch (p.key_kind) {
    case 'device': {
      const d = devices.find((x) => x.id === p.key_id)
      return `${d?.platform === 'android' ? 'Fingerprint' : 'Face ID'} on ${d?.name || 'your phone'}`
    }
    case 'passkey': {
      const k = passkeys.find((x) => x.credential_id === p.key_id)
      return k?.name ? `Passkey on ${k.name}` : 'Your passkey'
    }
    case 'approver_agent':
      return 'Your approver agent, within the limits you gave it'
  }
  return ''
}

function Amount({ p }: { p: ProofPayment }) {
  return p.currency === 'LXC' ? <Money ulxc={p.amount_minor} /> : <Money minor={p.amount_minor} currency={p.currency} />
}

function PaidTo({ p }: { p: ProofPayment }) {
  return (
    <>
      <Amount p={p} /> to {p.payee.name || 'the payee'}
    </>
  )
}

/** The read of a payment's proof by its money entry: its page starts it beside the statement, so both arrive at once. */
export const paymentProofQuery = (entry: string) => ({ queryKey: ['payment-proof', entry], queryFn: () => agentBankApi.paymentProof(entry) })

/**
 * The proof of one payment, drawn, with the agent's task above it (`task`, the statement's; else the record's); nothing
 * but the task for a payment the rules never judged.
 */
export function PaymentProofSection({ entry, task }: { entry: string; task?: string }) {
  const proof = useQuery(paymentProofQuery(entry))
  const signed = !!proof.data?.key_kind
  const passkeys = useQuery({ queryKey: PASSKEYS_KEY, queryFn: agentBankApi.passkeys, enabled: proof.data?.key_kind === 'passkey' })
  const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: agentBankApi.devices, enabled: proof.data?.key_kind === 'device' })
  const body = useRef<HTMLDivElement>(null)
  if (proof.isError) return <p className="text-body text-ink-2">We couldn’t read this payment’s proof. Try again in a moment.</p>
  const p = proof.data
  const says = task || p?.sent.task
  if (!p) return proof.isPending ? null : <TaskSays task={says} />
  const rule = `${PROOF_RULE[p.rule] ?? 'The agent’s rules'}${p.rules_version != null ? ` (rules version ${p.rules_version})` : ''}`
  const copy = () => {
    if (!body.current) return
    void (navigator.clipboard?.writeText(receiptText(body.current, 'Payment proof')) ?? Promise.reject(new Error('no clipboard'))).then(
      () => showToast('Proof copied'),
      () => showToast('We couldn’t copy it. Select it and copy it instead.'),
    )
  }
  const facts = signed
    ? [
        { label: 'You approved', value: <PaidTo p={p.shown} /> },
        { label: 'When', value: lineWhen(p.signed_at ?? p.created_at) },
        { label: 'Signed with', value: proofKeyWords(p, passkeys.data?.passkeys ?? [], devices.data?.devices ?? []) || 'Your key' },
        { label: 'The rule', value: rule },
        { label: 'What was sent', value: <PaidTo p={p.sent} /> },
      ]
    : [
        { label: 'The rule', value: rule },
        { label: 'When', value: lineWhen(p.created_at) },
        { label: 'What was sent', value: <PaidTo p={p.sent} /> },
      ]
  return (
    <section className="grid gap-2" aria-labelledby="payment-proof-title" data-testid="payment-proof">
      <div ref={body} className="contents">
        <TaskSays task={says} />
        <h2 id="payment-proof-title" className="font-display text-reading font-bold text-ink">
          Proof
        </h2>
        <Facts facts={facts} />
        {signed ? (
          <p className="text-caption text-ink-3" data-receipt-line>
            {p.verified ? 'The signature checks out: it is by this key, over exactly what you approved.' : 'The signature does not check out against what you approved.'}
          </p>
        ) : null}
      </div>
      <div>
        <Button type="button" variant="secondary" onClick={copy}>
          <Icon name="copy" size={18} />
          Copy the proof
        </Button>
      </div>
    </section>
  )
}
