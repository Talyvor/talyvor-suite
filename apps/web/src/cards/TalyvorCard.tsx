import type { CSSProperties } from 'react'
import { cn } from '@talyvor/ui'

import { cardFaces, type CardArt } from './cardArt'

// B57.122 — one card face, drawn from the manifest exactly as layout/Card.dc.html: the art, the left-to-right scrim,
// the wordmark top left, the tier, family and chip on owner cards, the badge on stablecoin cards, and the holder with
// one sub line. The art carries no text, so the holder and sub line come from props: an owner card shows the account
// holder's name, an agent card the agent's own name and its job line. The network corner stays empty (no mark until
// the issuer gives one), and no face carries a card number, expiry or CVC. Every size is Card.dc.html's at 428 × 270,
// in container units, so the card scales with its width.

/** Card.dc.html's geometry at 428 px wide, in px. The holder's box ends before the empty network corner. */
export const cardLayout = {
  width: 428,
  height: 270,
  holderLeft: 22,
  holderMaxWidth: 310,
  networkLeft: 428 - 20 - 64,
} as const

/** 26 px for an agent's name and 15 px for an owner's, as Card.dc.html; a long agent name shrinks to fit, down to 16. */
export function holderSize(holder: string, agent: boolean): number {
  if (!agent) return 15
  return Math.max(16, Math.min(26, Math.floor((26 * 14) / Math.max(holder.length, 1))))
}

/** A length from Card.dc.html at 428 px wide, scaled with the card. */
export const cardUnit = (px: number) => `calc(100cqw * ${px} / ${cardLayout.width})`
const u = cardUnit

/** The card's box: its proportions and its 18 px corner. Text sizes in it are container units. */
export const cardFrame: CSSProperties = {
  aspectRatio: `${cardLayout.width} / ${cardLayout.height}`,
  containerType: 'inline-size',
  // The root cannot size against itself in container units, so its 18 px corner is a share of its own box.
  borderRadius: `${(1800 / cardLayout.width).toFixed(3)}% / ${(1800 / cardLayout.height).toFixed(3)}%`,
}
export const cardShadow = '0 1px 2px rgba(17, 18, 22, 0.08), 0 14px 34px rgba(17, 18, 22, 0.18)'

const line: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }

const family = { personal: 'Personal', corporate: 'Corporate', stablecoin: 'Stablecoin' } as const

export interface TalyvorCardProps {
  card: CardArt
  /** the account holder's name as the app shows it, or the agent's own name. */
  holder: string
  /** one line under the holder: the account line, or the agent's job line. */
  sub: string
  /** read in place of the face; by default the holder and which card it is. */
  alt?: string
  className?: string
}

export function TalyvorCard({ card, holder, sub, alt, className }: TalyvorCardProps) {
  const face = cardFaces[card.text]
  const agent = card.family === 'agent'
  const label = alt ?? (agent ? `${holder}, agent card` : `${holder}, ${card.tier} ${card.family} card`)
  return (
    <div
      role="img"
      aria-label={label}
      data-card={card.id}
      className={cn('relative w-full overflow-hidden font-sans', className)}
      style={{ ...cardFrame, background: '#111216', color: face.ink, boxShadow: cardShadow }}
    >
      <img src={card.art} alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0" style={{ background: face.scrim }} />
      <img
        data-card-part="logo"
        src={`/brand/logo/talyvor-logo-${card.logo}.svg`}
        alt=""
        className="absolute h-auto"
        style={{ left: u(22), top: u(22), width: u(112) }}
      />
      {agent ? null : (
        <>
          <div data-card-part="tier" className="absolute text-right" style={{ right: u(22), top: u(18) }}>
            <div className="font-display" style={{ fontWeight: 750, fontSize: u(18), letterSpacing: '-0.01em', lineHeight: 1.1 }}>
              {card.tier}
            </div>
            <div className="uppercase" style={{ fontSize: u(10.5), fontWeight: 650, letterSpacing: '0.08em', color: face.ink2, marginTop: u(3) }}>
              {family[card.family]}
            </div>
          </div>
          <div
            data-card-part="chip"
            className="absolute overflow-hidden"
            style={{
              left: u(24),
              top: u(100),
              width: u(44),
              height: u(34),
              borderRadius: u(7),
              background: 'linear-gradient(135deg, #F1E7C8, #C9B47E)',
              boxShadow: 'inset 0 0 0 1px rgba(17, 18, 22, 0.2)',
            }}
          >
            {[11, 22].map((top) => (
              <div key={top} className="absolute inset-x-0" style={{ top: u(top), height: 1, background: 'rgba(17, 18, 22, 0.22)' }} />
            ))}
            {[16, 28].map((left) => (
              <div key={left} className="absolute inset-y-0" style={{ left: u(left), width: 1, background: 'rgba(17, 18, 22, 0.22)' }} />
            ))}
          </div>
        </>
      )}
      {card.badge ? (
        <div
          data-card-part="badge"
          className="absolute flex items-center rounded-pill"
          style={{
            left: u(22),
            top: u(148),
            height: u(22),
            padding: `0 ${u(10)}`,
            fontSize: u(11.5),
            fontWeight: 650,
            background: card.badge.background,
            color: card.badge.ink,
          }}
        >
          {card.badge.label}
        </div>
      ) : null}
      <CardHolder holder={holder} sub={sub} agent={agent} ink2={face.ink2} />
    </div>
  )
}

/** The holder bottom left, clear of the network corner, with its one sub line in the face's second ink. */
export function CardHolder({ holder, sub, agent, ink2 }: { holder: string; sub: string; agent: boolean; ink2: string }) {
  return (
    <div className="absolute" style={{ left: u(cardLayout.holderLeft), bottom: u(20), maxWidth: u(cardLayout.holderMaxWidth) }}>
      <div
        className="font-display"
        style={{ ...line, fontWeight: 750, fontSize: u(holderSize(holder, agent)), letterSpacing: '-0.01em', lineHeight: 1.05 }}
      >
        {holder}
      </div>
      <div style={{ ...line, fontSize: u(12), fontWeight: 600, color: ink2, marginTop: u(4) }}>{sub}</div>
    </div>
  )
}
