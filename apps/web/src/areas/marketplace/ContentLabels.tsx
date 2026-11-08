import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button, focusRing, inlineLink } from '@talyvor/ui'
import { Region } from '../../components/Region'
import {
  AGE_RATINGS,
  type AgeRating,
  CONTENT_LABELS,
  type ContentLabel,
  type Listing,
  ageRatingLabel,
  contentLabelName,
  marketApi,
  refusalText,
} from './marketApi'
import { CATALOG_KEY, Card, DISCOVER_KEY, Note, pressed, readFailure, selectClass } from './parts'

// ContentLabels.tsx — B41.85: every listing carries an age rating and the content labels its seller declares (Lens
// B41.185, Apple guideline 4.7). The seller chooses them to publish and can change them; a buyer's workspace sets a
// content filter (a family filter shows only listings rated for everyone) and blocks single listings, and Lens keeps
// what it hides out of the catalog, search and collections. A workspace always sees its own listings.

export const CONTENT_FILTER_KEY = ['market-content-filter']

/** The rating is chosen, never assumed; a listing labelled adult content is rated 18 and over. */
export function contentReady(rating: AgeRating | null, labels: readonly ContentLabel[]): rating is AgeRating {
  return rating !== null && (rating === '18+' || !labels.includes('adult'))
}

