import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sampleBodyFor } from '../../scripts/pocket/sample'
import { App, queryClient } from '../App'
import { settleQueries } from '../populatedBff'
import { haystackOf, wordsCheck, wordsOf } from './pocketCheck'

// B57.1 — the words check pocket-shots runs, on scripts/pocket/fixture/index.html: a small stand-in for the Pocket
// reference holding w-home's words, since the reference itself lives on the Mac and not in CI.

const FIXTURE = readFileSync(join(__dirname, '../../scripts/pocket/fixture/index.html'), 'utf8')

function reference(): Element {
  const doc = new DOMParser().parseFromString(FIXTURE, 'text/html')
  return doc.querySelector('#proto .phold')!
}

function app(html: string): string {
  const el = document.createElement('div')
  el.innerHTML = html
  return haystackOf(el)
}

const ALL_THERE = `
  <h1>Good morning, Nick</h1><p>2 things are waiting for you.</p><h2>Waiting for you</h2><span>2 waiting</span>
  <button>Pause every agent</button><button aria-label="Nick: settings and sign out">N</button>
  <p>Research wants to pay Acme Hosting <b>$340.00</b></p><button>Review</button><h2>Your agents</h2><span>In your workspace</span>`

afterEach(() => {
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('the words check', () => {
  it('reads the reference screen’s headings, buttons, chips and labels, and nothing hidden', () => {
    expect(wordsOf(reference())).toEqual([
      { kind: 'heading', text: 'Good morning, Nick' },
      { kind: 'heading', text: 'Waiting for you' },
      { kind: 'heading', text: 'Your agents' },
      { kind: 'button', text: 'Pause every agent' },
      { kind: 'button', text: 'Nick: settings and sign out' },
      { kind: 'button', text: 'Review' },
      { kind: 'chip', text: '2 waiting' },
      { kind: 'label', text: 'In your workspace' },
    ])
  })

  it('passes when every word is on the app, money compared dollars first', () => {
    const words = [...wordsOf(reference()), { kind: 'chip' as const, text: '$340.00 (3,400 LXC)' }]
    expect(wordsCheck('w-home', words, app(ALL_THERE))).toEqual([])
  })

  it('fails on a planted missing heading, and says which', () => {
    expect(wordsCheck('w-home', wordsOf(reference()), app(ALL_THERE.replace('<h1>Good morning, Nick</h1>', '')))).toEqual(['heading “Good morning, Nick”'])
  })

  it('expects a B55 or B56 item’s words where overrides.json replaces the prototype’s', () => {
    const overrides = [{ screen: 'w-home', prototype: 'Review', words: 'Review and decide', item: 'B55.99' }]
    expect(wordsCheck('w-home+sheet-A', wordsOf(reference()), app(ALL_THERE), overrides)).toEqual(['button “Review and decide” (B55.99)'])
    expect(wordsCheck('w-home', wordsOf(reference()), app(ALL_THERE.replace('Review', 'Review and decide')), overrides)).toEqual([])
  })

  it('fails on today’s Home, served the Pocket sample', async () => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const body = sampleBodyFor(String(input))
      return new Response(JSON.stringify(body ?? null), { status: body === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } })
    })
    window.history.pushState({}, '', '/')
    render(createElement(App))
    await settleQueries(queryClient, waitFor)
    await waitFor(() => expect(document.body.textContent).toContain('Research'))
    expect(wordsCheck('w-home', wordsOf(reference()), haystackOf(document.body))).toContain('heading “Good morning, Nick”')
  })
})
