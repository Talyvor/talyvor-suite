import { cn } from '@talyvor/ui'
import { DESIGN_ATTR } from '../pocketPending'
import building from './building.json'

// B56.9 — THE ONE LABEL (Nick, 1 Nov 2026: "yes to labels. but make sure they are true to what they state").
//
// Live and Sandbox are Lens's, by capability key: GET /api/pricing's labels for a public page, or a capability's label
// on GET /api/wallets/capabilities for a workspace (talyvor-lens B56.7). Building is building.json's, by key: a
// feature the build queue has not shipped, with the BUILD.md item that ships it. A key Lens did not answer, an
// answer that is neither live nor sandbox, and a Building key not in the file all draw nothing: a label that is not
// backed is worse than none. Drawn as pocket.css .status, and held to Pocket's rules wherever it is placed (its own
// data-design); no other component draws these three words as a chip.

export type LabelState = 'live' | 'sandbox' | 'building'

/** What each label means, in one plain line. The "What the labels mean" blocks print these. */
export const LABEL_LINES: Record<LabelState, string> = {
  live: 'Moves real money.',
  sandbox: 'Works. No real money moves.',
  building: 'In our build queue. Not shipped yet.',
}

const WORDS: Record<LabelState, string> = { live: 'Live', sandbox: 'Sandbox', building: 'Building' }

/** One feature still being built: its key, the feature in plain words, and the item as BUILD.md writes it (B56.19). */
export interface BuildingEntry {
  key: string
  feature: string
  item: string
}

export const BUILDING: readonly BuildingEntry[] = building

/** The registry's entry for key, or undefined when the file has none. */
export function buildingEntry(key: string): BuildingEntry | undefined {
  return BUILDING.find((e) => e.key === key)
}

export type StatusLabelProps =
  | {
      /** A money capability's key, as Lens names it; or every key a section covers (B56.10), Live only when each is. */
      capability: string | readonly string[]
      labels: Record<string, string> | undefined
      className?: string
    }
  | { /** A key in building.json. */ building: string; className?: string }
  /** B56.10 — "What the labels mean": the state itself, beside its line, saying nothing about any feature. */
  | { legend: LabelState; className?: string }

// pocket.css .status: Live outlined in success with a solid dot, Sandbox outlined in the control edge with a dashed
// square, Building on tangerine with a half-filled circle.
const SHADES: Record<LabelState, string> = {
  live: 'bg-page text-success shadow-edge-current',
  sandbox: 'bg-page text-ink-2 shadow-edge',
  building: 'bg-tangerine-50 text-tangerine-ink',
}

function Mark({ state }: { state: LabelState }) {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3 shrink-0">
      {state === 'live' ? (
        <>
          <circle cx="6" cy="6" r="2.1" fill="currentColor" />
          <circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </>
      ) : state === 'sandbox' ? (
        <rect x="1.6" y="1.6" width="8.8" height="8.8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2.2 1.8" />
      ) : (
        <>
          <circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 1.8a4.2 4.2 0 0 1 0 8.4z" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

function stateOf(props: StatusLabelProps): LabelState | null {
  if ('legend' in props) return props.legend
  if ('building' in props) return buildingEntry(props.building) ? 'building' : null
  // A section that covers several capabilities moves real money only when every one does; one Lens did not answer
  // leaves the section unlabelled.
  const keys: readonly string[] = typeof props.capability === 'string' ? [props.capability] : props.capability
  const states = keys.map((k) => props.labels?.[k])
  if (!states.length || states.some((l) => l !== 'live' && l !== 'sandbox')) return null
  return states.every((l) => l === 'live') ? 'live' : 'sandbox'
}

/** What the chip is about: the registry key, or the capability keys Lens labelled; none for the legend. */
function keyOf(props: StatusLabelProps): string | undefined {
  if ('legend' in props) return undefined
  if ('building' in props) return props.building
  return typeof props.capability === 'string' ? props.capability : props.capability.join(' ')
}

/** B56.10 — the "What the labels mean" block on /marketing and /pricing: each label beside its one line. */
export function LabelsMeaning({ className }: { className?: string }) {
  return (
    <div data-testid="labels-meaning" className={className}>
      <p className="text-eyebrow uppercase text-label">What the labels mean</p>
      <dl className="mt-3 flex flex-col gap-2">
        {(['live', 'sandbox', 'building'] as const).map((state) => (
          <div key={state} className="flex flex-wrap items-center gap-3">
            <dt>
              <StatusLabel legend={state} />
            </dt>
            <dd className="text-body text-muted">{LABEL_LINES[state]}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** B56.10 — a line still in the build queue, said in words from the registry: "Paying earnings out in money is
 *  building; until then they are taken as Talyvor credits." Null once the registry has no entry for key. */
export function buildingWords(key: string, until: string): string | null {
  const entry = buildingEntry(key)
  return entry ? `${entry.feature} is building; ${until}.` : null
}

export function StatusLabel(props: StatusLabelProps) {
  const state = stateOf(props)
  if (!state) return null
  const line = LABEL_LINES[state]
  return (
    <span
      data-status-label={state}
      data-status-key={keyOf(props)}
      {...{ [DESIGN_ATTR]: 'pocket' }}
      title={`${WORDS[state]}: ${line.charAt(0).toLowerCase()}${line.slice(1)}`}
      className={cn(
        'inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-pill pl-2 pr-2.5 text-micro font-semibold',
        SHADES[state],
        props.className,
      )}
    >
      <Mark state={state} />
      {WORDS[state]}
    </span>
  )
}