function LabelBoxes({
  legend,
  labels,
  onChange,
}: {
  legend: string
  labels: readonly ContentLabel[]
  onChange: (next: ContentLabel[]) => void
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-caption text-muted">{legend}</legend>
      {CONTENT_LABELS.map(([v, name]) => (
        <label key={v} className="flex items-center gap-2 text-body text-ink">
          <input
            type="checkbox"
            checked={labels.includes(v)}
            onChange={(e) => onChange(e.target.checked ? [...labels, v] : labels.filter((x) => x !== v))}
            className={`transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          />
          {name}
        </label>
      ))}
    </fieldset>
  )
}

/** The seller's choice of who a listing is for and what it gives, on Publish and on their listing's page. */
export function ContentPicker({
  rating,
  labels,
  onRating,
  onLabels,
}: {
  rating: AgeRating | null
  labels: readonly ContentLabel[]
  onRating: (r: AgeRating) => void
  onLabels: (l: ContentLabel[]) => void
}) {
  const ratingID = useId()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span id={ratingID} className="font-figure text-eyebrow uppercase text-label">
          Age rating
        </span>
        <div role="group" aria-labelledby={ratingID} className="flex flex-wrap gap-2">
          {AGE_RATINGS.map(([v, name]) => (
            <Button key={v} aria-pressed={rating === v} className={pressed} onClick={() => onRating(v)}>
              {name}
            </Button>
          ))}
        </div>
      </div>
      <LabelBoxes legend="What it gives — tick every one that applies" labels={labels} onChange={onLabels} />
      {rating === null ? (
        <p className="text-caption text-muted">Choose who it is for. Every listing carries an age rating.</p>
      ) : !contentReady(rating, labels) ? (
        <Note ok={false}>A listing with adult content is rated 18 and over.</Note>
      ) : null}
    </div>
  )
}

/** Who a listing is for and what it gives, under its title. */
export function ContentLine({ listing }: { listing: Listing }) {
  const labels = listing.content_labels ?? []
  return (
    <p className="text-caption text-muted" data-testid="listing-content">
      Rated {(listing.age_rating ?? '18+') === 'all' ? 'for everyone' : ageRatingLabel(listing.age_rating ?? '18+')}
      {labels.length > 0 ? ` · ${labels.map(contentLabelName).join(', ')}` : ''}
    </p>
  )
}

/** The seller changes their listing's rating and labels. */
export function Relabel({ listing }: { listing: Listing }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState<AgeRating | null>(listing.age_rating ?? '18+')
  const [labels, setLabels] = useState<ContentLabel[]>(listing.content_labels ?? [])
  const save = useMutation({
    mutationFn: (r: AgeRating) => marketApi.setContentLabels(listing.id, r, labels),
    onSuccess: () => {
      setOpen(false)
      void qc.invalidateQueries({ queryKey: ['market-listing', listing.id] })
      void qc.invalidateQueries({ queryKey: CATALOG_KEY })
      void qc.invalidateQueries({ queryKey: DISCOVER_KEY })
    },
  })
  if (!open) {
    return (
      <div className="flex flex-col gap-2">
        {save.isSuccess ? <Note ok>Saved. Buyers see the new rating and labels now.</Note> : null}
        <div>
          <Button onClick={() => setOpen(true)}>Change rating and labels</Button>
        </div>
      </div>
    )
  }
  return (
    <form
      className="flex max-w-2xl flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (contentReady(rating, labels) && !save.isPending) save.mutate(rating)
      }}
    >
      <ContentPicker rating={rating} labels={labels} onRating={setRating} onLabels={setLabels} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={!contentReady(rating, labels) || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
    </form>
  )
}

/** A buyer keeps a listing out of their workspace's catalog, search and collections, and can undo it. */
export function BlockListing({ listing }: { listing: Listing }) {
  const qc = useQueryClient()
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: CONTENT_FILTER_KEY })
    void qc.invalidateQueries({ queryKey: CATALOG_KEY })
    void qc.invalidateQueries({ queryKey: DISCOVER_KEY })
  }
  const block = useMutation({ mutationFn: () => marketApi.block(listing.id), onSuccess: refresh })
  const unblock = useMutation({ mutationFn: () => marketApi.unblock(listing.id), onSuccess: () => { block.reset(); refresh() } })
  const failed = block.error ?? unblock.error
  return (
    <div className="flex flex-col gap-2">
      {block.isSuccess ? (
        <>
          <Note ok>Blocked. It no longer shows in your marketplace, search or collections.</Note>
          <div>
            <Button disabled={unblock.isPending} onClick={() => unblock.mutate()}>
              {unblock.isPending ? 'Undoing…' : 'Undo'}
            </Button>
          </div>
        </>
      ) : (
        <div>
          <Button disabled={block.isPending} onClick={() => block.mutate()}>
            {block.isPending ? 'Blocking…' : 'Block this listing'}
          </Button>
        </div>
      )}
      {failed ? <Note ok={false}>{refusalText(failed)}</Note> : null}
    </div>
  )
}

function BlockedRow({ id }: { id: string }) {
  const qc = useQueryClient()
  const listing = useQuery({ queryKey: ['market-listing', id, ''], queryFn: () => marketApi.listing(id) })
  const unblock = useMutation({
    mutationFn: () => marketApi.unblock(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONTENT_FILTER_KEY })
      void qc.invalidateQueries({ queryKey: CATALOG_KEY })
      void qc.invalidateQueries({ queryKey: DISCOVER_KEY })
    },
  })
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-rule py-2">
      <Link className={`text-body text-ink ${inlineLink}`} to={`/marketplace/listings/${encodeURIComponent(id)}`}>
        {listing.data?.title ?? (listing.isPending ? 'Reading…' : 'A listing you can no longer see')}
      </Link>
      <Button disabled={unblock.isPending} onClick={() => unblock.mutate()}>
        {unblock.isPending ? 'Unblocking…' : 'Unblock'}
      </Button>
      {unblock.isError ? <Note ok={false}>{refusalText(unblock.error)}</Note> : null}
    </li>
  )
}

/** /marketplace/content-filter — what this workspace is shown, and the listings it blocked. */
export function ContentFilterPage() {
  const filter = useQuery({ queryKey: CONTENT_FILTER_KEY, queryFn: marketApi.contentFilter })
  return (
    <Region
      index="00"
      label="Content filter"
      heading="What your workspace sees"
      sectionClassName="pb-10 pt-4 wide:pb-12"
      className="flex max-w-2xl flex-col gap-3"
    >
      <p className="text-body text-muted">
        Every listing carries an age rating and labels for what it gives. Listings your filter hides, and listings you
        block, stay out of your marketplace, search and collections. Your own listings always show.
      </p>
      {filter.isPending ? (
        <p className="text-body text-muted">Reading…</p>
      ) : filter.isError ? (
        <Note ok={false}>{readFailure(filter.error, 'Your content filter')}</Note>
      ) : (
        <>
          <FilterForm key={filter.dataUpdatedAt} rating={filter.data.max_age_rating} labels={filter.data.blocked_labels} />
          <Card>
            <div className="flex flex-col gap-2 p-gutter">
              <span className="font-figure text-eyebrow uppercase text-label">Blocked listings</span>
              {filter.data.blocked_listings.length === 0 ? (
                <p className="text-body text-muted">You have not blocked a listing. Block one from its page to stop seeing it.</p>
              ) : (
                <ul aria-label="Blocked listings">
                  {filter.data.blocked_listings.map((id) => (
                    <BlockedRow key={id} id={id} />
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}
    </Region>
  )
}

function FilterForm({ rating: initialRating, labels: initialLabels }: { rating: AgeRating; labels: ContentLabel[] }) {
  const qc = useQueryClient()
  const [rating, setRating] = useState<AgeRating>(initialRating)
  const [labels, setLabels] = useState<ContentLabel[]>(initialLabels)
  const save = useMutation({
    mutationFn: () => marketApi.setContentFilter(rating, labels),
    onSuccess: (f) => {
      qc.setQueryData(CONTENT_FILTER_KEY, f)
      void qc.invalidateQueries({ queryKey: CATALOG_KEY })
      void qc.invalidateQueries({ queryKey: DISCOVER_KEY })
    },
  })
  return (
    <Card>
      <form
        className="flex flex-col gap-4 p-gutter"
        onSubmit={(e) => {
          e.preventDefault()
          if (!save.isPending) save.mutate()
        }}
      >
        <label className="text-caption text-muted">
          Show listings rated for
          <select
            className={selectClass}
            value={rating}
            onChange={(e) => {
              setRating(e.target.value as AgeRating)
              save.reset()
            }}
          >
            {AGE_RATINGS.map(([v, name]) => (
              <option key={v} value={v}>
                {v === 'all' ? `${name} only (family filter)` : `Up to ${v}`}
              </option>
            ))}
          </select>
        </label>
        <LabelBoxes
          legend="Hide listings that give"
          labels={labels}
          onChange={(next) => {
            setLabels(next)
            save.reset()
          }}
        />
        <div>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save filter'}
          </Button>
        </div>
        {save.isSuccess ? <Note ok>Saved. Your marketplace shows only what this filter allows.</Note> : null}
        {save.isError ? <Note ok={false}>{refusalText(save.error)}</Note> : null}
      </form>
    </Card>
  )
}
