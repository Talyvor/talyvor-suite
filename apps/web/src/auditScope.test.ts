import { afterEach, describe, expect, it } from 'vitest'
import { onCommit } from './auditScope'

// B39.2 — the audits scan only what a commit changed. These pin the three rules that make that the
// same record a full walk of the body would have made.

const scans: string[][] = []
const widened: string[][] = []
onCommit((scope) => scans.push(Array.from(scope.querySelectorAll('*'), (el) => el.id).filter(Boolean)))
onCommit((scope) => widened.push(Array.from(scope.querySelectorAll('*'), (el) => el.id).filter(Boolean)), {
  widen: (el) => el.tagName === 'LABEL',
})

const commit = () => new Promise((r) => setTimeout(r, 0))

afterEach(() => {
  document.body.innerHTML = ''
})

describe('the audits’ shared observer', () => {
  it('scans the changed subtree and not its unchanged sibling', async () => {
    document.body.innerHTML = '<section id="a"><p id="a1">one</p></section><section id="b"><p id="b1">two</p></section>'
    await commit()
    expect(scans.at(-1)).toEqual(['a', 'a1', 'b', 'b1'])

    document.getElementById('a1')!.textContent = 'three'
    await commit()
    expect(scans.at(-1)).toEqual(['a1'])
  })

  it('carries a class change that triggers nothing into the next scan, subtree and all', async () => {
    document.body.innerHTML = '<section id="a"><p id="a1">one</p></section><section id="b"><p id="b1">two</p></section>'
    await commit()
    const before = scans.length

    document.getElementById('a')!.className = 'uppercase'
    await commit()
    expect(scans.length).toBe(before) // the old observers did not fire on an attribute alone

    document.getElementById('b1')!.textContent = 'four'
    await commit()
    expect(scans.at(-1)).toEqual(['a', 'a1', 'b1'])
  })

  it('widens a change to the ancestor an audit reads it through, as focusAudit reads a control’s text', async () => {
    document.body.innerHTML = '<div id="d"><label id="lbl"><span id="s">Save</span></label></div>'
    await commit()

    document.getElementById('s')!.textContent = 'Saving'
    await commit()
    expect(widened.at(-1)).toEqual(['lbl', 's'])
    expect(scans.at(-1)).toEqual(['s'])
  })
})
