import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DOOR_SCENARIOS, TEST_PHONES, doorPhones, doorScenarios, isTestPhone, nationalOf, passcodeFor, testPhone, wrongPasscode } from '../src/door.ts'
import { areaOf, inLaunch } from '../src/launch.ts'
import { journeyFor } from '../src/scenarios.ts'

// B61.28 — the testers join and sign in at the door on numbers kept for tests, never a real one.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src')

describe('the test numbers (B61.28)', () => {
  it('every number the door can type is inside the range kept for tests', () => {
    for (let salt = 1; salt <= 20_000; salt++) {
      for (const phone of doorPhones(salt)) expect(isTestPhone(phone), `${phone} (salt ${salt})`).toBe(true)
    }
    for (const n of [0, 999, 1000, -1, 123_456_789]) expect(isTestPhone(testPhone(n)), String(n)).toBe(true)
    expect(testPhone(0)).toBe('+447700900000')
    expect(testPhone(999)).toBe('+447700900999')
    expect(nationalOf(testPhone(7))).toBe('7700900007')
  })

  it('a number outside the range is not a test number', () => {
    for (const phone of ['+447700901000', '+447700899999', '+44770090012', '+4477009001234', '+15555550100', '+447911123456']) {
      expect(isTestPhone(phone), phone).toBe(false)
    }
  })

  it('no phone number written in the testers\' code is outside the range', () => {
    const written = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'))
      .flatMap((f) => [...readFileSync(join(SRC, f), 'utf8').matchAll(/['"`](\+\d{10,15})['"`]/g)].map((m) => `${f}: ${m[1]}`))
    expect(written.filter((w) => !isTestPhone(w.split(': ')[1]))).toEqual([])
    expect(TEST_PHONES.count).toBe(1000)
  })
})

describe('the passcodes the door chooses (B61.28)', () => {
  it('are six digits Lens takes: not one repeated, not a run, not the end of the number', () => {
    const phone = testPhone(123)
    const draws = [111111, 123456, 654321, 900123, 482915]
    const p = passcodeFor(phone, () => draws.shift()!)
    expect(p).toBe('482915')
    for (let i = 0; i < 200; i++) {
      const right = passcodeFor(phone)
      expect(right).toMatch(/^\d{6}$/)
      expect(wrongPasscode(phone, right)).not.toBe(right)
    }
  })
})

describe('the door joins the launch list (B61.28, B61.1)', () => {
  it('plays all six, once a run, in the order they build on each other', () => {
    expect(doorScenarios().map((s) => s.id)).toEqual([...DOOR_SCENARIOS])
    const night = Array.from({ length: 100 }, (_, i) => journeyFor(i, 100, []))
    for (const id of DOOR_SCENARIOS) {
      expect(areaOf(id), id).toBe('sign-in')
      expect(inLaunch(id), id).toBe(true)
      expect(night.filter((list) => list.some((s) => s.id === id)), id).toHaveLength(1)
    }
    const list = night.find((l) => l.some((s) => s.id === 'door-join'))!.map((s) => s.id).filter((id) => id.startsWith('door-'))
    expect(list).toEqual([...DOOR_SCENARIOS])
  })
})
