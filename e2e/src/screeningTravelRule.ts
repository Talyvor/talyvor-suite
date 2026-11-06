// B48.27 — screening and the Travel Rule on an agent's USDC payments (talyvor-lens B48.7), on Lens's API, once a run, on a workspace
// of its own.
//
// The owner funds an agent's USDC wallet with 5,000 USDC of test money and saves three payees at addresses, each confirmed and
// called with a passkey: the address the Test screening provider flags, the one the Test Travel Rule provider names as a regulated
// provider, and a self-hosted one whose key the run holds. The agent's own key pays each. The flagged address is refused 403 with no
// hold on the wallet's ledger. The provider's address is paid and its Travel Rule record (travel_rule_transfers) reads sent. 1,500
// USDC to the self-hosted address is refused 409 with nothing held; the owner posts the address's personal_sign of Lens's proof
// message to POST /v1/money/payees/{id}/address-proof, and the next 1,500 USDC payment holds exactly that on the wallet's ledger.
// Until Lens serves talyvor-lens B48.31's contract (test money into an agent's wallet, the two test addresses, the payment's
// travel_rule), or while LENS_TRAVEL_RULE is off, it is a SKIP, never a pass.

import { randomBytes } from 'node:crypto'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { fail } from './bank.ts'
import type { Answered } from './lens.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { said } from './routes.ts'
import { CannotTest, type Scenario } from './scenarios.ts'

/** talyvor-lens B48.31: the address the Test screening provider always flags (a mixer), and the one its Travel Rule provider names. */
export const FLAGGED_ADDRESS = '0x7e57000000000000000000000000000000000001'
export const VASP_ADDRESS = '0x7e57000000000000000000000000000000000002'
/** Lens's SelfHostedProofAboveMinor: 1,000 USDC in micro-USDC. */
const PROOF_ABOVE_MINOR = 1_000_000000
const FUND_MINOR = 5_000_000000
const SMALL_MINOR = 10_000000
const LARGE_MINOR = 1_500_000000
const CAPABILITIES = ['payments_in', 'payments_out', 'stablecoins']

interface Wallet { account_id: string; asset: string }
interface Payee { id: string; name: string; needs_confirmation: boolean; cooling_off_until?: string }
interface Payment { id: string; status: string; amount_minor: number; travel_rule?: { status?: string; vasp?: string; provider_ref?: string } }
interface Line { account_id: string; kind: string; amount_minor: number }

/** The address of secp256k1 public key `pub` (uncompressed), lower-case. */
const addressOf = (pub: Uint8Array): string => `0x${Buffer.from(keccak_256(pub.slice(1)).slice(12)).toString('hex')}`
const personalHash = (message: string): Uint8Array => keccak_256(Buffer.from(`\x19Ethereum Signed Message:\n${Buffer.byteLength(message)}${message}`))

/** A key the person holds in a wallet of their own: its address, and its personal_sign (EIP-191) of a message, r‖s‖v, hex. */
export function selfHostedKey() {
  const secret = secp256k1.utils.randomSecretKey()
  return {
    address: addressOf(secp256k1.getPublicKey(secret, false)),
    sign(message: string): string {
      const sig = secp256k1.sign(personalHash(message), secret, { prehash: false, format: 'recovered' }) // recovery‖r‖s
      return `0x${Buffer.from([...sig.slice(1), 27 + sig[0]]).toString('hex')}`
    },
  }
}

/** The address that signed `message` with `signature` (r‖s‖v, hex), as Lens's smartaccount.PersonalSigner reads it; '' when none did. */
export function signerOf(message: string, signature: string): string {
  try {
    const b = Buffer.from(signature.replace(/^0x/, ''), 'hex')
    if (b.length !== 65 || (b[64] !== 27 && b[64] !== 28)) return ''
    const pub = secp256k1.recoverPublicKey(Uint8Array.from([b[64] - 27, ...b.subarray(0, 64)]), personalHash(message), { prehash: false })
    return addressOf(secp256k1.Point.fromBytes(pub).toBytes(false))
  } catch {
    return ''
  }
}

/** Lens's economy.AddressProofMessage: what the owner signs with the address's key. */
export const proofMessage = (workspaceID: string, address: string): string =>
  `Talyvor: I hold the key of ${address.toLowerCase()} on base. Workspace ${workspaceID}.`

