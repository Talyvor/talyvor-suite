import type { FaceColour } from '@talyvor/ui/pocket'

// B57.120 — the 15 card faces Nick approved on 10 Nov 2026 (design/talyvor-cards-final, layout/Card.dc.html).
// The art carries no text: the logo, tier, holder and sub line are drawn in code on top, so an agent the owner
// called "Atlas" never shows "Remy". Owner cards are physical (chip, tier label); agent cards are virtual. The
// network corner stays empty and no face carries a card number, expiry or CVC.

export type CardFamily = 'personal' | 'corporate' | 'stablecoin' | 'agent'
export type CardTier = 'Daily' | 'Premium' | 'Platinum' | 'Team' | 'Business' | 'Enterprise'
export type CardHelper = 'Remy' | 'Sunny' | 'Penny' | 'Max' | 'Nova' | 'Ollie'
/** ink text on light art (Card.dc.html onLight), white text on dark art (onDark). */
export type CardText = 'ink' | 'white'

/** Card.dc.html's two text schemes: the text and sub-line colours, the logo file, and the left-to-right scrim
 *  that keeps them readable, with the scrim's darkest stop as one colour for the contrast check. */
export const cardFaces: Record<CardText, { ink: string; ink2: string; logo: 'on-light' | 'on-dark'; scrim: string; scrimStop: string }> = {
  ink: {
    ink: '#111216',
    ink2: '#3E4452',
    logo: 'on-light',
    scrim: 'linear-gradient(90deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 55%)',
    scrimStop: '#FFFFFF',
  },
  white: {
    ink: '#FFFFFF',
    ink2: '#D2D6DE',
    logo: 'on-dark',
    scrim: 'linear-gradient(90deg, rgba(10,11,14,0.45) 0%, rgba(10,11,14,0) 55%)',
    scrimStop: '#0A0B0E',
  },
}

type Common = {
  id: string
  /** served from apps/web/public/cards, the art/ file name unchanged */
  art: `/cards/${string}.jpg`
  text: CardText
  /** /brand/logo/talyvor-logo-<logo>.svg */
  logo: 'on-light' | 'on-dark'
  badge: { label: string; background: string; ink: string } | null
}
export type OwnerCardArt = Common & { family: 'personal' | 'corporate' | 'stablecoin'; tier: CardTier }
export type AgentCardArt = Common & { family: 'agent'; helper: CardHelper; colour: Exclude<FaceColour, 'lime'> }
export type CardArt = OwnerCardArt | AgentCardArt

const coins = { label: 'USDC · EURC', background: '#111216', ink: '#FFFFFF' }

const owner = (id: string, family: OwnerCardArt['family'], tier: CardTier, text: CardText, badge: Common['badge'] = null): OwnerCardArt => ({
  id, family, tier, art: `/cards/${id}.jpg`, text, logo: cardFaces[text].logo, badge,
})
const agent = (helper: CardHelper, colour: AgentCardArt['colour'], text: CardText): AgentCardArt => {
  const id = `agent-${helper.toLowerCase()}`
  return { id, family: 'agent', helper, colour, art: `/cards/${id}.jpg`, text, logo: cardFaces[text].logo, badge: null }
}

/** Lime has no helper yet: a lime agent keeps today's face and a plain lime card until a seventh is drawn. */
export const cardArt: readonly CardArt[] = [
  owner('daily', 'personal', 'Daily', 'ink'),
  owner('premium', 'personal', 'Premium', 'white'),
  owner('platinum', 'personal', 'Platinum', 'ink'),
  owner('team', 'corporate', 'Team', 'white'),
  owner('business', 'corporate', 'Business', 'white'),
  owner('enterprise', 'corporate', 'Enterprise', 'white'),
  owner('stable', 'stablecoin', 'Daily', 'ink', coins),
  owner('stable-premium', 'stablecoin', 'Premium', 'white', { label: 'USDC · EURC', background: '#16C79A', ink: '#111216' }),
  owner('stable-platinum', 'stablecoin', 'Platinum', 'ink', coins),
  agent('Remy', 'cobalt', 'white'),
  agent('Sunny', 'orchid', 'white'),
  agent('Penny', 'mint', 'ink'),
  agent('Max', 'lemon', 'ink'),
  agent('Nova', 'sky', 'ink'),
  agent('Ollie', 'rose', 'ink'),
]
