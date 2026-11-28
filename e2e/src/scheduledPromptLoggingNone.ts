// B17.574 (for B28.265) — a workspace whose request logging is none keeps no answer from its scheduled prompts, and still
// pays for them on the agent's wallet. Once a run, on a workspace of its own: the owner sets Request logging to none, opens
// an agent with 2 LXC on its wallet and schedules a sum on it for now, on Lens's API as Chat's /schedule does. At Lens's next
// tick the prompt is asked as the agent's own call: its run reads answered, with the request it was and what it cost, and no
// answer; the charge is exactly the agent's new statement lines and out of its balance, on the line the run names. Lens's
// logs cutting emails and phone numbers, and lens.env reaching the container as LENS_* names only, are inside the server,
// where no request from outside reaches them.

import type { AgentLine } from './lens.ts'
import { fail } from './bank.ts'
import { worstInputTokens } from './budget.ts'
import { cheapestOf } from './gateway.ts'
import { listPriceUSD } from './oracles.ts'
import { CannotTest, type Scenario } from './scenarios.ts'
import { call, said, setSwitch } from './settings.ts'

const FUNDED_ULXC = 2_000_000
/** Lens's tick runs a due schedule within a minute of its time; a slow model is given two more. */
const RUN_WAIT_MS = 3 * 60_000
const POLL_MS = 2_000
const requestLine = (l: AgentLine) => l.kind === 'hold' || l.kind === 'spend'

