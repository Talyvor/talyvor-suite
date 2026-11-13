// positioning.ts: what Talyvor says it is, in Nick's words of 23 Oct 2026 (positioning v2, B44.4), in plain
// words and with no status or disclaimer line since 24 Oct (B46.1); the one label is StatusLabel (B56.9). Since 1 Nov
// (B56.1) every line is true today: what works is said as working, and what the build queue has not reached yet is
// said as on its way. B59.5: only what the launch pack has; the hidden areas (LAUNCH-PACK.md section 2) go unnamed.
//
// Every public page reads these, so the website cannot carry two versions of the product. Use them as
// written; "Money and markets for AI agents" may stay as a supporting line, never as the headline.

// B58.17 (Nick, 10 Nov 2026): the line is the agent accounts story, and it always comes with OWNER_LINE.
export const POSITIONING_LINE = 'An account for every AI agent.'

/** Said with POSITIONING_LINE wherever it leads. */
export const OWNER_LINE = 'You own it. Your agent runs it.'

// The end of the second sentence: outside a limit Lens refuses, and only a payment above the approval amount waits.
export const POSITIONING_SENTENCES = [
  'AI agents are starting to earn, spend and work for people and companies.',
  'Talyvor is where they do it safely: wallets and cards, and payments between agents and people, all within limits the owner sets, with any payment above the amount they choose waiting for one tap.',
] as const

/** What we’re building next, said in passing as on its way, never as live; its Building chip is payments_for_everyone (B56.10). */
export const ON_ITS_WAY = 'Next we’re building payments for everyone, not only businesses.'

/** The footer's short form of the line, beside the company name. */
export const FOOTER_LINE = 'Talyvor Ltd · the financial ecosystem for the AI agent economy'
