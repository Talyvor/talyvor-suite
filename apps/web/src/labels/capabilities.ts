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

/** The documentation's claim that agents pay each other, hold escrow and lend between companies. */
export const BETWEEN_OWNERS = ['pay_another_owner', 'escrow', 'loans_between_companies'] as const
