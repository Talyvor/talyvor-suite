// B41.1 — the bills inbox on the Pay screen (/money/pay), once a run, in the browser, on a workspace of its own.
//
// The owner adds a one-page PDF invoice from a supplier the workspace has no saved payee for. The bill must read its supplier,
// invoice number, £123.45, its due date and "New payee" on the screen; the same PDF added again must say it is already in the
// inbox and the screen still lists one bill. Lens's own record must hold exactly one bill for that invoice number, with the
// amount at 12,345 minor in GBP, the due date, the supplier and new_payee. Nothing moves: a bill is not a payment.
// Screenshots at 1440 and 390.

import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, said } from './settings.ts'
import { screenshots } from './termsScreen.ts'

const TIMEOUT_MS = 30_000
const AMOUNT_MINOR = 12_345

interface Bill { id: string; supplier: string; invoice_number: string; amount_minor: number; currency: string; due_date?: string; payee_match: string; status: string }

/** A one-page PDF with a text layer, one line per entry — an invoice as a supplier's software prints it. */
export function invoicePDF(lines: string[]): Buffer {
  const content = lines.map((l, i) => `BT /F1 12 Tf 72 ${740 - 18 * i} Td (${l.replace(/[\\()]/g, (c) => `\\${c}`)}) Tj ET\n`).join('')
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets = objs.map((o, i) => {
    const at = out.length
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
    return at
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

export function billsInbox(): Scenario {
  return {
    id: 'bills-inbox',
    owner: 'talyvor-suite',
    own: true,
    items: ['B41.1'],
    title: 'the Pay screen’s bills inbox reads an uploaded PDF invoice into one bill with its supplier, invoice number, £123.45 and due date, ' +
      'flagged New payee, and the same invoice added again stays one bill on the screen and in Lens’s record',
    run: async (ctx) => {
      const supplier = `Nightly Supplies ${RUN_SALT} Ltd`
      const number = `INV-${RUN_SALT}`
      const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
      const pdf = invoicePDF([supplier, 'INVOICE', `Invoice number: ${number}`, `Due date: ${due}`, 'Total due: GBP 123.45', 'Sort code: 04-00-04', 'Account number: 12345678'])
      const page = await ctx.app.tab('/money/pay')
      try {
        const form = page.getByTestId('bill-upload')
        await form.waitFor({ timeout: TIMEOUT_MS })
        const add = async (note: string, want: string) => {
          await form.getByLabel('Invoice file').setInputFiles({ name: `${number}.pdf`, mimeType: 'application/pdf', buffer: pdf })
          await form.getByRole('button', { name: 'Add bill' }).click()
          await form.getByRole('status').filter({ hasText: want }).or(form.getByRole('alert')).first().waitFor({ timeout: TIMEOUT_MS }).catch(() => undefined)
          const text = (await form.locator('[role="status"], [role="alert"]').allTextContents()).join(' ').trim()
          ctx.evidence.push({ note: `${note}: the screen says "${text}"` })
          return text
        }
        const first = await add('the owner adds the PDF invoice', `Added: ${supplier}`)
        if (first !== `Added: ${supplier}`) return fail(`adding the PDF invoice on the screen said "${first}", not "Added: ${supplier}"`)
        const row = page.locator('[data-testid^="bill-bill"]').filter({ hasText: number })
        await row.waitFor({ timeout: TIMEOUT_MS })
        const shown = ((await row.textContent()) ?? '').trim()
        ctx.evidence.push({ note: `the bill on the screen: ${shown.slice(0, 300)}` })
        for (const text of [supplier, number, '£123.45', `Due ${due}`, 'New payee']) {
          if (!shown.includes(text)) return fail(`the bill on the screen reads "${shown.slice(0, 200)}": it does not show ${text}`)
        }
        const second = await add('the owner adds the same PDF again', `Already in your inbox: ${supplier}`)
        if (second !== `Already in your inbox: ${supplier}`) return fail(`adding the same invoice again said "${second}", not "Already in your inbox: ${supplier}"`)
        await page.waitForTimeout(1_000)
        const rows = await page.locator('[data-testid^="bill-bill"]').filter({ hasText: number }).count()
        if (rows !== 1) return fail(`after the same invoice was added twice the screen lists ${rows} bills for ${number}, not 1`)
        ctx.evidence.push({ note: `the Pay screen’s bills inbox, ${await screenshots(ctx, page, 'bills-inbox')}` })
      } finally {
        await page.close()
      }

      const listed = await call<{ bills: Bill[] | null }>(ctx, 'GET', '/v1/money/bills')
      ctx.evidence.push({ note: 'Lens’s record of the workspace’s bills', answer: said(listed) })
      if (listed.status !== 200 || listed.value === undefined) return fail(`GET /v1/money/bills answered ${said(listed)}`)
      const bills = (listed.value.bills ?? []).filter((b) => b.invoice_number === number)
      if (bills.length !== 1) return fail(`Lens holds ${bills.length} bills for invoice ${number}, not 1`)
      const b = bills[0]
      if (b.supplier !== supplier || b.amount_minor !== AMOUNT_MINOR || b.currency !== 'GBP' || b.due_date !== due || b.payee_match !== 'new_payee' || b.status !== 'due') {
        return fail(`Lens records the bill as ${b.supplier}, ${b.amount_minor} ${b.currency}, due ${b.due_date}, ${b.payee_match}, ${b.status}: not ${supplier}, ` +
          `${AMOUNT_MINOR} GBP, due ${due}, new_payee, due`)
      }
      return { pass: true, detail: `${number} from ${supplier} read into bill ${b.id} at ${AMOUNT_MINOR} GBP minor, due ${due}, new_payee; added twice, one bill on the screen and in Lens` }
    },
  }
}
