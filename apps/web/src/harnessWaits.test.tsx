import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
import { matchRoutes } from 'react-router-dom'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { App, CONSOLE_ROUTES, queryClient, ROUTE_PATHS } from './App'
import { areaOfPath } from './lib/workspaceAreas'
import { populatedBff } from './populatedBff'

/**
 * B61.63 — THE TESTERS' WAITS, HELD TO THE PAGES THEY WAIT ON. On 14 Nov /agents was redrawn (B57.19) and the testers'
 * harness (e2e/src) kept waiting for the old view's agent-bank-totals and agent-first there: 82 of a launch run's first 198
 * results timed out on that one wait, and nothing in the web's own pull request said so.
 *
 * So this reads the harness the way the testers run it. Wherever it opens a page — `tab('<address>')`, `goto('<address>')`
 * — the first thing it then waits for or presses there (and, for a screen class, what its `ready()` waits for) is what it
 * needs on that page as it lands. Each such address of a launch page (one in no hidden area, `areaOfPath`) must be a page
 * of the app, and the populated fixture's render of it must hold every data-testid and every role and name in at least one
 * of the `.or()` alternatives of that wait. A page redrawn without its testers fails here, in its own pull request.
 *
 * Read from the harness's source, never listed here, so a new wait is held without anyone adding it. Only what a wait
 * names literally is checked: an id built from the run's own data (`agent-balance-${a.id}`) depends on that data.
 */

const E2E_SRC = resolve(import.meta.dirname, '../../../e2e/src')
/** The populated fixture's agent: what an address's `${…}` stands for when it is rendered here. */
const FIXTURE_ID = 'agt_research'

type Probe = { testid: string } | { role: string; name: string }
/** Each alternative is a set of probes that must all be on the page; the wait holds when one alternative does. */
type Alternatives = Probe[][]

export interface Wait {
  at: string
  address: string
  alternatives: Alternatives
}

const INTERACTIONS = new Set(['click', 'dblclick', 'fill', 'selectOption', 'check', 'uncheck', 'press', 'pressSequentially', 'type', 'hover', 'setInputFiles', 'tap'])
const PASS_THROUGH = new Set(['first', 'last', 'nth', 'filter', 'locator', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByTitle', 'getByAltText'])

function stringOf(n: ts.Node | undefined): string | undefined {
  if (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) return n.text
  return undefined
}

/** The address a `tab(…)` or `goto(…)` opens: its first literal that starts with "/", each `${…}` as ":x", the query cut. */
function addressIn(call: ts.CallExpression): string | undefined {
  let found: string | undefined
  const look = (n: ts.Node): void => {
    if (found !== undefined) return
    const s = stringOf(n)
    if (s !== undefined && s.startsWith('/')) found = s
    else if (ts.isTemplateExpression(n) && n.head.text.startsWith('/')) found = n.head.text + n.templateSpans.map((sp) => `:x${sp.literal.text}`).join('')
    else ts.forEachChild(n, look)
  }
  call.arguments.forEach(look)
  return found?.split('?')[0]
}

/** What a locator expression names, read along its chain; `consts` are the function's own `const x = …`. */
function probesOf(e: ts.Expression, consts: Map<string, ts.Expression>, seen = new Set<string>()): Alternatives {
  if (ts.isAwaitExpression(e) || ts.isParenthesizedExpression(e)) return probesOf(e.expression, consts, seen)
  if (ts.isIdentifier(e)) {
    const init = consts.get(e.text)
    if (init === undefined || seen.has(e.text)) return [[]]
    return probesOf(init, consts, new Set([...seen, e.text]))
  }
  if (!ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression)) return [[]]
  const method = e.expression.name.text
  const under = probesOf(e.expression.expression, consts, seen)
  const add = (p: Probe) => under.map((alt) => [...alt, p])
  if (method === 'or' && e.arguments[0]) return [...under, ...probesOf(e.arguments[0], consts, seen)]
  if (method === 'getByTestId') {
    const id = stringOf(e.arguments[0])
    return id === undefined ? under : add({ testid: id })
  }
  if (method === 'getByRole') {
    const role = stringOf(e.arguments[0])
    const opts = e.arguments[1]
    const nameProp = opts && ts.isObjectLiteralExpression(opts)
      ? opts.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'name')
      : undefined
    const name = stringOf(nameProp?.initializer)
    return role === undefined || name === undefined ? under : add({ role, name })
  }
  if (method === 'locator') {
    const id = /^\[data-testid="([^"]+)"\]$/.exec(stringOf(e.arguments[0]) ?? '')?.[1]
    return id === undefined ? under : add({ testid: id })
  }
  if (PASS_THROUGH.has(method)) return under
  return [[]]
}

