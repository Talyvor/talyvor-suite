import { Link } from 'react-router-dom'
import { inlineLink } from '@talyvor/ui'
import { type DocRef, pageHref, useDocsNav } from './docsNav'

/**
 * B10.6 — the pages a person PINNED and the last five they OPENED, never every page. B57.8 took them out of the
 * sidebar, which is Pocket's rows only, so the Docs home lists them: a pinned page is one click from Docs.
 */
export function PinnedRecent() {
  const nav = useDocsNav()
  // No words when there are none: this claims nothing about an empty list, so a pins read that failed draws the same
  // nothing, and the space list beside it says whether Docs could be read.
  const any = nav.pinned.length > 0 || nav.recent.length > 0
  if (!any) return null
  const list = (title: string, refs: readonly DocRef[]) =>
    refs.length > 0 ? (
      <nav aria-label={`${title} pages`} className="flex flex-col gap-1">
        <p className="text-caption text-faint">{title}</p>
        {refs.map((d) => (
          <Link key={`${d.spaceId}/${d.pageId}`} className={inlineLink} to={pageHref(d)}>
            {d.title}
          </Link>
        ))}
      </nav>
    ) : null
  return (
    <div className="mt-6 flex flex-wrap gap-8">
      {list('Pinned', nav.pinned)}
      {list('Recent', nav.recent)}
    </div>
  )
}
