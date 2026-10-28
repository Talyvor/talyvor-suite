import { inlineLink } from '@talyvor/ui'
import { useDocumentTitle } from '../../documentTitle'
import { COMPANY_CONTACT } from '../../company'
import { PublicFooter, PublicHeader } from '../../components/SiteChrome'
import { ASSISTANTS } from '../lens/ConnectAI'
import { Eyebrow, TealRule } from '../marketing/Landing'
import { DOCUMENTATION_PATH } from './content'
import listing from './claude-connector.json'

// B40.20 — the public page Claude's connector directory links to: what the Talyvor connector does, how to connect it,
// what to ask, every tool it has, and where privacy and support are. Public, outside the AuthGate, like /documentation.
// The tools are claude-connector.json's, which apps/bff/mcp_directory_test.go holds to the tools the server serves.

const KIND: Record<string, string> = {
  read: 'Reads',
  write: 'Drafts — nothing is sent, saved or signed until you do it in Talyvor',
  send: 'Sends, or puts a payment in front of you to approve',
}

const CLAUDE = ASSISTANTS.find((a) => a.name === 'Claude')


function Part({ id, index, eyebrow, heading, children }: { id: string; index: string; eyebrow: string; heading: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-16 border-b border-rule">
      <div className="mx-auto w-full max-w-5xl px-gutter py-16">
        <Eyebrow index={index}>{eyebrow}</Eyebrow>
        <h2 id={`${id}-heading`} className="mt-6 max-w-2xl text-display-3 text-ink">
          {heading}
        </h2>
        <TealRule className="mt-5" />
        {children}
      </div>
    </section>
  )
}

export function ClaudeConnector() {
  useDocumentTitle('Talyvor for Claude')
  return (
    <div className="flex min-h-full flex-col bg-canvas text-ink">
      <PublicHeader current={DOCUMENTATION_PATH} />

      <main className="flex-1">
        <section aria-labelledby="claude-heading" className="border-b border-rule">
          <div className="mx-auto w-full max-w-5xl px-gutter pb-12 pt-16 wide:pt-20">
            <Eyebrow index="00">Connector</Eyebrow>
            <h1 id="claude-heading" className="mt-7 max-w-3xl text-display-2 text-ink">
              Talyvor in Claude.
            </h1>
            <TealRule className="mt-6" />
            <p className="mt-6 max-w-xl text-lede text-muted">{listing.summary}</p>
            <p className="mt-4 max-w-xl text-reading text-muted">
              Claude prepares; you decide. A payment Claude prepares waits in Talyvor until you approve it there, with
              your passkey.
            </p>
          </div>
        </section>

        <Part id="connect" index="01" eyebrow="Connect" heading="Add Talyvor to Claude.">
          <p className="mt-5 max-w-lg text-reading text-muted">
            The connector&rsquo;s address is <span className="font-mono text-ink">{listing.server}</span>.
          </p>
          <ol className="mt-6 flex max-w-lg list-decimal flex-col gap-2 pl-5 text-reading text-ink">
            {CLAUDE?.steps.map((s) => <li key={s}>{s}</li>)}
          </ol>
          {CLAUDE?.note ? <p className="mt-4 max-w-lg text-caption text-muted">{CLAUDE.note}</p> : null}
          <p className="mt-4 max-w-lg text-reading text-muted">
            See, and end, every assistant you connected in{' '}
            <a href="/settings/connect" className={`text-ink ${inlineLink}`}>
              Settings › Connect your AI
            </a>
            .
          </p>
        </Part>

        <Part id="prompts" index="02" eyebrow="Try asking" heading="Things to ask Claude.">
          <ul className="mt-8 border-b border-rule">
            {listing.examplePrompts.map((p) => (
              <li key={p} className="border-t border-rule py-4 text-reading text-ink">
                &ldquo;{p}&rdquo;
              </li>
            ))}
          </ul>
        </Part>

        <Part id="tools" index="03" eyebrow="Tools" heading={`Every tool, ${listing.tools.length} of them.`}>
          <p className="mt-5 max-w-lg text-reading text-muted">
            No tool pays, pays out or approves. Links Claude shows you open Talyvor at{' '}
            {listing.allowedLinkUris.map((u, i) => (
              <span key={u}>
                {i > 0 ? ' or, on your phone, ' : null}
                <span className="font-mono text-ink">{u}</span>
              </span>
            ))}
            .
          </p>
          <table className="mt-8 w-full text-left">
            <thead>
              <tr className="font-figure text-eyebrow uppercase text-faint">
                <th scope="col" className="py-2 pr-4 font-normal">
                  Tool
                </th>
                <th scope="col" className="hidden py-2 pr-4 font-normal wide:table-cell">
                  What it does
                </th>
                <th scope="col" className="py-2 font-normal">
                  Kind
                </th>
              </tr>
            </thead>
            <tbody>
              {listing.tools.map((t) => (
                <tr key={t.name} className="border-t border-rule align-baseline">
                  <td className="whitespace-nowrap py-2 pr-4 text-caption">
                    <span className="font-mono text-ink">{t.name}</span>
                    {/* On a phone the title sits under the name, not in a column of its own. */}
                    <span className="block text-muted wide:hidden">{t.title}</span>
                  </td>
                  <td className="hidden py-2 pr-4 text-caption text-ink wide:table-cell">{t.title}</td>
                  <td className="py-2 text-caption text-muted">{KIND[t.kind]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Part>

        <Part id="support" index="04" eyebrow="Privacy and support" heading="Your data, and who to ask.">
          <p className="mt-5 max-w-lg text-reading text-muted">
            What Claude can see through Talyvor, and what Talyvor keeps, is in{' '}
            <a href="/privacy#ai-assistants-you-connect" className={`text-ink ${inlineLink}`}>
              Privacy › AI assistants you connect
            </a>
            . For help, write to{' '}
            <a href={`mailto:${COMPANY_CONTACT}`} className={`text-ink ${inlineLink}`}>
              {COMPANY_CONTACT}
            </a>
            .
          </p>
        </Part>
      </main>

      <PublicFooter />
    </div>
  )
}
