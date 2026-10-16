// ONE MutationObserver for every DOM audit, and each audit scans only what changed (B39.2).
//
// Each audit used to own an observer that walked ALL of document.body on every commit: eight full
// walks per commit, about half the CPU of an Agent Wallets test, which is what pushed those tests
// past vitest's 5 s on a busy runner. An audit's verdict on an element depends only on the element's
// own attributes and text, its ancestors' attributes (inherited face, casing, plane) and, for
// focusAudit, the text of its descendants. So between two scans the only elements whose verdict can
// change are: the subtree of an element whose attributes changed, the subtree of a node whose
// children changed, the parent of a text node that changed, and — through `widen` — a focusable
// ancestor of any of those. Scanning exactly that set records what the full walk recorded.
//
// Trigger rules are unchanged: an audit scans when a commit adds, removes or edits text, or touches
// one of the attributes it names. Attribute changes that do not trigger it are carried into its next
// scan, as the full walk would have seen them then.

type Scan = (scope: ParentNode) => void

interface Registration {
  scan: Scan
  attributes: readonly string[]
  widen?: (el: Element) => boolean
  pending: Set<Element>
}

const registrations: Registration[] = []

/** Run `scan` at commit time over the part of the body that changed. */
export function onCommit(scan: Scan, opts: { attributes?: readonly string[]; widen?: (el: Element) => boolean } = {}): void {
  if (registrations.length === 0) {
    new MutationObserver(flush).observe(document, { subtree: true, childList: true, characterData: true, attributes: true })
  }
  registrations.push({ scan, attributes: opts.attributes ?? [], widen: opts.widen, pending: new Set() })
}

function flush(records: MutationRecord[]): void {
  const changed: Element[] = []
  for (const r of records) {
    const el = r.type === 'characterData' ? r.target.parentElement : r.target
    changed.push(el instanceof Element ? el : document.body)
  }
  for (const reg of registrations) {
    for (const el of changed) reg.pending.add(el)
    const triggered = records.some((r) => r.type !== 'attributes' || reg.attributes.includes(r.attributeName ?? ''))
    if (!triggered) continue
    const roots = rootsOf(reg.pending, reg.widen)
    reg.pending = new Set()
    if (roots.length > 0) reg.scan(scopeOver(roots))
  }
}

/** The changed elements still in the body, widened, with any inside another dropped. */
function rootsOf(pending: Set<Element>, widen?: (el: Element) => boolean): Element[] {
  const body = document.body
  const wide = new Set<Element>()
  for (let el of pending) {
    if (!body.contains(el)) {
      // A change at <html> or <body> itself reaches everything under the body; one in <head> or in
      // a detached tree reaches nothing the audits read.
      if (el.contains(body)) wide.add(body)
      continue
    }
    if (widen) for (let a = el.parentElement; a && a !== body; a = a.parentElement) if (widen(a)) el = a
    wide.add(el)
  }
  return [...wide].filter((el) => {
    for (let a = el.parentElement; a; a = a.parentElement) if (wide.has(a)) return false
    return true
  })
}

/** A ParentNode whose querySelectorAll answers for the roots and everything under them. */
function scopeOver(roots: Element[]): ParentNode {
  const body = document.body
  return {
    querySelectorAll: (sel: string) =>
      roots.flatMap((r) => [...(r !== body && r.matches(sel) ? [r] : []), ...Array.from(r.querySelectorAll(sel))]),
  } as unknown as ParentNode // shortcut: the audits only ever call querySelectorAll on their scope
}
