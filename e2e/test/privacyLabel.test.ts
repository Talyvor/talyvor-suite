import { describe, expect, it } from 'vitest'
import { privacyLabelFaults } from '../src/privacyLabel.ts'

const nothing = { models: ['gpt-4o', 'claude-sonnet-4'], tools: [], keeps: [], keeps_nothing: true }
const shown = 'Calls gpt-4o, claude-sonnet-4 · uses no tools · keeps nothing'

describe('B41.93 market-privacy-label', () => {
  it('passes both models and "keeps nothing" on the page and in Lens, and fails otherwise', () => {
    expect(privacyLabelFaults(nothing, shown)).toEqual([])
    expect(privacyLabelFaults({ models: ['gpt-4o'], tools: [], keeps: ['notes'], keeps_nothing: false }, '')).toEqual([
      'Lens\'s label names the models ["gpt-4o"], not ["gpt-4o","claude-sonnet-4"]',
      'Lens\'s label keeps ["notes"], though no step keeps anything',
      `the listing page's privacy label reads "", not ${JSON.stringify(shown)}`,
    ])
    expect(privacyLabelFaults(undefined, shown)).toEqual(['Lens gave the pipeline\'s latest version no privacy label'])
  })
})
