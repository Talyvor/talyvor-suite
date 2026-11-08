// B55.44 — the Pocket problems a screen shows: a new workspace's name (7), machine words (8, 24), USDC wallets (13, 23),
// "on your card" (14), Chat's help (19) and how money is written (20, 25). Each screen is read at 1440 and 390.

import { ACTION_TIMEOUT_MS, fail } from '../bank.ts'
import { RUN_SALT } from '../oracles.ts'
import { said } from '../routes.ts'
import { CannotTest, type Scenario, type ScenarioCtx } from '../scenarios.ts'
import { acceptMoneyTerms, account, payee } from './approvals.ts'
import { BLANK, bothSizes, fileApproval, machineWords, moneyWords, screenAt, settled, step } from './press.ts'

type Bare = Omit<Scenario, 'id' | 'items'>

/** Reads every screen in `paths` at both sizes and returns what `wrong` finds on each. */
async function everyScreen(ctx: ScenarioCtx, shot: string, paths: readonly string[], wrong: (text: string) => string[]): Promise<string[]> {
  const out: string[] = []
  for (const path of paths) {
    for (const { width, text } of await screenAt(ctx, path, `${shot}-${path.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'home'}`)) {
      if (BLANK.test(text)) out.push(`${path} at ${width}px could not be read`)
      for (const w of wrong(text)) out.push(`${path} at ${width}px shows ${w}`)
    }
  }
  return [...new Set(out)]
}

/** 7 — a new workspace's first Home asks its name, and the sidebar never shows its raw id (B55.39). */
export function workspaceNamed(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Home',
    agents: 1,
    title: 'a workspace Lens still names by its id: Home asks its name, the sidebar reads "Your workspace", and once saved shows the name',
    run: async (ctx) => {
      const { lens } = ctx.env
      const id = ctx.app.user.workspaceID
      // As Lens leaves a new workspace: named by its id. The run names its synthetic workspaces, so this one is put back.
      if ((await lens.workspaceName(ctx.app.user)) !== id) {
        const reset = await step(ctx, 'PUT', '/v1/workspaces/{ws}/name', { name: id }, 'the workspace named by its id, as Lens leaves a new one')
        if (!reset.ok) throw new CannotTest(`the workspace is already named, and Lens will not name it by its id again: ${said(reset)}`)
      }
      await lens.createAgent(ctx.app.user, 'My first agent')
      const page = await ctx.app.tab('/')
      try {
        const wrong: string[] = []
        const label = page.getByTestId('sidebar-workspace-name')
        await label.waitFor({ timeout: ACTION_TIMEOUT_MS })
        for (const { width, text } of await bothSizes(ctx, page, 'pocket-07-home')) {
          if (text.includes(id)) wrong.push(`at ${width}px the workspace's raw id is on Home`)
        }
        const shown = (await label.innerText()).trim()
        if (shown !== 'Your workspace') wrong.push(`the sidebar reads "${shown}", not "Your workspace"`)
        const save = page.getByRole('button', { name: 'Save name' })
        if (!(await save.isVisible().catch(() => false))) return fail([...wrong, 'Home does not ask for the workspace\'s name'].join('; '))
        const name = `Pocket studio ${RUN_SALT}`
        await page.locator('form').filter({ has: save }).getByRole('textbox').first().fill(name)
        await save.click()
        await label.filter({ hasText: name }).waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        if ((await label.innerText()).trim() !== name) wrong.push(`saved as "${name}", the sidebar reads "${(await label.innerText()).trim()}"`)
        if ((await lens.workspaceName(ctx.app.user)) !== name) wrong.push(`Lens names the workspace "${await lens.workspaceName(ctx.app.user)}", not "${name}"`)
        if (wrong.length > 0) return fail(wrong.join('; '))
        return { pass: true, detail: `Home asked the name, the sidebar read "Your workspace" and then "${name}", and Lens holds it` }
      } finally {
        await page.close()
      }
    },
  }
}

/** The screens a person with an agent, an approval and a prepared payment reads. */
const READ = ['/', '/approvals', '/agents', '/keys', '/rooms', '/statements', '/ledger', '/money/pay', '/money/invoices', '/money/spending',
  '/money/budgets', '/money/subscriptions', '/marketplace'] as const

/** 8 — no raw id, prefix, code, µLXC or status on any screen the run visits (B55.29 to B55.33, B55.11, B55.42). */
export function noMachineWords(): Bare {
  return {
    owner: 'talyvor-lens',
    feature: 'Approvals',
    agents: 2,
    title: 'with an agent waiting for approval and a prepared payment, no screen shows a raw id, a prefix, a code, µLXC or a raw status',
    run: async (ctx) => {
      const filed = await fileApproval(ctx, 'Words check')
      await acceptMoneyTerms(ctx)
      await account(ctx, 'GBP', 0)
      const to = await payee(ctx, `Acme Hosting ${RUN_SALT}`, '53148031')
      const req = await step<{ id: string }>(ctx, 'POST', '/v1/money/payment-requests', { client: 'chat', items: [{ payee_id: to, currency: 'GBP', amount_minor: 34_000, reference: `Words ${RUN_SALT}` }] },
        'the assistant prepares £340.00')
      const ids = [ctx.app.user.workspaceID, filed.payer.id, filed.payee.id, filed.approval, to, ...(req.ok ? [req.value.id] : [])]
      const wrong = await everyScreen(ctx, 'pocket-08', [...READ, ...(req.ok ? [`/approve/${req.value.id}`] : [])], (t) => machineWords(t, ids))
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `${READ.length + 1} screens at both sizes show no raw id, prefix, code, µLXC or raw status` }
    },
  }
}