const named = (alts: Alternatives) => alts.some((alt) => alt.length > 0)

/** Every launch-page wait in one harness file. */
export function waitsIn(file: string, text: string): Wait[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const out: Wait[] = []
  const at = (n: ts.Node) => `${relative(resolve(E2E_SRC, '..'), file)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`

  /** A screen class's ready(): the first thing it waits for, read the same way. */
  const readyOf = (from: ts.Node): Alternatives | undefined => {
    let cls: ts.Node | undefined = from
    while (cls && !ts.isClassDeclaration(cls)) cls = cls.parent
    const ready = cls && ts.isClassDeclaration(cls) ? cls.members.find((m): m is ts.MethodDeclaration => ts.isMethodDeclaration(m) && m.name.getText() === 'ready') : undefined
    if (!ready?.body) return undefined
    let alts: Alternatives | undefined
    walk(ready.body, (_address, a) => (alts ??= a), '')
    return alts
  }

  /** Walks a body in source order: after each navigation, the first wait or press is the landing's. */
  function walk(body: ts.Node, record: (address: string, alts: Alternatives, n: ts.Node) => void, start: string | undefined = undefined): void {
    const consts = new Map<string, ts.Expression>()
    let current = start
    const visit = (n: ts.Node): void => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts.set(n.name.text, n.initializer)
      ts.forEachChild(n, visit)
      if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return
      const method = n.expression.name.text
      if (method === 'tab' || method === 'goto') {
        current = addressIn(n)
        return
      }
      if (current === undefined) return
      if (method === 'ready' && n.arguments.length === 0) {
        const alts = readyOf(n)
        if (alts && named(alts)) record(current, alts, n)
        current = undefined
      } else if (method === 'waitFor' || INTERACTIONS.has(method)) {
        const alts = probesOf(n.expression.expression, consts)
        if (named(alts)) record(current, alts, n)
        current = undefined
      }
    }
    visit(body)
  }

  const top = (n: ts.Node): void => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.body) {
      if (ts.isMethodDeclaration(n) && n.name.getText() === 'ready') return
      walk(n.body, (address, alternatives, node) => out.push({ at: at(node), address, alternatives }))
      return
    }
    ts.forEachChild(n, top)
  }
  top(sf)
  return out
}

function harnessFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? harnessFiles(join(dir, d.name)) : d.name.endsWith('.ts') ? [join(dir, d.name)] : []))
}

const routes = CONSOLE_ROUTES.map((r) => ({ path: r.path }))
const publicRoutes = ROUTE_PATHS.filter((p) => !CONSOLE_ROUTES.some((r) => r.path === p)).map((path) => ({ path }))

/** The launch pages' waits, by address, and every harness address that is no page of the app. */
function launchWaits(): { byAddress: Map<string, Wait[]>; nowhere: Wait[] } {
  const byAddress = new Map<string, Wait[]>()
  const nowhere: Wait[] = []
  for (const file of harnessFiles(E2E_SRC)) {
    for (const w of waitsIn(file, readFileSync(file, 'utf8'))) {
      const address = w.address.replace(/:x/g, FIXTURE_ID)
      if (areaOfPath(address) !== undefined) continue
      if (matchRoutes(routes, address) === null) {
        if (matchRoutes(publicRoutes, address) === null) nowhere.push(w)
        continue
      }
      byAddress.set(address, [...(byAddress.get(address) ?? []), w])
    }
  }
  return { byAddress, nowhere }
}

const shown = (p: Probe): boolean =>
  'testid' in p ? document.querySelector(`[data-testid="${CSS.escape(p.testid)}"]`) !== null : screen.queryAllByRole(p.role as never, { name: p.name }).length > 0
const said = (p: Probe) => ('testid' in p ? `data-testid "${p.testid}"` : `${p.role} "${p.name}"`)

/**
 * The waits a page draws only with data the populated fixture does not hold, by file and what is waited for: the data,
 * and the text that draws it when that is not the id or name itself. The render cannot meet them, so each is held to the
 * web's source instead: that text must still be in apps/web/src. An entry no wait needs any more fails too.
 */
