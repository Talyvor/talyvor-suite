import { describe, expect, it } from 'vitest'
import { externalLinkNote } from '../src/externalLinks.mjs'

// B17.526 — the browser half is selftest/external-links.ts (it needs Chromium); this is the move log's half.
describe('externalLinkNote', () => {
  it('reads a click on a link the guard keeps from the Mac as nothing opening, and leaves web links alone', () => {
    expect(externalLinkNote('mailto:hello@talyvor.com')).toBe('a mail link: nothing opens in the test browser')
    expect(externalLinkNote('tel:+15550100')).toBe('a phone link: nothing opens in the test browser')
    expect(externalLinkNote('facetime:hello@talyvor.com')).toBe('a facetime link: nothing opens in the test browser')
    for (const web of ['https://talyvor.com/help', '/help', '', 'blob:http://localhost/x']) expect(externalLinkNote(web)).toBeUndefined()
  })
})
