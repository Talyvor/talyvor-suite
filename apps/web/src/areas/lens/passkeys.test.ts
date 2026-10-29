import { afterEach, describe, expect, it, vi } from 'vitest'
import { b64u, registerThisDevice } from './passkeys'

// B50.22 — once the workspace has a passkey, a new one registers only signed by one it already has (Lens B50.20): the
// page asks the existing key to sign the new key's own challenge, then makes the new key, and sends both.

const buf = (n: number) => new Uint8Array([n]).buffer

function mock(credentialIDs: string[]) {
  const sent: Record<string, unknown>[] = []
  const order: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } })
    if (String(input) === '/api/agents/passkeys/challenge') return json({ challenge: 'Q0hBTA', rp_id: 'app.talyvor.com', credential_ids: credentialIDs })
    sent.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return json({ credential_id: 'new', name: 'Laptop', created_at: '2026-10-29T07:00:00Z' }, 201)
  })
  const get = vi.fn(async (o: CredentialRequestOptions) => {
    order.push('get')
    expect(o.publicKey?.allowCredentials?.map((c) => b64u(c.id as Uint8Array))).toEqual(credentialIDs)
    expect(b64u(o.publicKey?.challenge as Uint8Array)).toBe('Q0hBTA')
    return { rawId: buf(7), response: { clientDataJSON: buf(8), authenticatorData: buf(9), signature: buf(10) } }
  })
  const create = vi.fn(async () => {
    order.push('create')
    return {
      rawId: buf(1),
      response: { clientDataJSON: buf(2), getAuthenticatorData: () => buf(3), getPublicKey: () => buf(4), getPublicKeyAlgorithm: () => -7 },
    }
  })
  Object.defineProperty(navigator, 'credentials', { configurable: true, value: { get, create } })
  return { sent, order }
}

afterEach(() => vi.restoreAllMocks())

describe('registerThisDevice', () => {
  it('a second passkey is signed by the first over its own challenge before it is made, and sent with that signature', async () => {
    const { sent, order } = mock([b64u(buf(7))])
    await registerThisDevice('Laptop')
    expect(order).toEqual(['get', 'create'])
    expect(sent).toHaveLength(1)
    expect(sent[0].assertion).toEqual({ credential_id: b64u(buf(7)), client_data_json: b64u(buf(8)), authenticator_data: b64u(buf(9)), signature: b64u(buf(10)) })
  })

  it('the first passkey registers with no signature and asks for none', async () => {
    const { sent, order } = mock([])
    await registerThisDevice('Laptop')
    expect(order).toEqual(['create'])
    expect(sent[0]).not.toHaveProperty('assertion')
  })
})
