// B28.246 — a budget URL names a budget by its UUID, and Lens says so: on a workspace of its own, on its own token, the
// owner's software makes a team budget and reads it back; GET, PATCH and DELETE of /budgets/abc each answer 400 with
// Lens's own sentence and no word of the database's, and leave the budget alone; DELETE of a UUID the workspace has no
// budget under answers 404, not a false 200; the budget deleted answers 404 on a second delete and on a read. The other
// half of B28.246, a database failure on a dashboard read answering "internal server error", cannot be forced from
// outside; cmd/lens/b28246_budget_ids_realpg_test.go and internal/api's writeError test prove it.

import { randomUUID } from 'node:crypto'
import { fail } from './bank.ts'
import { RUN_SALT } from './oracles.ts'
import type { Scenario } from './scenarios.ts'
import { call, ok, said } from './settings.ts'

/** What a Postgres driver says when it is handed an id that is not a UUID: none of it reaches the caller. */
export const DRIVER_WORDS = /pq:|pgx|SQLSTATE|invalid input syntax|uuid:|22P02|sql:/i

interface Budget { id: string; scope_id: string; limit_usd: number }

export function budgetIdsValidated(): Scenario {
  return {
    id: 'budget-ids-validated',
    owner: 'talyvor-lens',
    items: ['B28.246'],
    own: true,
    feature: 'Lens settings',
    title: "a budget URL with an id that is not a UUID answers 400 with Lens's sentence and no database error, deleting a budget the workspace does not have answers 404, and neither touches the budget it has",
    run: async (ctx) => {
      const wrong: string[] = []
      const team = `e2e-ids-${RUN_SALT}-${Date.now().toString(36)}`
      const made = await call<Budget>(ctx, 'POST', '/v1/workspaces/{ws}/budgets', { scope: 'team', scope_id: team, period: 'monthly', limit_usd: 100, enforcement: 'hard_block' })
      ctx.evidence.push({ note: `a budget for team ${team}: ${said(made)}` })
      const id = made.value?.id
      if (made.status !== 201 || id === undefined) return fail(`creating a budget answered ${said(made)}`)
      const readBack = async (when: string) => {
        const r = await call<Budget>(ctx, 'GET', `/v1/workspaces/{ws}/budgets/${id}`)
        if (r.status !== 200 || r.value?.scope_id !== team || r.value.limit_usd !== 100) wrong.push(`${when}, the budget reads back as ${said(r)}`)
      }
      await readBack('made')

      for (const [method, body] of [['GET', undefined], ['PATCH', { limit_usd: 1 }], ['DELETE', undefined]] as const) {
        const r = await call(ctx, method, '/v1/workspaces/{ws}/budgets/abc', body)
        ctx.evidence.push({ note: `${method} /budgets/abc: ${r.status} ${r.text.slice(0, 200)}` })
        if (r.status !== 400) wrong.push(`${method} /budgets/abc answered ${said(r)}, not 400`)
        else if (!/uuid/i.test(r.error)) wrong.push(`${method} /budgets/abc answered 400 "${r.error}", which does not say the id must be a UUID`)
        if (DRIVER_WORDS.test(r.text)) wrong.push(`${method} /budgets/abc shows the database's words: ${r.text.slice(0, 200)}`)
      }
      await readBack('after GET, PATCH and DELETE of /budgets/abc')

      const nobody = randomUUID()
      const missing = await call(ctx, 'DELETE', `/v1/workspaces/{ws}/budgets/${nobody}`)
      ctx.evidence.push({ note: `DELETE of ${nobody}, which the workspace has no budget under: ${said(missing)}` })
      if (missing.status !== 404) wrong.push(`deleting ${nobody}, a budget the workspace does not have, answered ${said(missing)}, not 404`)
      if (DRIVER_WORDS.test(missing.text)) wrong.push(`deleting ${nobody} shows the database's words: ${missing.text.slice(0, 200)}`)
      await readBack(`after DELETE of ${nobody}`)

      const del = await call(ctx, 'DELETE', `/v1/workspaces/{ws}/budgets/${id}`)
      const again = await call(ctx, 'DELETE', `/v1/workspaces/{ws}/budgets/${id}`)
      const gone = await call(ctx, 'GET', `/v1/workspaces/{ws}/budgets/${id}`)
      ctx.evidence.push({ note: `deleted: ${said(del)}; deleted again: ${said(again)}; read back: ${said(gone)}` })
      if (!ok(del.status)) wrong.push(`deleting the budget answered ${said(del)}`)
      if (again.status !== 404) wrong.push(`deleting the budget a second time answered ${said(again)}, not 404`)
      if (gone.status !== 404) wrong.push(`the deleted budget reads back as ${said(gone)}, not 404`)

      return wrong.length === 0
        ? { pass: true, detail: `GET, PATCH and DELETE of /budgets/abc each answered 400 "budget id must be a UUID" with no database words and left team ${team}'s budget as it was; deleting a UUID the workspace has no budget under answered 404; the budget deleted answered 404 to a second delete and to a read` }
        : { pass: false, detail: wrong.join('; ') }
    },
  }
}
