import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, Input, NavIcon, cn, focusRing } from '@talyvor/ui'
import { Region } from '../../components/Region'
import { VoiceButton } from '../chat/VoiceButton'
import { usdText } from '../rooms/roomsApi'
import { type AskPick, KINDS, MarketError, formatDisplay, marketApi } from './marketApi'
import { KIND_ICON, readFailure } from './parts'

// Ask.tsx — B41.71: ask the marketplace, at the top of Discover.
// A job in words, typed or said (the microphone is Chat's: the recording is transcribed by Lens and lands in the box to
// be edited before asking). Lens (B41.171) answers with up to three listings, ranked as the search ranks them, each with
// what the job's volume of uses would cost on its cheapest commercial offer and why it fits.

/** What a pick would cost for the volume, as the buyer reads it. */
function estimateText(p: AskPick): string {
  const e = p.estimate
  if (e === null) return 'Enterprise licence only, priced by seat'
  if (e.total_usd_micros <= 0) return 'Free'
  return e.display ? formatDisplay(e.display) : usdText(e.total_usd_micros)
}

function AskCard({ p }: { p: AskPick }) {
  const e = p.estimate
  const why = p.why ?? []
  return (
    <li
      className="relative flex flex-col gap-3 rounded-card border border-rule bg-raised p-4 transition-colors duration-200 hover:border-rule-strong"
      data-testid="ask-pick"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2">
          <NavIcon name={KIND_ICON[p.kind] ?? 'grid'} className="h-6 w-6 text-accent-strong" />
          <span className="font-figure text-eyebrow uppercase text-label">
            {KINDS.find((k) => k.kind === p.kind)?.label ?? p.kind}
          </span>
        </span>
        <NavIcon name="arrow" className="h-4 w-4 text-muted" />
      </span>
      <Link
        className={cn('text-head text-ink after:absolute after:inset-0 after:rounded-card', focusRing)}
        to={`/marketplace/listings/${encodeURIComponent(p.id)}`}
      >
        {p.title}
      </Link>
      {why.length > 0 ? (
        <ul className="flex flex-col gap-1 text-body text-muted" aria-label="Why it fits">
          {why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}
      <span className="mt-auto flex flex-col gap-0.5 border-t border-rule pt-3">
        <span className="font-figure text-eyebrow uppercase text-label">
          Estimate for <span className="font-figure">{(e?.volume ?? 0).toLocaleString('en-US')}</span>{' '}
          {e?.volume === 1 ? 'use' : 'uses'}
        </span>
        <span className="font-figure text-head text-ink" data-testid="ask-estimate">
          {estimateText(p)}
        </span>
        {e && e.total_usd_micros > 0 ? (
          <span className="text-caption text-muted" data-testid="ask-basis">
            {e.basis}
            {e.display?.tax_label ? ` · ${e.display.tax_label}` : ''}
            {e.display && e.display.currency !== 'USD' ? (
              <>
                {' '}
                · billed in US dollars: <span className="font-figure">{usdText(e.total_usd_micros)}</span>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
    </li>
  )
}

export function Ask() {
  const [text, setText] = useState('')
  const [asked, setAsked] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const answer = useQuery({ queryKey: ['market-ask', asked], queryFn: () => marketApi.ask(asked), enabled: asked !== '' })
  const picks = answer.data?.picks ?? []
  return (
    <Region index="01" label="Ask" fullWidth className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2"
        aria-label="Ask the marketplace"
        onSubmit={(e) => {
          e.preventDefault()
          setAsked(text.trim())
        }}
      >
        <label className="text-body text-ink" htmlFor="market-ask">
          Describe a job, and get up to three listings with what it would cost
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id="market-ask"
            placeholder="translate 500 product descriptions into German"
            className="min-w-0 flex-1 wide:max-w-xl"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <VoiceButton disabled={answer.isFetching} onText={setText} onNote={setNote} />
          <Button type="submit" disabled={text.trim() === '' || answer.isFetching}>
            Ask
          </Button>
        </div>
        {note ? (
          <p role="status" className="text-caption text-muted">
            {note}
          </p>
        ) : null}
      </form>
      {asked === '' ? null : answer.isError ? (
        <p className="text-body text-muted">{searchFailure(answer.error)}</p>
      ) : answer.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : picks.length === 0 ? (
        <p className="text-body text-muted" data-testid="ask-empty">
          No listing fits “{answer.data.q}” yet. Try fewer words, or search below.
        </p>
      ) : (
        <>
          <p className="text-caption text-muted" data-testid="ask-volume">
            {answer.data.volume_from === 'default'
              ? 'Estimates for one use. Put a number in your words to price more.'
              : `Estimates for ${answer.data.volume.toLocaleString('en-US')} uses${answer.data.volume_from === 'words' ? ', the number in your words' : ''}.`}
          </p>
          <ol className="grid gap-3 wide:grid-cols-3" aria-label="Listings that fit">
            {picks.map((p) => (
              <AskCard key={p.id} p={p} />
            ))}
          </ol>
          <p className="text-caption text-muted">{answer.data.note}</p>
        </>
      )}
    </Region>
  )
}

export function searchFailure(err: unknown): string {
  // A filter Lens refuses (a capability not on its list) comes back with its sentence: that is the answer.
  if (err instanceof MarketError && err.status === 400 && err.sentence) return err.sentence
  return readFailure(err, 'The marketplace')
}