export function screeningTravelRule(): Scenario {
  return {
    id: 'screening-travel-rule',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B48.7', 'B48.27'],
    title: "an agent's USDC payment to a flagged address is refused with nothing held; one to a regulated provider's address carries the " +
      'Travel Rule record; more than 1,000 USDC to a self-hosted address answers 409 until the owner proves its key, then holds once',
    run: async (ctx) => {
      const { lens } = ctx.env
      const user = ctx.app.user
      const call = async <T>(method: string, path: string, body: object | undefined, note: string): Promise<Answered<T>> => {
        const got = await lens.act<T>(user, method, path, body)
        ctx.evidence.push({ note, answer: said(got) })
        return got
      }

      const terms = await call<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      if (!terms.ok) return fail(`reading the workspace's terms answered ${said(terms)}`)
      for (const t of (terms.value.terms ?? []).filter((x) => CAPABILITIES.includes(x.capability) && x.accepted == null)) {
        const accepted = await call('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (accepted.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(accepted)}`)
      }

      // The agent's USDC wallet, with 5,000 USDC of test money in it.
      const agent = await lens.createAgent(user, `Screened payer ${RUN_SALT}`)
      const wallets = await call<{ wallets: Wallet[] | null }>('GET', `/v1/workspaces/{ws}/agents/${agent.id}/wallets`, undefined, `${agent.name}'s wallets`)
      const usdc = wallets.ok ? (wallets.value.wallets ?? []).find((w) => w.asset === 'USDC')?.account_id ?? '' : ''
      if (usdc === '') return fail(`a new agent must have a USDC wallet; Lens answered ${said(wallets)}`)
      const funded = await call('POST', `/v1/money/accounts/${usdc}/test-money`, { amount_minor: FUND_MINOR, idempotency_key: `e2e-${randomBytes(8).toString('hex')}` },
        `5,000 USDC of test money into ${agent.name}'s wallet`)
      if (funded.status === 404 || funded.status === 400) throw new CannotTest(`Lens puts no test money into an agent's wallet (${said(funded)}): talyvor-lens B48.31 is not deployed`)
      if (funded.status !== 201) return fail(`test money into the agent's wallet must answer 201; Lens answered ${said(funded)}`)
      const k = await lens.act<{ key: string }>(user, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/keys`, { name: 'screening-travel-rule' })
      if (!k.ok) return fail(`issuing ${agent.name} a key was refused: ${said(k)}`)

      // A passkey, and three payees at addresses, each confirmed and called with it.
      const reg = await call<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the owner asks to register a passkey')
      if (!reg.ok) return fail(`the passkey registration challenge was refused: ${said(reg)}`)
      const passkey = softPasskey(reg.value.rp_id)
      const registered = await call('POST', '/v1/workspaces/{ws}/agents/passkeys', passkey.register(reg.value.challenge, 'Nightly software passkey'), 'the owner registers a passkey')
      if (registered.status !== 201) return fail(`registering a passkey must answer 201; Lens answered ${said(registered)}`)
      const save = async (name: string, address: string): Promise<Payee | string> => {
        const saved = await call<Payee>('POST', '/v1/money/payees', { name, country: 'GB', network: 'base', address }, `the owner saves ${name} at ${address}`)
        if (saved.status !== 201 || !saved.ok) return `saving ${name} at ${address} must answer 201; Lens answered ${said(saved)}`
        for (const [step, when] of [['', saved.value.needs_confirmation], ['called/', true]] as const) {
          if (!when) continue
          const ch = await call<{ challenge: string }>('POST', `/v1/money/payees/${saved.value.id}/${step}challenge`, {}, `${name}'s ${step === '' ? 'confirm' : 'called'} challenge`)
          if (!ch.ok) return `${name}'s ${step}challenge answered ${said(ch)}`
          const done = await call('POST', `/v1/money/payees/${saved.value.id}/${step === '' ? 'confirm' : 'called'}`, { assertion: passkey.assert(ch.value.challenge) },
            `the owner ${step === '' ? 'confirms' : 'says they called'} ${name}, with the passkey`)
          if (done.status !== 200) return `${step === '' ? 'confirming' : 'calling'} ${name} with the passkey must answer 200; Lens answered ${said(done)}`
        }
        return saved.value
      }
      const own = selfHostedKey()
      const flagged = await save(`Nightly flagged ${RUN_SALT}`, FLAGGED_ADDRESS)
      const exchange = await save(`Nightly exchange customer ${RUN_SALT}`, VASP_ADDRESS)
      const mine = await save(`Nightly own wallet ${RUN_SALT}`, own.address)
      for (const p of [flagged, exchange, mine]) if (typeof p === 'string') return fail(p)
      const [flaggedP, exchangeP, mineP] = [flagged, exchange, mine] as Payee[]

      const pay = async (payee: Payee, amount: number, note: string) => {
        const r = await lens.as(k.value.key, 'POST', '/v1/money/payments', { payee_id: payee.id, amount_minor: amount, currency: 'USDC', reference: `Screening ${RUN_SALT}` },
          { 'Idempotency-Key': `e2e-str-${randomBytes(6).toString('hex')}` })
        ctx.evidence.push({ note, answer: `${r.status} ${r.text.slice(0, 400)}` })
        return { status: r.status, text: r.text, payment: r.status === 201 ? JSON.parse(r.text) as Payment : undefined }
      }
      const holds = async (note: string): Promise<number[]> => {
        const a = await call<{ lines: Line[] | null }>('GET', `/v1/workspaces/{ws}/agents/${agent.id}/wallet/activity?limit=1000`, undefined, `${agent.name}'s wallet ${note}`)
        if (!a.ok) throw new Error(`reading ${agent.name}'s wallet ${note} answered ${said(a)}`)
        return (a.value.lines ?? []).filter((l) => l.account_id === usdc && l.kind === 'payment_out_hold').map((l) => l.amount_minor)
      }

      // 1. A regulated provider's address: paid, its Travel Rule record sent. A Lens with the step off still screens.
      const sent = await pay(exchangeP, SMALL_MINOR, `${agent.name} pays 10 USDC to the address the Test Travel Rule provider names`)
      if (sent.payment === undefined) return fail(`10 USDC to a regulated provider's address must answer 201; Lens answered ${sent.status} ${sent.text.slice(0, 300)}`)
      const read = await call<Payment>('GET', `/v1/money/payments/${sent.payment.id}`, undefined, 'the owner reads that payment')
      const travel = read.ok ? read.value.travel_rule : undefined
      if (travel === undefined) throw new CannotTest(`Lens's payment carries no travel_rule (${said(read)}): talyvor-lens B48.31 is not deployed`)
      if (travel.status !== 'off' && (travel.status !== 'sent' || (travel.vasp ?? '') === '' || (travel.provider_ref ?? '') === '')) {
        return fail(`a payment to the address a regulated provider holds must carry its Travel Rule record sent, naming the provider; Lens read ${JSON.stringify(travel)}`)
      }

      // 2. The flagged address: refused, and nothing held.
      const before = await holds('before the flagged payment')
      const refused = await pay(flaggedP, SMALL_MINOR, `${agent.name} pays 10 USDC to the address the Test screening provider flags`)
      const afterRefused = await holds('after the flagged payment')
      if (refused.status !== 403 || afterRefused.length !== before.length) {
        return fail(`a payment to a flagged address must be refused 403 with nothing held; Lens answered ${refused.status} ${refused.text.slice(0, 200)} ` +
          `and the wallet's holds went from ${before.length} to ${afterRefused.length}`)
      }
      if (travel.status === 'off') throw new CannotTest('the flagged address was refused with nothing held, but the Travel Rule is off on this Lens (LENS_TRAVEL_RULE unset)')

      // 3. More than 1,000 USDC to a self-hosted address: 409 and nothing held, until the owner proves its key; then held once.
      const asked = await pay(mineP, LARGE_MINOR, `${agent.name} pays 1,500 USDC to a self-hosted address not yet proved`)
      const afterAsked = await holds('after the unproved payment')
      if (asked.status !== 409 || afterAsked.length !== afterRefused.length) {
        return fail(`more than ${PROOF_ABOVE_MINOR / 1e6} USDC to a self-hosted address not proved must answer 409 with nothing held; Lens answered ` +
          `${asked.status} ${asked.text.slice(0, 200)} and the wallet's holds went from ${afterRefused.length} to ${afterAsked.length}`)
      }
      const proved = await call('POST', `/v1/money/payees/${mineP.id}/address-proof`, { signature: own.sign(proofMessage(user.workspaceID, own.address)) },
        "the owner posts the address's personal_sign of the proof message")
      if (proved.status !== 200) return fail(`the address's own signature of the proof message must answer 200; Lens answered ${said(proved)}`)
      const paid = await pay(mineP, LARGE_MINOR, `${agent.name} pays 1,500 USDC to the address, now proved`)
      const afterPaid = await holds('after the proved payment')
      const added = afterPaid.slice(0, afterPaid.length - afterAsked.length)
      if (paid.payment === undefined || added.length !== 1 || added[0] !== -LARGE_MINOR) {
        return fail(`1,500 USDC to the proved address must answer 201 and hold exactly -${LARGE_MINOR} once on the wallet's ledger; Lens answered ` +
          `${paid.status} ${paid.text.slice(0, 200)} and the new holds are ${JSON.stringify(added)}`)
      }

      return {
        pass: true,
        detail: `10 USDC to the provider's address carried its Travel Rule record (sent to ${travel.vasp}); 10 USDC to the flagged address was refused 403 ` +
          'with nothing held; 1,500 USDC to a self-hosted address answered 409 with nothing held, and once its key signed the proof, held -1,500 USDC once',
      }
    },
  }
}