const DRAWN_ONLY_WITH: Record<string, { data: string; drawnBy?: string }> = {
  'src/accountStatements.ts data-testid "account-statement-band"': { data: 'a company account, named by ?wallet= in the address' },
  'src/chatPaymentCard.ts group "Prepared payments"': { data: 'a payment Chat prepared' },
  'src/mandateAsked.ts button "Review"': { data: 'a mandate waiting for its owner' },
  'src/phoneKeyWeb.ts button "Add this device"': { data: 'a phone asking to be added' },
  'src/pocketProblems/keys.ts button "Let it approve"': { data: 'a phone asking to be added' },
  'src/surface.ts button "Switch to Pro"': { data: 'a workspace on a plan below Pro', drawnBy: 'Switch to ${plan.name}' },
}

const WEB_SRC = resolve(import.meta.dirname)
let webText: string | undefined
const inWebSource = (p: Probe, drawnBy?: string): boolean => {
  webText ??= readdirSync(WEB_SRC, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && /\.tsx?$/.test(d.name) && !/\.test\.tsx?$/.test(d.name))
    .map((d) => readFileSync(join(d.parentPath, d.name), 'utf8'))
    .join('\n')
  return webText.includes(drawnBy ?? ('testid' in p ? p.testid : p.name))
}
const keyOf = (w: Wait, p: Probe) => `${w.at.replace(/:\d+$/, '')} ${said(p)}`
const excused = new Set<string>()

/** Each wait the rendered page cannot meet: where it is, and what of each alternative is missing. */
export function unmet(waits: readonly Wait[]): string[] {
  return waits.flatMap((w) => {
    const missing = w.alternatives.filter((alt) => alt.length > 0).map((alt) => alt.filter((p) => !shown(p)))
    if (missing.some((m) => m.length === 0)) return []
    const only = missing.length === 1 && missing[0].length === 1 ? missing[0][0] : undefined
    const known = only && DRAWN_ONLY_WITH[keyOf(w, only)]
    if (only && known && inWebSource(only, known.drawnBy)) {
      excused.add(keyOf(w, only))
      return []
    }
    return [`${w.at} waits at ${w.address} for ${missing.map((m) => m.map(said).join(' and ')).join(', or ')}`]
  })
}

async function renderAt(address: string): Promise<void> {
  populatedBff((impl) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(impl as never)
  })
  window.history.pushState({}, '', address)
  render(<App />)
  await screen.findByRole('navigation', { name: /sections/i })
  await new Promise((r) => setTimeout(r, 120))
}

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
  queryClient.clear()
})

describe('every launch page holds what the testers wait for on it', () => {
  it('reads the screen class waits off the harness (the control: the sweep sees ready())', () => {
    const agents = waitsIn(join(E2E_SRC, 'bank.ts'), readFileSync(join(E2E_SRC, 'bank.ts'), 'utf8')).filter((w) => w.address === '/agents')
    expect(agents.length, 'the sweep found no wait at /agents in bank.ts: it reads nothing, so it cannot fail').toBeGreaterThan(0)
  })

  it('a wait for an id the page does not draw is named (the control: the check can fail)', async () => {
    await renderAt('/agents')
    expect(unmet([{ at: 'control', address: '/agents', alternatives: [[{ testid: 'no-such-testid' }], [{ role: 'button', name: 'No such button' }]] }])).toEqual([
      'control waits at /agents for data-testid "no-such-testid", or button "No such button"',
    ])
  })

  it('every address the harness opens is a page of the app', () => {
    const { nowhere } = launchWaits()
    expect(nowhere.map((w) => `${w.at} opens ${w.address}, which is no page of the app`)).toEqual([])
  })

  it('each launch page, rendered, holds the first thing the harness waits for or presses there', async () => {
    const { byAddress } = launchWaits()
    const missing: string[] = []
    for (const [address, waits] of byAddress) {
      await renderAt(address)
      missing.push(...unmet(waits))
      vi.restoreAllMocks()
      cleanup()
      queryClient.clear()
    }
    expect(missing, `the testers wait for these on launch pages that do not draw them:\n  ${missing.join('\n  ')}`).toEqual([])
    const stale = Object.keys(DRAWN_ONLY_WITH).filter((k) => !excused.has(k))
    expect(stale, 'DRAWN_ONLY_WITH names waits the harness no longer has, or the render now meets: take them out').toEqual([])
  }, 60_000)
})