export function scheduledPromptLoggingNone(seed: number): Scenario {
  return {
    id: 'scheduled-prompt-logging-none',
    owner: 'talyvor-lens',
    own: true,
    agents: 1,
    feature: 'Agent Wallets',
    items: ['B28.265'],
    title: "with Request logging set to none, a prompt scheduled on an agent is asked and charged on the agent's statement, and Lens keeps no answer from it",
    run: async (ctx) => {
      const { env, app } = ctx
      const { lens } = env
      const user = app.user
      const model = env.catalog.find((m) => m.id === env.judgeModel) ?? cheapestOf(env.catalog, env.judgeProvider)
      if (model === undefined) throw new CannotTest(`the run's catalog lists no ${env.judgeProvider} model to schedule a prompt on: a launch run reads no catalog (B61.49)`)

      const start = (await call<{ logging_policy: string }>(ctx, 'GET', '/v1/workspaces/{ws}')).value?.logging_policy ?? 'full'
      const none = await setSwitch(ctx, '/logging', { logging_policy: 'none' }, (w) => w.logging_policy === 'none')
      if (none !== undefined) return fail(`setting Request logging to none: ${none}`)
      try {
        const agent = await lens.createAgent(user, `Unlogged scheduler ${seed}`)
        await lens.fundAgent(user, agent.id, FUNDED_ULXC)
        const lines0 = await lens.agentLines(user, agent.id)
        if (lines0[0]?.balance_after_ulxc !== FUNDED_ULXC) return fail(`${agent.name} was funded ${FUNDED_ULXC} µLXC; its statement ends at ${lines0[0]?.balance_after_ulxc}`)
        const fresh = (lines: AgentLine[]) => lines.filter((l) => !lines0.some((o) => o.entry_id === l.entry_id && o.kind === l.kind))

        // A sum nobody has asked, scheduled once for now: Lens's next tick asks it.
        const a = 100 + ((seed * 7919 + Date.now()) % 900)
        const b = 100 + ((seed * 104_729 + Date.now()) % 900)
        const prompt = `What is ${a} + ${b}? Reply with the number only.`
        const hold = env.cap.reserve(listPriceUSD(model, worstInputTokens(prompt.length), 4096))
        let charged: number | undefined
        let run: { ran_at: string; outcome: string; answer?: string; detail?: string; request_id?: string; charged_ulxc?: number; entry_id?: string } | undefined
        let kept: string | undefined
        try {
          const made = await call<{ id: string }>(ctx, 'POST', `/v1/workspaces/{ws}/agents/${agent.id}/prompt-schedules`,
            { prompt, provider: model.provider, model: model.id, every: 'once', first_run_at: new Date().toISOString() })
          ctx.evidence.push({ note: `${prompt} scheduled once, now, on ${agent.name}'s wallet with ${model.id}`, answer: said(made) })
          if (made.status !== 201 || made.value === undefined) return fail(`scheduling a prompt on ${agent.name} answered ${said(made)}`)
          const id = made.value.id
          const until = Date.now() + RUN_WAIT_MS
          for (;;) {
            const s = (await lens.promptSchedules(user)).find((x) => x.id === id)
            run = s?.runs?.[0]
            kept = s?.prompt
            if (run !== undefined || Date.now() > until) break
            await new Promise((r) => setTimeout(r, POLL_MS))
          }
          if (run?.outcome === 'answered') charged = -fresh(await lens.agentLines(user, agent.id)).filter((l) => l.kind !== 'platform_fee').reduce((t, l) => t + l.amount_ulxc, 0)
        } finally {
          // A run that failed may still have reached the provider: it is counted at its worst.
          env.cap.settle(hold, charged === undefined ? undefined : (charged / 1e6) * env.usdPerLXC)
          if (charged !== undefined && charged > 0) env.book.add(user.workspaceID, charged)
        }

        const lines1 = await lens.agentLines(user, agent.id)
        const added = fresh(lines1)
        const net = added.reduce((t, l) => t + l.amount_ulxc, 0)
        ctx.evidence.push({ note: `Lens's run: ${JSON.stringify(run)}; ${agent.name}'s new lines: ${added.map((l) => `${l.kind} ${l.amount_ulxc} ${l.entry_id}`).join(', ') || 'none'}` })
        if (run === undefined) return fail(`a prompt scheduled for now on ${agent.name} had not run ${RUN_WAIT_MS / 60_000} minutes later`)
        if (run.outcome !== 'answered') return fail(`the scheduled prompt was not answered: ${run.outcome} — ${run.detail ?? ''}`)
        if ((run.answer ?? '') !== '') {
          return fail(`the workspace's Request logging is none, yet Lens kept the scheduled prompt's answer on its run: "${run.answer?.slice(0, 120)}" — logging none keeps nothing a workspace asked (B28.265)`)
        }
        if (kept !== prompt) return fail(`the schedule's own prompt is the setting the owner saved, and reads back "${kept}", not "${prompt}"`)
        if (!added.some((l) => requestLine(l) && l.entry_id === run?.entry_id) || net >= 0) {
          return fail(`the scheduled prompt was answered, but its charge is not on ${agent.name}'s statement: the run names line ${run.entry_id ?? '(none)'}, the new lines are ${JSON.stringify(added)} — with logging none it is still asked and charged on the agent's wallet`)
        }
        if (run.charged_ulxc !== -net) return fail(`the run says it took ${run.charged_ulxc} µLXC from ${agent.name}; its statement's new lines come to ${-net}`)
        if (lines1[0].balance_after_ulxc !== FUNDED_ULXC + net) {
          return fail(`${agent.name} was funded ${FUNDED_ULXC} and charged ${-net} µLXC for the scheduled prompt; its statement ends at ${lines1[0].balance_after_ulxc}`)
        }
        return {
          pass: true,
          detail: `with Request logging none, "${prompt}" was asked at ${run.ran_at} and charged ${-net} µLXC on ${agent.name}'s statement (${added.map((l) => l.kind).join(', ')}), ` +
            `it holds ${lines1[0].balance_after_ulxc}; its run keeps the request ${run.request_id ?? '(none)'} and no answer`,
        }
      } finally {
        await setSwitch(ctx, '/logging', { logging_policy: start }, (w) => w.logging_policy === start)
      }
    },
  }
}