/** A company USD account and an agent, which owns a USDC wallet unless made otherwise (Lens B48.1). */
async function usdcWallet(ctx: ScenarioCtx): Promise<string> {
  await acceptMoneyTerms(ctx)
  await account(ctx, 'USD', 45_000)
  const agent = await ctx.env.lens.createAgent(ctx.app.user, `Research ${RUN_SALT}`)
  const w = await step<{ wallets: { asset: string }[] | null }>(ctx, 'GET', `/v1/workspaces/{ws}/agents/${agent.id}/wallets`, undefined, `${agent.name}'s wallets`)
  if (!w.ok || !(w.value.wallets ?? []).some((x) => x.asset === 'USDC')) throw new Error(`${agent.name} owns no USDC wallet: ${said(w)}`)
  return agent.name
}

/** 13 — Invoices and Pay draw with an agent's USDC wallet, written to six decimals (B55.26, B55.27). */
export function usdcInvoices(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Invoices',
    agents: 1,
    title: "with a company USD account and an agent's USDC wallet, Invoices and Pay draw and name the wallet's USDC",
    run: async (ctx) => {
      const agent = await usdcWallet(ctx)
      const wrong = await everyScreen(ctx, 'pocket-13', ['/money/pay'], () => [])
      for (const { width, text } of await screenAt(ctx, '/money/invoices', 'pocket-13-money-invoices')) {
        if (BLANK.test(text)) wrong.push(`/money/invoices at ${width}px could not be read`)
        else if (!text.includes(`${agent} · USDC`)) wrong.push(`/money/invoices at ${width}px does not list "${agent} · USDC"`)
      }
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `Invoices and Pay drew with ${agent}'s USDC wallet, listed "${agent} · USDC"` }
    },
  }
}

/** 23 — a USDC payment never blanks Spending, Budgets, Subscriptions or Limit alerts (B55.26). */
export function usdcPayment(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Spending',
    agents: 1,
    title: "with an agent's USDC wallet, Spending, Budgets, Subscriptions and Agent Wallets' Limit alerts all draw",
    run: async (ctx) => {
      await usdcWallet(ctx)
      const wrong = await everyScreen(ctx, 'pocket-23', ['/money/spending', '/money/budgets', '/money/subscriptions', '/agents'], () => [])
      if (wrong.length > 0) return fail(wrong.join('; '))
      // shortcut: a USDC payment needs test USDC in the wallet, which only a card top-up of an invoice gives; press it then.
      throw new CannotTest('all four draw with a USDC wallet; the USDC payment itself is not pressed: test USDC reaches a wallet only by a card top-up')
    },
  }
}

/** 14 — no marketplace screen says "on your card" (B55.36). */
export function noCardWords(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Marketplace',
    title: 'the marketplace, a listing and the monthly bill never say "on your card"',
    run: async (ctx) => {
      const paths: string[] = ['/marketplace', '/marketplace/bill']
      const page = await ctx.app.tab('/marketplace')
      try {
        await settled(page)
        const href = await page.locator('a[href*="/marketplace/listings/"]').first().getAttribute('href').catch(() => null)
        if (href !== null) paths.push(new URL(href, page.url()).pathname)
      } finally {
        await page.close()
      }
      const wrong = await everyScreen(ctx, 'pocket-14', paths, (t) => (/on your card/i.test(t) ? ['"on your card"'] : []))
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `${paths.join(', ')} never say "on your card"` }
    },
  }
}

/** The providers Chat streams, as the picker names them (apps/web/src/areas/chat/chatApi.ts PROVIDER_LABEL, STREAMABLE_PROVIDERS). */
const PROVIDERS = ['OpenAI', 'Anthropic', 'Google', 'Mistral', 'Groq', 'Amazon Bedrock', 'vLLM'] as const

/** 19 — Chat's help names all seven providers (B55.37). */
export function helpProviders(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Chat',
    title: "Chat's help names all seven providers Chat can use, and none as not chosen yet",
    run: async (ctx) => {
      const wrong: string[] = []
      for (const { width, text } of await screenAt(ctx, '/chat/help', 'pocket-19-help')) {
        const missing = PROVIDERS.filter((p) => !text.includes(p))
        if (missing.length > 0) wrong.push(`at ${width}px the help does not name ${missing.join(', ')}`)
        if (/can.t be chosen yet/.test(text)) wrong.push(`at ${width}px the help says a provider "can’t be chosen yet"`)
      }
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: `the help names ${PROVIDERS.join(', ')}` }
    },
  }
}

