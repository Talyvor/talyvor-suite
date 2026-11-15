// passkeys.ts — B19.10: approvals with Face ID, on the phone.
//
// The browser half of Lens's B19.16. A passkey is made on this device (Face ID, Touch ID or the
// device's PIN — WebAuthn with user verification required) and Lens keeps its public key; from then
// on every approve or deny is signed with it over a challenge Lens issues for that one approval.
// Pushes arrive through /sw.js, subscribed with the key Lens serves.

import {
  agentBankApi,
  type EnrolmentWaiting,
  type Mandate,
  type MandateGrant,
  type MoneyKind,
  type OutsidePayment,
  type OutsidePaymentRequest,
  type PasskeyAssertion,
  type PayeeAllowance,
  type PayeeDetails,
  type PayoutBatch,
  type RecoveryPasskey,
  type WorkspaceAccount,
} from './agentBankApi'
import { showRecoveryCode } from './recoveryCodeStore'

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromB64u(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Whether this browser can make and use passkeys at all. */
export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials
}

/** Whether this browser can take pushes (on an iPhone: only once added to the Home Screen). */
export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window
}

/**
 * Makes a passkey on this device and registers it with Lens. B55.3: when only the phone holds a key nothing here can sign,
 * so Lens keeps it waiting for the phone to let it in, and that enrolment is returned; null once it is registered.
 */
export async function registerThisDevice(name: string): Promise<EnrolmentWaiting | null> {
  const { challenge, rp_id, credential_ids } = await agentBankApi.passkeyChallenge()
  // B50.22: once the workspace has a passkey, one of them signs the new key's own challenge first (Lens B50.20).
  const assertion = (credential_ids ?? []).length > 0 ? await assertOver({ challenge, allow_credentials: credential_ids ?? [] }) : undefined
  const registered = await agentBankApi.registerPasskey({ ...(await makePasskey(challenge, rp_id, name)), ...(assertion ? { assertion } : {}) })
  if ('enrolment' in registered) return registered.enrolment
  // B55.54: the workspace's first key comes with its recovery code, shown this once.
  if (registered.recovery_code) showRecoveryCode(registered.recovery_code)
  return null
}

/** Makes a passkey on this device over a registration challenge Lens issued; nothing is sent yet. */
async function makePasskey(challenge: string, rp_id: string, name: string): Promise<RecoveryPasskey> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: fromB64u(challenge),
      rp: { id: rp_id, name: 'Talyvor' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'Talyvor approvals', displayName: name },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }], // ES256, the one Lens verifies
      authenticatorSelection: { userVerification: 'required', residentKey: 'preferred' },
      attestation: 'none',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('No passkey was made.')
  const res = cred.response as AuthenticatorAttestationResponse
  const spki = res.getPublicKey()
  if (!spki || res.getPublicKeyAlgorithm() !== -7) {
    throw new Error('This device made a passkey Lens cannot check (it needs ES256).')
  }
  return {
    credential_id: b64u(cred.rawId),
    name,
    public_key: b64u(spki),
    client_data_json: b64u(res.clientDataJSON),
    authenticator_data: b64u(res.getAuthenticatorData()),
  }
}

/**
 * B55.54 — every key of the workspace was removed: a passkey made here is added at once with the recovery code (Lens
 * B55.48), or, without it, once the 72 hours of a recovery this person started have passed. Lens answers a new code.
 */
export async function getAKeyBack(name: string, code?: string): Promise<void> {
  const { challenge, rp_id } = await agentBankApi.passkeyChallenge()
  const passkey = await makePasskey(challenge, rp_id, name)
  const got = code === undefined ? await agentBankApi.completeRecovery(passkey) : await agentBankApi.recoverWithCode(code, passkey)
  showRecoveryCode(got.recovery_code)
}

/** B55.54 — a new recovery code, signed with a key of this workspace as any key change is; the old one stops working. */
export async function makeNewRecoveryCode(): Promise<void> {
  const { recovery_code } = await agentBankApi.newRecoveryCode(await assertOver(await agentBankApi.recoveryCodeChallenge()))
  showRecoveryCode(recovery_code)
}

/** B55.3 — lets in a key waiting on another device: a passkey of this workspace signs its enrolment challenge here. */
export async function letInKey(enrolmentID: string): Promise<void> {
  await agentBankApi.approveEnrolment(enrolmentID, await assertOver(await agentBankApi.enrolmentChallenge(enrolmentID)))
}

/** Signs one approval's challenge with a passkey of this workspace — Face ID asks here. With always allow, over that allowance too. */
export async function signApproval(approvalID: string, alwaysAllow?: PayeeAllowance): Promise<PasskeyAssertion> {
  return assertOver(await agentBankApi.approvalChallenge(approvalID, alwaysAllow))
}

