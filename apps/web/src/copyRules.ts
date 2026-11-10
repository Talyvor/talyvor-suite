import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

import ts from 'typescript'

/**
 * B56.25 — THE COPY RULES, ASKED OF EVERY STRING THE WEB APP SHIPS.
 *
 * Nick, 8 Nov 2026: plain words, no em or en dashes, none of the disclaimer phrases, and MIXT never on Talyvor
 * material. publicCopy.test.tsx holds the rendered public pages and signed-in addresses to the words; this holds
 * the source, so a string on a dialog, a toast or an error that no test renders is held too.
 *
 * What is read: every module main.tsx reaches through a relative import (so a test, a fixture or an audit module
 * is never in scope, and a new screen is in scope the day it is imported), plus index.html. In each, JSX text,
 * every string literal and every piece of a template literal: a prop (label, title, aria-label, placeholder,
 * alt), a toast, an error and a constant rendered later are all string literals. Comments are not read by a
 * person and are not checked; nor are import paths.
 *
 * An empty value reads in words ("None", "Not yet", "No date"), never a lone dash, and the dash rule refuses one.
 */

export const DASH = /[–—]/

// B56.9's FORBIDDEN (publicCopy.test.tsx) plus "test credits". "100% of" is held in the signed-in form: a budget
// alert at 100% of a limit is plain words, and only a seller's or a sale's share is refused.
export const FORBIDDEN: [string, RegExp][] = [
  ['MIXT', /\bmixt\b/i],
  ['mixtet', /mixtet/i],
  ['Moldovagaz', /moldovagaz/i],
  ['banking', /banking/i],
  ['agent bank', /agent bank/i],
  ['closed trial', /closed trial/i],
  ['test money', /test money/i],
  ['test credits', /test credits/i],
  ['US first', /\bUS first\b/i],
  ['then the UK and the EU', /then the UK and the EU/i],
  ['licensed partner', /licensed partners?/i],
  ['illustration', /illustration/i],
  ['Coming soon', /coming soon/i],
  ['Nicolai Gaborac', /nicolai gaborac/i],
  ['first $1M', /first \$1 ?m(illion)?\b/i],
  ['100% of', /100% of[^.]*\b(sellers?|sales?|first)\b/i],
]

export type CopyHit = { line: number; rule: string; text: string }

function broken(text: string): string | null {
  if (DASH.test(text)) return 'dash'
  for (const [word, re] of FORBIDDEN) if (re.test(text)) return word
  return null
}

function kindOf(fileName: string): ts.ScriptKind {
  if (fileName.endsWith('.tsx')) return ts.ScriptKind.TSX
  if (fileName.endsWith('.json')) return ts.ScriptKind.JSON
  return ts.ScriptKind.TS
}

/** Every string a person can read in one module that breaks a copy rule, with its line. */
export function copyHits(source: string, fileName: string): CopyHit[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kindOf(fileName))
  const hits: CopyHit[] = []
  const visit = (node: ts.Node) => {
    let text: string | undefined
    if (ts.isJsxText(node)) text = node.text
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent
      const path = p && (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p))
      if (!path) text = node.text
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text
    const rule = text === undefined ? null : broken(text)
    if (rule)
      hits.push({ line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, rule, text: text!.trim() })
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

/** index.html's words: everything outside comments, tags' attribute values included. */
export function htmlHits(source: string): CopyHit[] {
  const hits: CopyHit[] = []
  source
    .replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' '))
    .split('\n')
    .forEach((text, i) => {
      const rule = broken(text)
      if (rule) hits.push({ line: i + 1, rule, text: text.trim() })
    })
  return hits
}

function resolveImport(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec)
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`])
    if (existsSync(c) && statSync(c).isFile()) return c
  return undefined
}

/** Every module the app's entry reaches through a relative import, as paths relative to `src`. */
export function shippedModules(src: string, entry = 'main.tsx'): string[] {
  const seen = new Set<string>()
  const queue = [resolve(src, entry)]
  while (queue.length) {
    const path = queue.pop()!
    if (seen.has(path)) continue
    seen.add(path)
    if (path.endsWith('.json')) continue
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, kindOf(path))
    const follow = (spec: ts.Node | undefined) => {
      if (spec && ts.isStringLiteral(spec) && spec.text.startsWith('.')) {
        const next = resolveImport(path, spec.text)
        if (next) queue.push(next)
      }
    }
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) follow(node.moduleSpecifier)
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) follow(node.arguments[0])
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return [...seen].map((p) => relative(src, p)).sort()
}