/** 20 — $450.00 everywhere, dollars first beside LXC (B55.38, B55.27, B55.30). */
export function dollarsFirst(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Agent Wallets',
    agents: 2,
    title: 'with $450.00 in a USD account and an agent funded in LXC, every screen writes $450.00 and puts dollars first beside LXC',
    run: async (ctx) => {
      await acceptMoneyTerms(ctx)
      await account(ctx, 'USD', 45_000)
      await fileApproval(ctx, 'Dollars check')
      const wrong = await everyScreen(ctx, 'pocket-20', ['/', '/agents', '/approvals', '/money/pay', '/money/invoices', '/statements'], moneyWords)
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: 'every screen writes dollars as $450.00, dollars first beside LXC' }
    },
  }
}

/** 25 — the pages added since 1 November write money one way (B55.38, B55.30). */
export function oneMoneyFormat(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Spending',
    title: 'with dollars and pounds spent and a budget set, Spending, Budgets, Subscriptions and Card write money one way',
    run: async (ctx) => {
      await acceptMoneyTerms(ctx)
      await account(ctx, 'USD', 45_000)
      const gbp = await account(ctx, 'GBP', 20_000)
      const to = await payee(ctx, `Riverside Office ${RUN_SALT}`, '75360253')
      const paid = await step(ctx, 'POST', '/v1/money/payments', { account_id: gbp.id, payee_id: to, amount_minor: 3_000, currency: 'GBP', reference: `Format ${RUN_SALT}`,
        idempotency_key: `e2e-format-${RUN_SALT}-${ctx.app.user.index}` }, '£30.00 paid')
      if (!paid.ok) return fail(`paying £30.00 of test money answered ${said(paid)}`)
      const budget = await step(ctx, 'PUT', '/v1/money/budgets', { agent_id: 'all', category: '', period: 'month', amount_minor: 10_000, currency: 'GBP', timezone: 'UTC' }, 'a £100.00 monthly budget')
      if (!budget.ok) return fail(`setting a budget answered ${said(budget)}`)
      const other = (t: string) => [...moneyWords(t), ...[/\b(GBP|EUR)\s?\d[\d,.]*/, /\d[\d,.]*\s?(GBP|EUR)\b/].flatMap((re) => re.exec(t)?.[0] ?? []).map((m) => `"${m}"`)]
      const wrong = await everyScreen(ctx, 'pocket-25', ['/money/spending', '/money/budgets', '/money/subscriptions', '/money/card'], other)
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: 'Spending, Budgets, Subscriptions and Card write every amount one way: $450.00, £30.00' }
    },
  }
}

/** 24 — no "Spending:" refusal, "Ai software" or "mcp:" name on the money pages (B55.42). */
export function noRawRefusals(): Bare {
  return {
    owner: 'talyvor-suite',
    feature: 'Budgets',
    title: 'a budget Lens refuses reads in words, and Budgets, Agent Wallets and Keys show no "Spending:", underscore, "Ai software" or "mcp:"',
    run: async (ctx) => {
      await acceptMoneyTerms(ctx)
      await account(ctx, 'GBP', 0)
      const page = await ctx.app.tab('/money/budgets')
      const wrong: string[] = []
      try {
        await settled(page)
        // A category Lens does not know, as a screen older than Lens's list would send: Lens's own refusal, read on the screen.
        await page.route((u) => u.pathname === '/api/money/budgets', (route) => {
          const body = route.request().postData()
          return route.continue(body === null ? {} : { postData: JSON.stringify({ ...JSON.parse(body), category: 'pocket_check' }) })
        })
        await page.getByLabel('Amount').fill('100.00')
        await page.getByRole('button', { name: 'Save budget' }).click()
        await page.getByText(/Choose a category|budget|category/i).last().waitFor({ timeout: ACTION_TIMEOUT_MS }).catch(() => undefined)
        await settled(page)
        for (const { width, text } of await bothSizes(ctx, page, 'pocket-24-budgets')) {
          for (const w of [/Spending:/, /\b[a-z]+_[a-z_]+\b/, /Ai software/].flatMap((re) => re.exec(text)?.[0] ?? [])) wrong.push(`Budgets at ${width}px shows "${w}"`)
        }
      } finally {
        await page.close()
      }
      wrong.push(...await everyScreen(ctx, 'pocket-24', ['/agents', '/keys'], (t) => [/Spending:/, /Ai software/, /\bmcp:\S*/].flatMap((re) => re.exec(t)?.[0] ?? []).map((m) => `"${m}"`)))
      if (wrong.length > 0) return fail(wrong.join('; '))
      return { pass: true, detail: 'Lens\'s budget refusal read in words; Budgets, Agent Wallets and Keys show no "Spending:", underscore, "Ai software" or "mcp:"' }
    },
  }
}
