import { inlineLink } from '@talyvor/ui'
import { Card, CodeBox, Eyebrow } from '@talyvor/ui/pocket'
import { useDocumentTitle } from '../../documentTitle'
import { COMPANY_CONTACT } from '../../company'
import { PublicFooter, PublicHeader } from '../../components/SiteChrome'
import { ASSISTANTS } from '../lens/ConnectAI'
import { DOCUMENTATION_PATH } from './content'
import listing from './claude-connector.json'

// B40.20 — the public page Claude's connector directory links to: what the Talyvor connector does, how to connect it,
// what to ask, every tool it has, and where privacy and support are. Public, outside the AuthGate, like /documentation.
// The tools are claude-connector.json's, which apps/bff/mcp_directory_test.go holds to the tools the server serves.
// B57.63 — drawn in Pocket (design/pocket s-claude): one narrow column of white cards on the page.

const KIND: Record<string, string> = {
  read: 'Reads',
  write: 'Drafts: nothing is sent, saved or signed until you do it in Talyvor',
  send: 'Sends, or puts a payment in front of you to approve',
}

const CLAUDE = ASSISTANTS.find((a) => a.name === 'Claude')


/** One white card on the page, its heading in the display face. */
function Part({ id, heading, children }: { id: string; heading: string; children: React.ReactNode }) {
  return (
    <Card tone="white" id={id} aria-labelledby={`${id}-heading`} role="region" className="mt-4 scroll-mt-16">
      <h2 id={`${id}-heading`} className="font-display text-head font-bold text-ink">
        {heading}
      </h2>
      {children}
    </Card>
  )
}

export function ClaudeConnector() {
  useDocumentTitle('Talyvor for Claude')
  return (
    <div data-design="pocket" className="flex min-h-full flex-col bg-page text-ink">
      <PublicHeader current={DOCUMENTATION_PATH} />

      <main className="flex-1">
        {/* pocket.css .ssec.narrow: one narrow column. */}
        <section aria-labelledby="claude-heading" className="mx-auto w-full max-w-4xl px-gutter pt-14">
          <Eyebrow>Connector</Eyebrow>
          <h1 id="claude-heading" className="mt-3 font-display text-display-1 font-extrabold text-ink">
            Talyvor in Claude
          </h1>
          <p className="mt-3 max-w-2xl text-lede text-ink-2">
            Claude prepares, and you decide. A payment Claude prepares waits in Talyvor until you approve it there, with
            your passkey.
          </p>
          <p className="mt-3 max-w-2xl text-body text-ink-3">{listing.summary}</p>

          <Part id="connect" heading="Add Talyvor to Claude">
            <p className="mt-1 text-body text-ink-2">The connector&rsquo;s address:</p>
            <CodeBox code={listing.server} copied="Copied the address" className="mt-2" />
            <ol className="mt-2 flex list-decimal flex-col gap-2 pl-5 text-reading text-ink">
              {CLAUDE?.steps.map((s) => <li key={s}>{s}</li>)}
            </ol>
            {CLAUDE?.note ? <p className="mt-3 text-body text-ink-3">{CLAUDE.note}</p> : null}
            <p className="mt-3 text-body text-ink-2">
              See, and end, every assistant you connected in{' '}
              <a href="/settings/connect" className={`font-semibold text-ink ${inlineLink}`}>
                Settings › Connect your AI
              </a>
              .
            </p>
          </Part>

          <Part id="tools" heading="What it can do">
            <p className="mt-1 text-body text-ink-2">
              Every tool, <span className="font-figure">{listing.tools.length}</span> of them. No tool pays, pays out or
              approves. Links Claude shows you open Talyvor at{' '}
              {listing.allowedLinkUris.map((u, i) => (
                <span key={u}>
                  {i > 0 ? ' or, on your phone, ' : null}
                  <span className="font-mono text-ink">{u}</span>
                </span>
              ))}
              .
            </p>
            <table className="mt-3 w-full text-left">
              <thead>
                <tr className="text-micro font-semibold text-ink-3">
                  <th scope="col" className="py-2 pr-4">
                    Tool
                  </th>
                  <th scope="col" className="hidden py-2 pr-4 wide:table-cell">
                    What it does
                  </th>
                  <th scope="col" className="py-2">
                    Kind
                  </th>
                </tr>
              </thead>
              <tbody>
                {listing.tools.map((t) => (
                  <tr key={t.name} className="border-t border-line align-baseline">
                    <td className="whitespace-nowrap py-2 pr-4 text-body">
                      <span className="font-mono text-ink">{t.name}</span>
                      {/* On a phone the title sits under the name, not in a column of its own. */}
                      <span className="block whitespace-normal text-ink-3 wide:hidden">{t.title}</span>
                    </td>
                    <td className="hidden py-2 pr-4 text-body text-ink wide:table-cell">{t.title}</td>
                    <td className="py-2 text-body text-ink-3">{KIND[t.kind]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Part>

          <Part id="prompts" heading="Things to ask Claude">
            <ul className="mt-2">
              {listing.examplePrompts.map((p) => (
                <li key={p} className="border-t border-line py-3 text-reading text-ink first:border-t-0">
                  &ldquo;{p}&rdquo;
                </li>
              ))}
            </ul>
          </Part>

          <p id="support" className="mt-4 scroll-mt-16 text-body text-ink-3">
            Your data, and who to ask: what Claude can see through Talyvor, and what Talyvor keeps, is in{' '}
            <a href="/privacy#ai-assistants-you-connect" className={`text-ink ${inlineLink}`}>
              Privacy › AI assistants you connect
            </a>
            . For help, write to{' '}
            <a href={`mailto:${COMPANY_CONTACT}`} className={`text-ink ${inlineLink}`}>
              {COMPANY_CONTACT}
            </a>
            .
          </p>
        </section>
      </main>

      <PublicFooter />
    </div>
  )
}
