// B56.10 — which of Lens's money capabilities (talyvor-lens internal/economy/wallet_capabilities.go) each section of a
// public page describes. StatusLabel draws Live for a section only when Lens says live for every key in it.

/** /marketing's Wallets: an agent spends, is funded from the workspace, and pays other owners and the outside world. */
export const WALLETS = ['spend_on_talyvor', 'move_between_own_agents', 'pay_another_owner', 'payments_out'] as const

/** /marketing's Marketplace and /pricing's Marketplace bill: listings used, rented and subscribed to. */
export const MARKETPLACE = ['buy_marketplace_listings', 'rent_and_subscribe_listings'] as const

/** /pricing's Credit for agents: credit bought by the workspace and handed to each agent. */
export const CREDIT_FOR_AGENTS = ['spend_on_talyvor', 'move_between_own_agents'] as const

/** A plan card's Money features row: the accounts and payments a plan with live money takes live as each is cleared. */
export const MONEY_FEATURES = ['currency_accounts', 'account_details', 'payments_in', 'payments_out', 'fx', 'merchant_acceptance'] as const

/** The documentation's claim that agents pay each other and hold escrow. */
export const BETWEEN_OWNERS = ['pay_another_owner', 'escrow'] as const

// B56.11 — the signed-in money screens: the capabilities each one moves, labelled from the workspace's own answer
// (GET /api/wallets/capabilities' label) rather than the public one.

/** Agent Wallets, its Statement for every agent and each agent's statement: credit the workspace hands its agents. */
export const AGENT_CREDIT = ['spend_on_talyvor', 'move_between_own_agents'] as const

/** Billing's top-ups and Plans: what the workspace buys from Talyvor. */
export const BUY_FROM_TALYVOR = ['spend_on_talyvor'] as const

/** Pay and a payment prepared for the person to approve: money paid out to people and companies outside Talyvor. */
export const PAY_OUT = ['payments_out'] as const

/** Invoices: money paid into an agent's account from outside Talyvor. */
export const PAY_IN = ['payments_in'] as const

/** An agent's wallet on the money layer: its account, and the details others pay into. */
export const MONEY_WALLET = ['currency_accounts', 'account_details'] as const

/** Sending to, asking from and paying another owner's agent on a schedule. */
export const BETWEEN_OWNERS_PAY = ['pay_another_owner'] as const

/** B56.15 — a currency account's statement on Statements: the account in dollars, pounds, euros or USDC. */
export const CURRENCY_ACCOUNT = ['currency_accounts'] as const
