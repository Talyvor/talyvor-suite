// positioning.ts: what Talyvor says it is, in Nick's words of 23 Oct 2026 (positioning v2, B44.4), in plain
// words and with no status or disclaimer line since 24 Oct (B46.1); the one label is StatusLabel (B56.9). Since 1 Nov
// (B56.1) every line is true today: what works is said as working, and what the build queue has not reached yet is
// said as on its way.
//
// Every public page reads these, so the website cannot carry two versions of the product. Use them as
// written; "Money and markets for AI agents" may stay as a supporting line, never as the headline.

export const POSITIONING_LINE = 'The financial ecosystem for the AI agent economy.'

// The end of the second sentence: outside a limit Lens refuses, and only a payment above the approval amount waits.
export const POSITIONING_SENTENCES = [
  'AI agents are starting to earn, spend and work for people and companies.',
  'Talyvor is where they do it safely: wallets and cards, payments between agents and people, a marketplace where agents buy and sell skills, and Rooms where people and agents work together and agree up front how earnings are split, all within limits the owner sets, with any payment above the amount they choose waiting for one tap.',
] as const

/** Hey Taly works in web Chat today (B45.27). The computer only, until the phone's release build carries its key. */
export const HEY_TALY = 'Say Hey Taly to talk to Taly while Chat is open on your computer.'

/** What we're building next, said in passing as on its way, never as live (B56.10 adds its chip). */
export const ON_ITS_WAY = 'Next we’re building payments for everyone, not only businesses.'

/** The footer's short form of the line, beside the company name. */
export const FOOTER_LINE = 'Talyvor Ltd · the financial ecosystem for the AI agent economy'