/** B30.96 — signs a saved payee's challenge the same way: a close or no match is confirmed only so (Lens B30.16). */
export async function signPayee(payeeID: string): Promise<PasskeyAssertion> {
  return assertOver(await agentBankApi.payeeChallenge(payeeID))
}

/** B41.11 — signs a new payee's "I called them" challenge: its 24-hour cooling-off ends (Lens B41.111). */
export async function signPayeeCalled(payeeID: string): Promise<PasskeyAssertion> {
  return assertOver(await agentBankApi.payeeCalledChallenge(payeeID))
}

/** B41.12 — signs the challenge for changing a payee's bank details to exactly `details` (Lens B41.112). */
export async function signPayeeDetails(payeeID: string, details: PayeeDetails): Promise<PasskeyAssertion> {
  return assertOver(await agentBankApi.payeeDetailsChallenge(payeeID, details))
}

/**
 * B54.35 — a person's payment is signed (Lens B54.33): once the workspace has a passkey, Face ID asks here over the
 * challenge naming exactly this payment, and nothing is paid without it. With none, it pays as before.
 */
export async function payOutsideSigned(body: OutsidePaymentRequest): Promise<OutsidePayment> {
  const c = await agentBankApi.paymentChallenge(body)
  return agentBankApi.payOutside(body, (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
}

/**
 * B58.6 — a payout batch is approved signed (Lens B58.5): once the workspace has a passkey, Face ID asks here over the
 * challenge naming the batch as it stands, and nothing is paid without it. With none, it is approved as before.
 */
export async function approvePayoutSigned(batchID: string): Promise<PayoutBatch> {
  const c = await agentBankApi.payoutChallenge(batchID)
  return agentBankApi.approvePayout(batchID, (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
}

/**
 * B55.56 — the owner's mandate is signed as a payment is (Lens B55.24): once the workspace has a passkey, Face ID asks
 * here over the challenge naming exactly this grant, and nothing is granted without it. With none, it grants as before.
 */
export async function grantMandateSigned(grant: MandateGrant): Promise<Mandate> {
  const c = await agentBankApi.mandateChallenge({ grant })
  return agentBankApi.grantMandate(grant, (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
}

/** B55.56 — an agent's requested mandate is approved signed the same way, over the challenge naming that request. */
export async function approveMandateSigned(mandateID: string): Promise<Mandate> {
  const c = await agentBankApi.mandateChallenge({ mandate_id: mandateID })
  return agentBankApi.approveMandate(mandateID, (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
}

/**
 * B41.8 — stopping is instant, restarting is signed (Lens B41.108): once the workspace has a passkey, Face ID asks
 * here before an agent starts again, over a challenge naming that agent. With none, it starts as before.
 */
export async function resumeAgent(agentID: string): Promise<{ paused: boolean }> {
  const c = await agentBankApi.resumeChallenge(agentID)
  return agentBankApi.resume(agentID, (c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
}

/** B41.8 — every agent started again, signed the same way over the resume-all challenge. */
export async function resumeEveryAgent(): Promise<{ all_paused: boolean }> {
  const c = await agentBankApi.resumeAllChallenge()
  return agentBankApi.resumeAll((c.allow_credentials ?? []).length > 0 ? await assertOver(c) : undefined)
}

/**
 * B59.12 — the workspace's kind of money changed, signed with a passkey over the challenge naming the kind picked. Lens
 * has no unsigned change (B59.46), so Face ID always asks here.
 */
export async function changeMoneyKindSigned(kind: MoneyKind): Promise<WorkspaceAccount> {
  const c = await agentBankApi.moneyKindChallenge(kind)
  return agentBankApi.changeMoneyKind(kind, await assertOver(c))
}

export async function assertOver({ challenge, allow_credentials }: { challenge: string; allow_credentials: string[] | null }): Promise<PasskeyAssertion> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: fromB64u(challenge),
      allowCredentials: (allow_credentials ?? []).map((id) => ({ type: 'public-key' as const, id: fromB64u(id) })),
      userVerification: 'required',
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null
  if (!cred) throw new Error('The approval was not signed.')
  const res = cred.response as AuthenticatorAssertionResponse
  return {
    credential_id: b64u(cred.rawId),
    client_data_json: b64u(res.clientDataJSON),
    authenticator_data: b64u(res.authenticatorData),
    signature: b64u(res.signature),
  }
}

/** Subscribes this device to approval pushes. */
export async function notifyThisDevice(): Promise<void> {
  const reg = await navigator.serviceWorker.register('/sw.js')
  const { public_key } = await agentBankApi.pushPublicKey()
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(public_key) })
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('The browser gave no push subscription.')
  await agentBankApi.subscribePush({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
}
