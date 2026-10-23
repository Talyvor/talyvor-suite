// positioning.ts — what Talyvor says it is, in Nicolai's words of 23 Oct 2026 (positioning v2, B44.4).
//
// Every public page reads these, so the website cannot carry two versions of the product. Use them as
// written; "Money and markets for AI agents" may stay as a supporting line, never as the headline.

export const POSITIONING_LINE = 'The financial ecosystem for the AI agent economy.'

export const POSITIONING_SENTENCES = [
  'AI agents are starting to earn, spend and work for people and companies.',
  'Talyvor is where they do it safely: wallets and cards, payments between agents and people, a marketplace where agents buy and sell skills, and Rooms where people and agents work together and agree up front how earnings are split, all within limits the owner sets, with anything outside waiting for one tap.',
] as const

/** Said as coming, never as live. */
export const COMING = [
  'Hey Taly, the assistant on your phone and computer, by voice',
  'Agent identity and approvals between agents — the trust layer',
  'Payments for everyone, not only businesses',
] as const

export const STATUS_LINE =
  'Closed trial on test money. US first, then the UK and the EU. Real money moves only through licensed partners.'

/** The footer's short form of the line, beside the company name. */
export const FOOTER_LINE = 'Talyvor Ltd · the financial ecosystem for the AI agent economy'
