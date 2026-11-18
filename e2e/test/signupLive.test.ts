import { describe, expect, it } from 'vitest'
import { SIGNUP_CTA, strayCTAs } from '../src/signupLive.ts'

// B64.2 — every "Open your account" on the marketing page goes to /signup on the app's origin.

describe('signup-live', () => {
  const origin = 'https://app.talyvor.com'

  it('names the sign-up buttons by their words', () => {
    expect(SIGNUP_CTA.test('Open your account')).toBe(true)
    expect(SIGNUP_CTA.test('Open an account')).toBe(true)
    expect(SIGNUP_CTA.test('Watch the one-minute how-to')).toBe(false)
  })

  it('passes a button to /signup on the origin and names every other one', () => {
    const ctas = [
      { text: 'Open your account', href: `${origin}/signup` },
      { text: 'Open your account', href: `${origin}/signin` },
      { text: 'Open an account', href: 'https://talyvor.com/signup' },
    ]
    expect(strayCTAs(ctas, origin)).toEqual([
      `"Open your account" goes to ${origin}/signin, not ${origin}/signup`,
      `"Open an account" goes to https://talyvor.com/signup, not ${origin}/signup`,
    ])
    expect(strayCTAs(ctas.slice(0, 1), origin)).toEqual([])
  })
})
