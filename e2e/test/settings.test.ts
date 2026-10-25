import { describe, expect, it } from 'vitest'
import { answerText } from '../src/gateway.ts'
import { memo, providerKeysRefused, rows } from '../src/settings.ts'

describe('every Lens setting has a tester (B34.7)', () => {
  it('reads a served answer in either API\'s shape, and nothing from a body that is not one', () => {
    expect(answerText('{"content":[{"type":"text","text":"PELI"},{"type":"text","text":"CAN"}]}')).toBe('PELICAN')
    expect(answerText('{"choices":[{"message":{"content":"OTTER"}}]}')).toBe('OTTER')
    expect(answerText('404 page not found')).toBe('')
  })

  it("gives Tare forty same-shaped rows whose values are this run's own", () => {
    const r = JSON.parse(rows('s1')) as Record<string, unknown>[]
    expect(r).toHaveLength(40)
    expect(new Set(r.map((x) => Object.keys(x).join(','))).size).toBe(1)
    expect(r.every((x, i) => x.ref === `s1-${i}`)).toBe(true)
  })

  it('attaches the memo as an HTML document block that decodes to the memo stating its code', () => {
    const m = memo('HERON-7')
    const [doc, text] = m.block as [{ type: string; source: { media_type: string; data: string } }, { type: string }]
    expect(doc.type).toBe('document')
    expect(doc.source.media_type).toBe('text/html')
    expect(Buffer.from(doc.source.data, 'base64').toString()).toBe(m.html)
    expect(m.html).toContain('The access code is HERON-7.')
    expect(text.type).toBe('text')
  })

  it('takes provider keys refused by the plan gate (402, DELETE 404, none listed) as right, as well as routes not mounted (B17.275)', () => {
    const r = (status: number, error = '', text = '') => ({ status, error, text })
    const gate = r(402, 'LENS_PLAN_GATES: the free plan does not include own provider keys — the team plan has them with the BYOK add-on')
    const none = r(404, 'no key stored for that provider')
    expect(providerKeysRefused(gate, none, r(200, '', '[]')).wrong).toBeUndefined()
    expect(providerKeysRefused(r(404), r(404)).wrong).toBeUndefined()
    expect(providerKeysRefused(gate, none, r(200, '', '[{"provider":"openai","last4":"wxyz"}]')).wrong).toContain('GET …/provider-keys')
    expect(providerKeysRefused(r(402, 'insufficient credit'), none, r(200, '', '[]')).wrong).toContain('nor 402 by the plan gate')
    expect(providerKeysRefused(gate, r(500, 'boom'), r(200, '', '[]')).wrong).toBeDefined()
  })
})
