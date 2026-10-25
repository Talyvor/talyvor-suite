// B41.1 — the bills inbox on the Pay screen (/money/pay), once a run, in the browser, on a workspace of its own.
//
// The owner adds a one-page PDF invoice from a supplier the workspace has no saved payee for. The bill must read its supplier,
// invoice number, £123.45, its due date and "New payee" on the screen; the same PDF added again must say it is already in the
// inbox and the screen still lists one bill. Lens's own record must hold exactly one bill for that invoice number, with the
// amount at 12,345 minor in GBP, the due date, the supplier and new_payee. Nothing moves: a bill is not a payment.
// Screenshots at 1440 and 390.

import { randomBytes } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import { softPasskey } from './payees.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
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

// B41.2 — pay all due: the bills ticked on the Pay screen, one card, one passkey approval. Once a run, in the browser, on a
// workspace of its own.
//
// On Lens's API the owner accepts the money terms, opens the company's GBP account, saves three suppliers as payees and registers
// this run's software passkey. In the browser three PDF invoices from those suppliers are added, each reading "Saved payee";
// "Pay 3 bills" opens one approval card reading "3 of 3 payments to approve, total £465.50" with every supplier and invoice number.
// A statement with an amount changed after Lens wrote it, signed, is refused and pays nothing. Then the screen's own two calls,
// signed with the passkey: exactly three payments out post on Lens's ledger, each to its supplier at its bill's amount with its
// invoice number as the reference, the company account down by the total; the same approval again answers 409 and posts nothing;
// the bills read paid, and paying them again prepares only blocked items ("paid already"). Screenshots at 1440 and 390.
// shortcut: until Lens takes test money into a company account (B30.15) the account holds nothing, so after the card the run
// SKIPs rather than approve payments that cannot post; the money half runs the night B30.15 lands.
export function billsPayAllDue(): Scenario {
  return {
    id: 'bills-pay-all-due',
    owner: 'talyvor-suite',
    own: true,
    items: ['B41.2'],
    title: 'three due bills ticked on the Pay screen open one approval card with their count, total and payees; one passkey approval posts ' +
      'three payments with their invoice numbers as references, a changed amount is refused, a replay posts nothing and no bill is paid twice',
    run: async (ctx) => {
      const origin = new URL(ctx.app.page.url()).origin
      const lens = async <T>(method: string, path: string, body: unknown, note: string) => {
        const r = await call<T>(ctx, method, path, body)
        ctx.evidence.push({ note, answer: said(r) })
        return r
      }
      // 1. On Lens's API: the terms, the company's GBP account, three saved suppliers and a passkey.
      const terms = await lens<{ terms: { capability: string; version: number; accepted?: unknown }[] | null }>('GET', '/v1/workspaces/{ws}/terms', undefined, 'the owner reads the terms')
      for (const t of (terms.value?.terms ?? []).filter((x) => ['currency_accounts', 'payments_in', 'payments_out'].includes(x.capability) && x.accepted == null)) {
        const ok = await lens('POST', `/v1/workspaces/{ws}/terms/${t.capability}/accept`, { version: t.version }, `the owner accepts ${t.capability}'s terms`)
        if (ok.status !== 201) return fail(`accepting ${t.capability}'s terms answered ${said(ok)}`)
      }
      const company = await lens<{ id: string }>('POST', '/v1/money/accounts', { currency: 'GBP' }, 'the company GBP account')
      if (company.status !== 201 || company.value === undefined) return fail(`opening the company GBP account answered ${said(company)}`)
      const salt = randomBytes(3).toString('hex')
      const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10)
      const bills = [['Nightly Hosting', 12_000, '120.00'], ['Nightly Studio', 30_550, '305.50'], ['Nightly Rent', 4_000, '40.00']].map(([name, minor, shown], i) => ({
        supplier: `${name} ${salt} Ltd`, minor: minor as number, shown: shown as string, number: `INV-${salt}-${i + 1}`, account: `7${String(Date.now()).slice(-6)}${i}`, payee: '' }))
      const total = bills.reduce((t, b) => t + b.minor, 0)
      for (const b of bills) {
        const p = await lens<{ id: string }>('POST', '/v1/money/payees', { name: b.supplier, country: 'GB', sort_code: '040004', account_number: b.account }, `the owner saves ${b.supplier}`)
        if (p.status !== 201 || p.value === undefined) return fail(`saving ${b.supplier} answered ${said(p)}`)
        b.payee = p.value.id
      }
      const reg = await lens<{ challenge: string; rp_id: string }>('POST', '/v1/workspaces/{ws}/agents/passkeys/challenge', {}, 'the passkey registration challenge')
      if (reg.value === undefined) return fail(`the passkey registration challenge answered ${said(reg)}`)
      const key = softPasskey(reg.value.rp_id)
      const registered = await lens('POST', '/v1/workspaces/{ws}/agents/passkeys', key.register(reg.value.challenge, 'Nightly bills passkey'), 'the passkey')
      if (registered.status !== 201) return fail(`registering a passkey answered ${said(registered)}`)

      interface Payment { id: string; payee_id: string; amount_minor: number; currency: string; reference: string; status: string }
      const money = async (note: string) => {
        const accounts = await call<{ accounts: { id: string; test_minor: number }[] | null }>(ctx, 'GET', '/v1/money/accounts')
        const payments = await call<{ payments: Payment[] | null }>(ctx, 'GET', '/v1/money/payments')
        const m = { held: (accounts.value?.accounts ?? []).find((a) => a.id === company.value?.id)?.test_minor ?? -1, payments: payments.value?.payments ?? [] }
        ctx.evidence.push({ note: `${note}: the company GBP account holds ${m.held} minor of test money; ${m.payments.length} payments out ${JSON.stringify(m.payments.map((p) => [p.reference, p.amount_minor, p.status]))}` })
        return m
      }

      // 2. In the browser: three invoices added, each its saved payee's; "Pay 3 bills" opens one card.
      const page = await ctx.app.tab('/money/pay')
      let request = ''
      try {
        const form = page.getByTestId('bill-upload')
        await form.waitFor({ timeout: TIMEOUT_MS })
        for (const b of bills) {
          const pdf = invoicePDF([b.supplier, 'INVOICE', `Invoice number: ${b.number}`, `Due date: ${due}`, `Total due: GBP ${b.shown}`, 'Sort code: 04-00-04', `Account number: ${b.account}`])
          await form.getByLabel('Invoice file').setInputFiles({ name: `${b.number}.pdf`, mimeType: 'application/pdf', buffer: pdf })
          await form.getByRole('button', { name: 'Add bill' }).click()
          const row = page.locator('[data-testid^="bill-bill"]').filter({ hasText: b.number })
          await row.waitFor({ timeout: TIMEOUT_MS })
          const shown = ((await row.textContent()) ?? '').trim()
          ctx.evidence.push({ note: `the bill on the screen: ${shown.slice(0, 300)}` })
          if (!shown.includes(`Saved payee: ${b.supplier}`)) return fail(`the bill ${b.number} reads "${shown.slice(0, 200)}": it is not matched to the saved payee ${b.supplier}`)
        }
        const panel = page.getByTestId('bills-pay')
        await panel.getByRole('button', { name: 'Pay 3 bills' }).waitFor({ timeout: TIMEOUT_MS })
        const sum = await panel.getByTestId('bills-pay-total').innerText()
        if (sum !== 'Total £465.50') return fail(`with three bills ticked the Pay screen reads "${sum}", not "Total £465.50"`)
        await screenshots(ctx, page, 'bills-pay-ticked')
        await panel.getByRole('button', { name: 'Pay 3 bills' }).click()
        await page.waitForURL(/\/approve\/[^/]+$/, { timeout: TIMEOUT_MS })
        request = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '')
        const card = page.getByTestId('approve-card')
        await card.waitFor({ timeout: TIMEOUT_MS })
        const words = (await card.innerText()).replace(/\s+/g, ' ')
        ctx.evidence.push({ note: `the approval card for request ${request}: "${words.slice(0, 600)}"` })
        const head = await page.getByTestId('approve-total').innerText()
        if (!head.includes('3 of 3 payments to approve, total £465.50')) return fail(`the approval card reads "${head}", not "3 of 3 payments to approve, total £465.50"`)
        for (const b of bills) {
          if (!words.includes(b.supplier) || !words.includes(`Reference: ${b.number}`)) return fail(`the approval card does not show ${b.supplier} with reference ${b.number}: "${words.slice(0, 400)}"`)
        }
        if (!(await card.getByRole('button', { name: 'Approve 3 payments with a passkey' }).isVisible())) return fail('the approval card has no "Approve 3 payments with a passkey" button')
        ctx.evidence.push({ note: `the one approval card, ${await screenshots(ctx, page, 'bills-pay-card')}` })
      } finally {
        await page.close()
      }

      // 3. The money: only once the company account can hold test money (B30.15).
      const before = await money('before the approval')
      if (before.payments.length !== 0) return fail(`preparing the bills paid something: ${before.payments.length} payments out before any approval`)
      if (before.held < total) throw new CannotTest(`the card for request ${request} read 3 bills, £465.50 and every payee, but the company GBP account holds ${before.held} minor ` +
        'of test money and Lens cannot yet take test money into a company account (B30.15), so the payments cannot post')

      const post = (path: string, body: unknown) => ctx.app.page.request.post(`${origin}/api/money/${path}`, { headers: { Origin: origin }, data: body })
      const wrong: string[] = []
      const prepared = await post(`payment-requests/${request}/approval`, { positions: [1, 2, 3] })
      const toSign = await prepared.json() as { statement?: string; challenge?: string }
      ctx.evidence.push({ note: `the statement to sign: ${prepared.status()} ${String(toSign.statement).slice(0, 600)}` })
      const statement = JSON.parse(toSign.statement ?? '{}') as { items?: { reference: string; amount_minor: number }[] }
      if (prepared.status() !== 200 || JSON.stringify((statement.items ?? []).map((it) => it.reference)) !== JSON.stringify(bills.map((b) => b.number))) {
        return fail(`the statement to approve the three bills answered ${prepared.status()} naming ${JSON.stringify(statement.items)}`)
      }
      // A changed amount, signed: refused, and nothing posts.
      const changed = JSON.stringify({ ...statement, items: (statement.items ?? []).map((it, i) => (i === 0 ? { ...it, amount_minor: it.amount_minor + 1 } : it)) })
      const tampered = await post(`payment-requests/${request}/approve`, { statement: changed, assertion: key.assert(toSign.challenge ?? '') })
      const afterTamper = await money('after a changed statement was signed')
      ctx.evidence.push({ note: `approve with the first amount changed: ${tampered.status()} ${(await tampered.text()).slice(0, 300)}` })
      if (tampered.status() !== 400 || afterTamper.payments.length !== 0) wrong.push(`a statement with a changed amount answered ${tampered.status()} and posted ${afterTamper.payments.length} payments, not 400 and 0`)
      const again = await post(`payment-requests/${request}/approval`, { positions: [1, 2, 3] })
      const fresh = await again.json() as { statement?: string; challenge?: string }
      const approval = { statement: fresh.statement, assertion: key.assert(fresh.challenge ?? '') }
      const approved = await post(`payment-requests/${request}/approve`, approval)
      ctx.evidence.push({ note: `approve: ${approved.status()} ${(await approved.text()).slice(0, 800)}` })
      if (approved.status() !== 200) wrong.push(`approving the three bills answered ${approved.status()}`)

      // The ledger: exactly three payments out, each its bill's; the account down by the total.
      const after = await money('after the approval')
      for (const b of bills) {
        const p = after.payments.filter((x) => x.reference === b.number)
        if (p.length !== 1 || p[0].payee_id !== b.payee || p[0].amount_minor !== b.minor || p[0].currency !== 'GBP') {
          wrong.push(`Lens lists ${p.length} payments referenced ${b.number} (${JSON.stringify(p)}), not one of ${b.minor} GBP to ${b.supplier}`)
        }
      }
      if (after.payments.length !== 3) wrong.push(`one approval posted ${after.payments.length} payments out, not 3`)
      if (after.held !== before.held - total) wrong.push(`the company GBP account went from ${before.held} to ${after.held} minor, not down by ${total}`)

      // No bill twice: the approval again, and the same bills again.
      const replay = await post(`payment-requests/${request}/approve`, approval)
      const repay = await ctx.app.page.request.post(`${origin}/api/money/bills/pay`, { headers: { Origin: origin, 'Idempotency-Key': `e2e-repay-${salt}` },
        data: { bill_ids: ((await call<{ bills: { id: string; invoice_number: string }[] | null }>(ctx, 'GET', '/v1/money/bills')).value?.bills ?? []).map((b) => b.id) } })
      const repaid = await repay.json() as { items?: { decision: string; reason: string }[] }
      const last = await money('after the replay and paying the same bills again')
      ctx.evidence.push({ note: `the approval again: ${replay.status()}; the same bills again: ${repay.status()} ${JSON.stringify(repaid).slice(0, 400)}` })
      if (replay.status() !== 409) wrong.push(`the replayed approval answered ${replay.status()}, not 409`)
      if ((repaid.items ?? []).length !== 3 || (repaid.items ?? []).some((it) => it.decision !== 'blocked' || !it.reason.includes('paid already'))) {
        wrong.push(`paying the paid bills again prepared ${JSON.stringify(repaid.items)}, not three items blocked as paid already`)
      }
      if (last.payments.length !== after.payments.length || last.held !== after.held) wrong.push(`a replay or a second try moved money: ${after.payments.length} → ${last.payments.length} payments out`)
      const read = await call<{ bills: { invoice_number: string; status: string }[] | null }>(ctx, 'GET', '/v1/money/bills')
      const unpaid = (read.value?.bills ?? []).filter((b) => bills.some((x) => x.number === b.invoice_number) && b.status !== 'paid')
      if (unpaid.length > 0) wrong.push(`after the approval ${unpaid.length} of the bills still read ${unpaid.map((b) => b.status).join(', ')}, not paid`)
      return wrong.length > 0 ? fail(wrong.join('; '))
        : { pass: true, detail: `request ${request}: one card for 3 bills, £465.50; a changed amount refused; one passkey approval posted 3 payments (${bills.map((b) => b.number).join(', ')}), ` +
          `the company account ${before.held} → ${after.held} minor; the replay 409 and the same bills again blocked as paid already, nothing more posted` }
    },
  }
}
