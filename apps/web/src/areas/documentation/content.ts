// B27.31 — what /documentation says, kept apart from how it is drawn so the test can walk every
// claim. Each claim names ONE thing a person can do today and links to the screen or route that
// does it; Documentation.test.tsx resolves every internal link against the routes the app
// actually mounts, so a screen that is removed or renamed fails the build instead of leaving a
// link here to "Nothing at this address".
//
// ONLY WHAT SHIPS. Each claim was read off the screen it links to (or the help page that screen
// links to), not off a roadmap. Lens's routes are in lens-routes.json, extracted from Lens's source
// and checked by scripts/lens-routes.mjs in CI.
//
// B59.37 — and only the launch pack (LAUNCH-PACK.md section 2): no guide, claim or route group for a hidden area.
//
// B56.10: a claim that moves money carries Lens's Live or Sandbox, and a claim still partly in the build queue says so
// in words from building.json, with its Building chip.

import { BETWEEN_OWNERS } from '../../labels/capabilities'

export const DOCUMENTATION_PATH = '/documentation'

/** B40.20 — the Claude connector's page, which Claude's connector directory links to. */
export const CLAUDE_CONNECTOR_PATH = `${DOCUMENTATION_PATH}/claude`

/** The hosted gateway. Answered /healthz, /status and /openapi.json on 2026-10-04. */
export const LENS_ORIGIN = 'https://lens.talyvor.com'

/** B56.10 — the money capabilities Lens labels, by the claim that moves that money. */
const FUND_AGENTS = ['move_between_own_agents'] as const

export interface Claim {
  /** One sentence: what a person can do. */
  text: string
  /** Where they do it — an in-app path, or an absolute URL for something outside the app. */
  href: string
  /** The link's own words. */
  label: string
  /** B56.10 — the money capabilities the claim moves: Live or Sandbox from Lens beside it. */
  money?: readonly string[]
  /** B56.10 — what in the claim is still in the build queue: building.json's key, and what holds until it ships. Said in
   *  words, with its chip, while the registry has the key. */
  building?: { key: string; until: string }
}

export interface Capability {
  id: string
  name: string
  role: string
  lede: string
  claims: Claim[]
}

// B28.15 — wallet-first: getting started is giving one agent a wallet and watching it spend, and
// Agent Wallets is the first capability (lens-routes.json lists its routes first too).
export const START: Claim[] = [
  { text: 'Create a workspace with an account you already have.', href: '/signup', label: 'Sign up' },
  {
    text: 'Create an agent. It gets a wallet of its own, empty until you fund it.',
    href: '/agents',
    label: 'Agent Wallets: Create agent',
  },
  {
    text: 'Fund its wallet from the workspace’s balance. The agent can spend only what its wallet holds.',
    href: '/agents',
    label: 'Agent Wallets: Fund',
  },
  {
    text: 'Issue the agent its own key: a proxy key that spends only this agent’s balance, under its rules. It is shown once.',
    href: '/agents',
    label: 'Agent Wallets: Issue a key',
  },
  {
    text: 'Give the agent that key and the base URL Setup prints for Claude Code, Cursor, Continue or the OpenAI SDK.',
    href: '/setup',
    label: 'Setup',
  },
  {
    text: 'Watch its statement: every request the agent makes is a line with what it cost and the balance left.',
    href: '/agents',
    label: 'Agent Wallets: Statement',
  },
  {
    text: 'Connect Claude, so it can read your accounts and prepare payments that you approve in Talyvor.',
    href: CLAUDE_CONNECTOR_PATH,
    label: 'Talyvor in Claude',
  },
]

export const CAPABILITIES: Capability[] = [
  {
    id: 'wallets',
    name: 'Agent Wallets',
    role: 'A wallet for each AI agent',
    lede: 'Each agent a workspace runs gets a wallet of its own on Lens’s double-entry ledger: the workspace funds it, the agent spends only what it holds, and its statement is every posting against it. Lens checks the rules before a provider is called or a payment moves.',
    claims: [
      {
        text: 'Create an agent, fund its wallet and take funds back.',
        href: '/agents',
        label: 'Agent Wallets',
        money: FUND_AGENTS,
      },
      {
        text: 'Issue the agent a key that spends only its own balance, under its rules.',
        href: '/agents',
        label: 'Agent Wallets',
      },
      {
        text: 'Set its spending rules: a payment past a limit is refused, and one above the approval amount waits in your approvals inbox, approved with a passkey once you have one.',
        href: '/agents',
        label: 'Agent Wallets',
      },
      { text: 'Pause one agent, or stop every agent with one switch.', href: '/agents', label: 'Agent Wallets' },
      { text: 'Read and download each wallet’s statement.', href: '/agents', label: 'Agent Wallets' },
      {
        text: 'Agents pay each other and hold money in escrow.',
        href: '/agents',
        label: 'Agent Wallets',
        money: BETWEEN_OWNERS,
      },
      { text: 'Every wallet route Lens answers, with what each one does.', href: '#lens-wallets', label: 'Lens API: Agent Wallets' },
    ],
  },
]

export interface Licence {
  repo: string
  what: string
  /** Exactly as the repository's LICENSE names it. */
  licence: string
  /** Anything the LICENSE carves out, in its own terms. */
  except?: string
}

// Read from each repository's LICENSE on 2026-10-04. All five are the Business Source License 1.1
// with Change Date 2030-07-26 and Change License "Apache License, Version 2.0". The suite's own row
// is checked against ../../LICENSE by Documentation.test.tsx.
export const CHANGE_DATE = '2030-07-26'
export const CHANGE_LICENCE = 'Apache License, Version 2.0'

export const LICENCES: Licence[] = [
  { repo: 'talyvor-suite', what: 'This app: the console, Chat, the screens for Docs, Track, Wallets and Marketplace', licence: 'Business Source License 1.1' },
  {
    repo: 'talyvor-lens',
    what: 'The gateway and its API',
    licence: 'Business Source License 1.1',
    except: 'the client SDKs in sdk/typescript/ and sdk/python/ are under the MIT License',
  },
  { repo: 'talyvor-track', what: 'The issue tracker service', licence: 'Business Source License 1.1' },
  { repo: 'talyvor-docs', what: 'The wiki service', licence: 'Business Source License 1.1' },
  { repo: 'talyvor-code', what: 'The VS Code extension and the CLI', licence: 'Business Source License 1.1' },
]

export const licenceUrl = (repo: string) => `https://github.com/Talyvor/${repo}/blob/main/LICENSE`
