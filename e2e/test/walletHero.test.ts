import { describe, expect, it } from 'vitest'
import { walletHeroFaults } from '../src/scenarios.ts'

// /marketing as version 4 draws it (B64.1, design/website-2026-11-17-v4, Nick approved 17 Nov 2026).
const v4 = {
  h1: 'Your AI agent wants your card. Give it its own.',
  sections: [
    'Stop lending your agent your card.',
    'Agent money shouldn’t need a manual.',
    'One minute. The whole app.',
    'Press it. You’ll get it in ten seconds.',
    'Your shopping agent. Your company’s agent army.',
    'Claude does the legwork. You keep the final say.',
    'They built it for engineers. We built it for you.',
    'Start free. Seriously.',
    'Built. Running. Moving fast.',
    'Your move.',
  ],
  text: [
    'Your AI agent wants your card.',
    'Give it its own.',
    'Everyone else made agent money complicated. We made it three steps. Sign up, open an account, give your agent a card. It pays inside your rules and asks you before anything else.',
    'The idea',
    'Stop lending your agent your card.',
    'It gets its own account and its own card. Your rules sit on top, and anything outside them waits for your yes.',
  ].join('\n'),
  footer: 'How it works\nTry it\nPricing\nOpen an account\nPrivacy\nTerms\nTALYVOR LTD · Registered in England and Wales · Company number 00000000',
}

describe('wallet-hero reads version 4 of the front door (B17.478)', () => {
  it('passes the page Nick approved on 17 Nov: an account and a card of its own lead, under the owner’s rules', () => {
    expect(walletHeroFaults(v4)).toEqual([])
  })

  it('names what is missing when the front door leads with something else, and a hidden area’s section', () => {
    expect(
      walletHeroFaults({
        h1: 'Pool your AI spend.',
        sections: ['Repeated questions cost less'],
        text: 'Prices fall toward zero.',
        footer: '',
      }),
    ).toEqual([
      'the hero (h1 reads "Pool your AI spend.")',
      'the hero line: its own account and its own card',
      'the rules line: anything outside them waits for your yes',
      'the idea section heading',
      "a hidden area's section /repeated questions cost less/i",
      'the price-curve claim is still there',
      'the footer line',
    ])
  })
})
