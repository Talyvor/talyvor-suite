/**
 * B57.3 — POCKET'S VIEW RULES, as the four brand tests (ScreensBrand, ChatBrand, MarketplaceBrand,
 * WalletBrand) hold every screen to them. The roles are pocket.css's header: ink is text and the
 * primary action, tangerine is the brand and "your move", green and red are status and always come
 * with words. The card rule is planeAudit's, re-exported so the brand tests ask the same question.
 */
import { isPocketCard } from './planeAudit'
import { inPocket } from './pocketPending'

export { isPocketCard }

/** A card on its plane: Pocket's card on a Pocket page, today's raised plane on a pending one. */
export function cardOnItsPlane(el: Element): boolean {
  return inPocket(el) ? isPocketCard(el) : el.className.includes('bg-raised')
}

/** The class list without variants: `hover:bg-tangerine` paints tangerine too. */
function utilities(el: Element): string[] {
  return (el.getAttribute('class') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((c) => c.slice(c.lastIndexOf(':') + 1))
}

/**
 * The primary (ink) fills in a view, as a button or a link, by Pocket's name and today's alias. The
 * resting fill only: a switch's `aria-checked:bg-accent` is a state, not a primary action.
 */
export function primaryActions(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('button, a'))
    .filter((el) => (el.getAttribute('class') ?? '').split(/\s+/).some((c) => c === 'bg-primary' || c === 'bg-accent'))
    .map((el) => el.textContent?.trim() ?? '')
}

/**
 * Tangerine itself, as any paint (`tangerine-ink`, the orange that carries words, and the
 * `tangerine-50` tint are not the mark). An optional `/opacity` is still tangerine.
 */
const TANGERINE = /^(?:bg|text|border|ring|fill|stroke|outline|decoration|from|via|to|shadow|accent|caret)-tangerine(?:\/\d+)?$/

/** Why tangerine may be used here: the brand mark, or "your move". */
export const TANGERINE_REASONS = ['brand', 'your-move'] as const

/**
 * Every element painted tangerine without a reason. A screen says why with `data-tangerine` on the
 * element or an ancestor; text is never tangerine, whatever the reason.
 */
export function tangerineOffenders(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('[class]')).filter((el) => {
    const painted = utilities(el).filter((c) => TANGERINE.test(c))
    if (painted.length === 0) return false
    if (painted.some((c) => c.startsWith('text-'))) return true
    const reason = el.closest('[data-tangerine]')?.getAttribute('data-tangerine') ?? ''
    return !(TANGERINE_REASONS as readonly string[]).includes(reason)
  })
}

/** Status colours: Pocket's and today's names for them. Their tints are the chip behind the word. */
const STATUS = /^(?:bg|text|border|ring|fill|stroke|outline)-(?:success|danger|settled|slashed)(?:\/\d+)?$/

const WORDS = /\p{L}{2,}/u

function hasWords(el: Element | null): boolean {
  if (!el) return false
  return WORDS.test(el.textContent ?? '') || WORDS.test(el.getAttribute('aria-label') ?? '') || WORDS.test(el.getAttribute('title') ?? '')
}

/** Every element painted a status colour with no words in it or beside it. A figure is not a word. */
export function statusWithoutWords(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll('[class]')).filter(
    (el) => utilities(el).some((c) => STATUS.test(c)) && !hasWords(el) && !hasWords(el.parentElement),
  )
}
