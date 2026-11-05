// B53.12 SELF-TEST — the stand-in Lens's physical card (Lens B53.19), as physical-card reads and writes it, behind the switch
// Lens holds: while STUB_PHYSICAL_CARDS is not "on" (as LENS_PHYSICAL_CARDS off) every route answers 404 and writes nothing.
// On: GET /v1/money/physical-cards; POST it {name_on_card, address} (201 inactive and ordered; 422 for an address without a
// first line, a town or a valid GB postcode, or outside GB); POST …/{id}/activate {last4} (409 before it has shipped, 422 for
// the wrong digits); POST …/{id}/replace {reason} (201 {old, card}: the old card frozen, a new one ordered to the same address);
// and the synthetic POST /v1/synthetic/workspaces/{ws}/money/physical-cards/{id}/delivery {status}. Its defect:
//   card-replace-unfrozen — a card reported lost stays active beside its replacement

import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

interface Address { line1: string; line2: string; city: string; postcode: string; country: string }
interface PhysicalCard { id: string; ws: string; last4: string; state: string; design: string; name_on_card: string; address: Address
  delivery: { status: string; updated_at: string }; pin_url: string; replaces: string; replaced_by: string; created_at: string }

const GB_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i
const now = () => new Date().toISOString()

export class PhysicalCardDesk {
  private readonly cards: PhysicalCard[] = []
  private readonly on = process.env.STUB_PHYSICAL_CARDS === 'on'

  private readonly json: (res: ServerResponse, status: number, body: unknown) => void
  private readonly read: (req: IncomingMessage) => Promise<string>
  private readonly broken: (name: string) => boolean

  constructor(json: PhysicalCardDesk['json'], read: PhysicalCardDesk['read'], broken: PhysicalCardDesk['broken']) {
    this.json = json
    this.read = read
    this.broken = broken
  }

  private shown({ ws: _, ...c }: PhysicalCard) {
    return c
  }

  private order(ws: string, name: string, address: Address, replaces = ''): PhysicalCard {
    const c = { id: `pc_${randomBytes(6).toString('hex')}`, ws, last4: String(1000 + Math.floor(Math.random() * 9000)), state: 'inactive', design: 'standard',
      name_on_card: name, address, delivery: { status: 'ordered', updated_at: now() }, pin_url: '', replaces, replaced_by: '', created_at: now() }
    this.cards.push(c)
    return c
  }

  /** The workspace's own routes; false for a path that is not the physical card's. */
  async route(req: IncomingMessage, res: ServerResponse, ws: string, path: string): Promise<boolean> {
    if (!path.startsWith('/v1/money/physical-cards')) return false
    if (!this.on) return this.json(res, 404, { error: 'page not found' }), true
    const mine = this.cards.filter((c) => c.ws === ws)
    if (path === '/v1/money/physical-cards' && req.method === 'GET') return this.json(res, 200, { cards: mine.map((c) => this.shown(c)) }), true
    const body = JSON.parse((await this.read(req)) || '{}') as { name_on_card?: string; address?: Partial<Address>; last4?: string; reason?: string }
    if (path === '/v1/money/physical-cards' && req.method === 'POST') {
      const a = { line1: '', line2: '', city: '', postcode: '', country: '', ...body.address }
      if (!body.name_on_card?.trim() || !a.line1.trim() || !a.city.trim()) return this.json(res, 422, { error: 'the card needs a name, a first address line and a town' }), true
      if (a.country !== 'GB') return this.json(res, 422, { error: 'the card partner posts cards to GB addresses only' }), true
      if (!GB_POSTCODE.test(a.postcode.trim())) return this.json(res, 422, { error: `${a.postcode} is not a GB postcode` }), true
      return this.json(res, 201, this.shown(this.order(ws, body.name_on_card.trim(), a))), true
    }
    const m = /^\/v1\/money\/physical-cards\/([^/]+)\/(activate|replace)$/.exec(path)
    const c = m === null ? undefined : mine.find((x) => x.id === m[1])
    if (m === null || req.method !== 'POST') return false
    if (c === undefined) return this.json(res, 404, { error: 'no such card' }), true
    if (m[2] === 'activate') {
      if (c.state !== 'inactive') return this.json(res, 409, { error: `the card is ${c.state}` }), true
      if (c.delivery.status === 'ordered') return this.json(res, 409, { error: 'the card has not been posted yet' }), true
      if (body.last4 !== c.last4) return this.json(res, 422, { error: 'those are not the last four digits on this card' }), true
      c.state = 'active'
      return this.json(res, 200, this.shown(c)), true
    }
    if (!['lost', 'stolen', 'damaged'].includes(body.reason ?? '')) return this.json(res, 422, { error: 'reason is lost, stolen or damaged' }), true
    if (c.state !== 'active' && c.state !== 'inactive') return this.json(res, 409, { error: `the card is ${c.state}` }), true
    if (!this.broken('card-replace-unfrozen')) c.state = 'frozen'
    const next = this.order(ws, c.name_on_card, c.address, c.id)
    c.replaced_by = next.id
    return this.json(res, 201, { old: this.shown(c), card: this.shown(next) }), true
  }

  /** The synthetic delivery event, on the synthetic key the caller has already checked. */
  async synthetic(req: IncomingMessage, res: ServerResponse, path: string): Promise<boolean> {
    const m = /^\/v1\/synthetic\/workspaces\/([^/]+)\/money\/physical-cards\/([^/]+)\/delivery$/.exec(path)
    if (m === null || req.method !== 'POST') return false
    if (!this.on) return this.json(res, 404, { error: 'page not found' }), true
    const c = this.cards.find((x) => x.ws === decodeURIComponent(m[1]) && x.id === m[2])
    if (c === undefined) return this.json(res, 404, { error: 'no such card' }), true
    const { status = '' } = JSON.parse((await this.read(req)) || '{}') as { status?: string }
    if (status !== 'shipped' && status !== 'delivered') return this.json(res, 422, { error: 'status is shipped or delivered' }), true
    c.delivery = { status, updated_at: now() }
    return this.json(res, 200, this.shown(c)), true
  }
}
