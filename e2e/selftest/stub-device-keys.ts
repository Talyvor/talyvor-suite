// B40.28 SELF-TEST — the stand-in Lens's device keys (Lens B40.4), as device-key-approval reads and writes them:
// POST /v1/money/devices/challenge, POST and GET /v1/money/devices, POST …/{id}/revoke. A key registers only as platform
// "test" with its signature over "talyvor-device-v1:<challenge>"; an approval's {"device_id", "challenge", "signature"}
// assertion is checked against it as Lens's devicekey.Verify does, and refused once the key is revoked. Its defect:
//   device-revoked-accepted — a revoked device's signature is still accepted

import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto'

interface Device { id: string; platform: string; name: string; person: string; created_at: string; revoked_at?: string; public_key: string }

const signedBy = (spki: string, challenge: string, signature: string) => {
  try {
    return verify('sha256', Buffer.from(`talyvor-device-v1:${challenge}`), createPublicKey({ key: Buffer.from(spki, 'base64url'), format: 'der', type: 'spki' }), Buffer.from(signature, 'base64url'))
  } catch {
    return false
  }
}

export class DeviceKeyDesk {
  private readonly devices = new Map<string, Device[]>()

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly body: <T>(req: IncomingMessage) => Promise<T>
  private readonly broken: (name: string) => boolean

  constructor(json: DeviceKeyDesk['json'], body: DeviceKeyDesk['body'], broken: DeviceKeyDesk['broken']) {
    this.json = json
    this.body = body
    this.broken = broken
  }

  /** Whether workspace `ws` has registered a device key, revoked ones included: its approvals are then signed. */
  any(ws: string): boolean {
    return (this.devices.get(ws) ?? []).length > 0
  }

  /** Lens's refusal of a device assertion on an approval of `ws`, or undefined when its device signed it. */
  refused(ws: string, a: { device_id?: string; challenge?: string; signature?: string }): string | undefined {
    const d = (this.devices.get(ws) ?? []).find((x) => x.id === a.device_id && (x.revoked_at === undefined || this.broken('device-revoked-accepted')))
    if (d === undefined) return 'passkey: invalid assertion: not a device key of this workspace, or it was revoked'
    if (!signedBy(d.public_key, a.challenge ?? '', a.signature ?? '')) return 'passkey: invalid assertion: the device key did not sign the challenge'
    return undefined
  }

  /** The device-key routes, on workspace `ws`'s key: true when `path` was one of them. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    if (!path.startsWith('/v1/money/devices')) return false
    const list = this.devices.get(ws) ?? []
    const out = ({ public_key: _k, ...d }: Device) => d
    if (path === '/v1/money/devices/challenge' && req.method === 'POST') return this.json(res, 200, { challenge: randomBytes(32).toString('base64url') }), true
    if (path === '/v1/money/devices' && req.method === 'GET') return this.json(res, 200, { devices: list.map(out) }), true
    if (path === '/v1/money/devices' && req.method === 'POST') {
      const { platform = '', name = '', public_key = '', challenge = '', signature = '' } = await this.body<Record<string, string>>(req)
      if (platform !== 'test') return this.json(res, 400, { error: 'devicekey: invalid device key: platform must be ios or android' }), true
      if (!signedBy(public_key, challenge, signature)) return this.json(res, 400, { error: 'devicekey: invalid device key: the key did not sign the registration challenge' }), true
      const d: Device = { id: `dk_${randomUUID()}`, platform, name, person: `key:${ws}`, created_at: new Date().toISOString(), public_key }
      this.devices.set(ws, [...list, d])
      return this.json(res, 201, out(d)), true
    }
    const m = /^\/v1\/money\/devices\/([^/]+)\/revoke$/.exec(path)
    if (m === null || req.method !== 'POST') return false
    const d = list.find((x) => x.id === m[1])
    if (d === undefined) return this.json(res, 404, { error: 'economy: no such device key in this workspace' }), true
    d.revoked_at ??= new Date().toISOString()
    return this.json(res, 200, out(d)), true
  }
}
