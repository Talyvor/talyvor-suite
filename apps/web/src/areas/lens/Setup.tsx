import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Button as TodayButton, inlineLink } from '@talyvor/ui'
import { Button, Card, Icon, showSnack } from '@talyvor/ui/pocket'

import { api } from '../../lib/api'
import { PanelFailure } from '../../components/SessionExpiredBar'
import { StoredAnswersFacts } from '../../components/StoredAnswersFacts'
import { useAuthMeReader } from '../../lib/authMe'
import { DESIGN_ATTR } from '../../pocketPending'
import { DevelopersHead } from './Developers'
import { keysApi, type MintResult, type WorkspaceAPIKey } from './keysApi'
import { KEY_PLACEHOLDER, MECHANISM_CAVEATS, toolsFor, type Tool } from './setupSnippets'

// Setup — the page that was missing. A trial user signed in, minted a key, and was told nothing
// about what to do with it. The product is "point your existing tool at Lens instead of the
// provider" — two environment variables — and no screen, doc, or copy block said so.
//
// THREE THINGS THIS PAGE REFUSES TO DO, each because the alternative wastes the one thing a trial
// user has least of:
//
//  1. It does not print a base URL it cannot verify. The URL comes from /api/context's
//     lens_public_base_url, which is explicitly configured. cfg.lensBaseURL — the address the BFF
//     uses to reach Lens — is a loopback/compose address; printing it would hand every user a URL
//     that cannot resolve. Unset ⇒ this page says so and shows no snippets.
//  2. It does not fake a credential. Lens stores only a hash, so an EXISTING key's plaintext is
//     unrecoverable. Rather than print a realistic-looking placeholder, the page says why and
//     offers to mint a fresh one; the visible placeholder is deliberately not tlv_-shaped.
//  3. It does not claim a savings figure. None is measured (the README dropped its number for the
//     same reason), so the page describes the mechanism and lets the ledger show the number.
//
// TENANCY: the workspace comes from the SESSION — /api/context reads it via sessionWorkspaceID →
// a.tenantFrom(r) — and the key is minted through POST /api/keys, which the BFF scopes to that
// same session tenant. Nothing here is baked at startup; apps/bff/tenant_callsite_test.go fails
// if that regresses, and it should.

// ⚠ THE `?.` THAT USED TO BE HERE WAS THE ONLY PLACE IN THE REPO THAT ANTICIPATED AN ABSENT
// CLIPBOARD, AND IT BOUGHT A QUIETER FAILURE RATHER THAN A HANDLED ONE. It read
// `navigator.clipboard?.writeText(text).then(…)`; optional chaining short-circuits the WHOLE
// chain, so outside a secure context the `.then` was never evaluated and nothing threw — the
// button was simply inert. MEASURED in Chrome on the shipped bundle at
// `http://192.168.100.149:8791`: all FIVE copy buttons on this page clicked in turn, every
// label unchanged, and NOT ONE error raised. `RevealOnce` had no `?.` and threw instead; both
// told the reader exactly the same thing, which was nothing.
/**
 * The copy behind every Copy on this page. Three states, the same as RevealOnce's — not yet, done,
 * and did not happen.
 */
function useCopy(text: string) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  // ⚠ THE RESET MUST NOT OUTLIVE THE COMPONENT. Uncancelled, this 1500ms timer fires
  // `setCopyState` on an unmounted tree; under vitest it fires into a torn-down jsdom and reds the
  // whole RUN with `ReferenceError: window is not defined` while every test passes. Measured as a
  // race: the same commit ran red and then green on CI with no change. `BillingReturn.tsx` already
  // had the correct shape — see src/timerCleanup.test.tsx, which pins both.
  const resetTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(resetTimer.current), [])
  const copy = () => {
    // Synchronous call, `try` for the throw, rejection handler for the refusal — see the note in
    // RevealOnce: awaiting first would move the write out of the click's turn, which is the one
    // thing Safari refuses.
    try {
      void navigator.clipboard.writeText(text).then(
        () => {
          setCopyState('copied')
          window.clearTimeout(resetTimer.current)
          resetTimer.current = window.setTimeout(() => setCopyState('idle'), 1500)
        },
        () => setCopyState('failed'),
      )
    } catch {
      setCopyState('failed')
    }
  }
  return { copyState, copy }
}

const copyFailedNote = 'Couldn’t copy. Select the block above and copy it yourself.'

export function CopyBlock({ text, label }: { text: string; label: string }) {
  const { copyState, copy } = useCopy(text)
  return (
    <div className="space-y-1">
      <pre className="overflow-x-auto rounded-control border border-rule bg-canvas px-3 py-2 font-mono text-ink">
        {text}
      </pre>
      <TodayButton variant="default" onClick={copy}>
        {copyState === 'copied' ? 'Copied' : `Copy ${label}`}
      </TodayButton>
      {/* sr-only in every state, so this announces without moving a pixel — the same seam
          RevealOnce already uses for the same event. */}
      <span aria-live="polite" className="sr-only">
        {copyState === 'copied' ? 'Copied to clipboard' : copyState === 'failed' ? copyFailedNote : ''}
      </span>
      {copyState === 'failed' ? <p className="text-body text-ink">{copyFailedNote}</p> : null}
    </div>
  )
}

/**
 * B57.55 — Pocket's code box (pocket.css .codebox): the code on cloud, Copy beside it. Not the kit's
 * CodeBox, because that one throws where a page is not a secure context and says nothing a screen
 * reader hears; this one keeps CopyBlock's three states. `label` names WHAT is copied for a screen
 * reader, since every button on the page reads Copy.
 */
export function CodeCopy({ text, label, copied }: { text: string; label: string; copied?: string }) {
  const { copyState, copy } = useCopy(text)
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 rounded-control bg-cloud py-2.5 pl-4 pr-2.5">
        <pre className="m-0 min-w-0 whitespace-pre-wrap break-all font-mono text-body font-semibold text-ink">{text}</pre>
        <Button
          variant="secondary"
          size="sm"
          icon={<Icon name="copy" size={16} />}
          aria-label={copyState === 'copied' ? undefined : `Copy ${label}`}
          onClick={copy}
        >
          {copyState === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <span role="status" aria-live="polite" className="sr-only">
        {copyState === 'copied' ? (copied ?? 'Copied to clipboard') : copyState === 'failed' ? copyFailedNote : ''}
      </span>
      {copyState === 'failed' ? (
        <p className="text-body text-ink">{copyFailedNote}</p>
      ) : copyState === 'copied' && copied ? (
        <p className="text-caption text-ink-3">{copied}</p>
      ) : null}
    </div>
  )
}

/** pocket.css .steps2: an ordered list, its numbers in the list's own margin. */
const steps = 'm-0 grid list-decimal gap-1.5 pl-5 text-reading text-ink-2'

function ToolCard({ tool }: { tool: Tool }) {
  return (
    <Card className="grid gap-2">
      <h4 className="font-display text-reading font-bold text-ink">{tool.name}</h4>
      {/* The hazard renders ABOVE the snippet, inside this tool's own card. A page-level
          warning banner is the thing nobody reads before pasting; this one sits between the
          reader and the instruction it qualifies. */}
      {tool.hazard ? (
        <p className="rounded-control bg-page px-3.5 py-2.5 text-body text-ink">
          <strong>Before you paste this:</strong> {tool.hazard}
        </p>
      ) : null}
      {tool.kind === 'env' ? (
        // One box per line, as Pocket draws it: each variable is copied on its own.
        tool.env!.map((v) => <CodeCopy key={v.name} text={`export ${v.name}="${v.value}"`} label={v.name} />)
      ) : (
        <>
          <ol className={steps}>
            {tool.setting!.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <CodeCopy text={tool.copyText} label="the address" />
        </>
      )}
      {tool.alternative ? (
        <div className="grid gap-1.5">
          <p className="text-body font-semibold text-ink">{tool.alternative.title}</p>
          <CodeCopy text={tool.alternative.code} label="the example" />
        </div>
      ) : null}
      {tool.note ? <p className="text-caption text-ink-3">{tool.note}</p> : null}
    </Card>
  )
}

const cardHeading = 'font-display text-reading font-bold text-ink'

export function Setup() {
  const qc = useQueryClient()
  const [minted, setMinted] = useState<MintResult | null>(null)
  // ⚠ "STORED" IS A CLAIM ONLY THE USER CAN MAKE. The page cannot detect that a secret reached a
  // password manager, and a copy-button click is not the same thing either — people copy, then
  // paste somewhere that eats it. So this tracks an explicit acknowledgement and nothing infers it.
  const [stored, setStored] = useState(false)
  // While a minted secret is on screen and unacknowledged, the page must not point anywhere else.
  const unstoredSecret = minted !== null && !stored

  const ctx = useQuery({ queryKey: ['context'], queryFn: api.context, staleTime: 60_000 })
  const keys = useQuery({ queryKey: ['keys'], queryFn: keysApi.list })
  // Same query key the Settings screen uses, so the two never disagree.
  const me = useAuthMeReader()

  const mint = useMutation({
    mutationFn: () => keysApi.mint('Setup', ['proxy']),
    onSuccess: (res) => {
      setMinted(res)
      // A second mint is a second unstored secret. Carrying the previous acknowledgement forward
      // would leave the new key exposed to exactly the flow that lost the first one.
      setStored(false)
      showSnack({ title: 'Here it is, once', line: 'Copy it now: Talyvor keeps a hash, not the key.' })
      void qc.invalidateQueries({ queryKey: ['keys'] })
    },
  })

  // The customer-facing origin. NOT ctx.data.lens_base_url — see the header note.
  //
  // ⚠⚠ THIS WAS ONE EMPTY STRING STANDING FOR THREE DIFFERENT FACTS, AND THE SCREEN PRINTED THE
  // WORST OF THEM. `ctx.data` is undefined while the request is IN FLIGHT and when it FAILED, as
  // well as when the deployment genuinely publishes no URL — and all three rendered "This
  // deployment has no public Lens URL configured … ask your operator to set LENS_PUBLIC_BASE_URL".
  // So the first thing a brand-new trial user saw on the screen first run routes them to
  // (FirstRunGaps.test.tsx) was an accusation about their operator's configuration, printed before
  // this page had read anything — on EVERY visit, for the duration of the fetch, and permanently
  // whenever the read failed. It is the same conflation lib/productState.ts records for the Docs
  // probe (our routing bug rendered as the operator's misconfiguration, sending them to check env
  // vars that were correct) and the same one W1.1.1 kept out of Overview's first-run rule.
  //
  // The three states are now distinct and each is rendered as what it is. `answered` is the only
  // one that may make a claim about the DEPLOYMENT; the other two are claims about this page.
  const publicBase = ctx.data?.lens_public_base_url ?? ''
  const baseUrlState: 'reading' | 'unreadable' | 'unset' | 'ready' = ctx.isError
    ? 'unreadable'
    : !ctx.data
      ? 'reading'
      : publicBase === ''
        ? 'unset'
        : 'ready'
  const existing: WorkspaceAPIKey[] = keys.data ?? []
  // The RECORDED sharing consent, read from Lens via /auth/me — never a hardcoded default.
  //
  // This page first shipped asserting "cross-tenant pooling is OFF unless you turn it on". #33
  // then reversed the default (the BFF sends no field at provision, so Lens's default of true
  // applies), and that sentence became false — in a privacy disclosure, shown to someone deciding
  // whether to route their company's traffic through us. Rendering the recorded value instead of
  // either default is the only version that cannot go stale when the default moves again.
  // undefined ⇒ say nothing and point at the setting; do not guess.
  const sharing = me.data?.cache_poolable

  // The credential to inline. Only a key minted in THIS session has plaintext; anything else is
  // a hash server-side, so the placeholder stands in and the page explains why.
  const credential = minted?.key ?? ''
  const tools = toolsFor(publicBase, credential)

  // W1.1.2 — the page is an ordered task: get a credential, point a tool, prove it. B57.55 draws it
  // as Pocket's w-dev does: that task down the wide column, and what Talyvor does with the traffic
  // and where the mechanism stops beside it, so both are read before anything is pasted.
  return (
    <div {...{ [DESIGN_ATTR]: 'pocket' }} className="grid gap-5 px-gutter py-4 wide:py-6">
      <DevelopersHead
        heading="Point your tools at Talyvor."
        line="You change where requests go, not your code or your model names. Talyvor forwards each request, records what it cost, and serves a repeat of the same request from its cache."
      />
      {/* The workspace this session signed in to. It renders only once it is KNOWN — an em dash
          in the slot said "your workspace is —", which is not a thing anyone can act on. */}
      {ctx.data ? (
        <p className="-mt-2 text-caption text-ink-3">
          Workspace <span className="font-mono">{ctx.data.workspace_id}</span>, the one this session signed in to. Keys you
          make here belong to it.
        </p>
      ) : null}

      <div className="grid items-start gap-4 wide:grid-cols-12">
        <div className="grid gap-4 wide:col-span-8">
          <Card tone="white" className="grid gap-2">
            <h3 className={cardHeading}>Your key</h3>
            {minted && !stored ? (
              // ⚠ THIS SENTENCE IS PART OF WHAT WENT WRONG. It once said "filled into the blocks
              // below … Copy the block now", which was true and useless: it pointed at snippets
              // further down instead of at the secret. It points at the box directly beneath it, and
              // says the one consequence that matters rather than restating the mechanism.
              <>
                <p className="text-reading text-ink-2">
                  <strong className="text-ink">Your key, shown once.</strong> Copy it now: Talyvor keeps a hash, not the key, so
                  nobody can show it to you again, and a key you did not copy has to be replaced rather than recovered.
                </p>
                <CodeCopy text={minted.key} label="key" copied="Copied. Store it now: it will not be shown again" />
                <p className="text-caption text-ink-3">
                  Identifier, not a credential: <span className="font-mono">{minted.prefix}</span>. Safe to share; this is how the
                  key appears in lists.
                </p>
                <div>
                  <Button
                    size="sm"
                    onClick={() => {
                      setStored(true)
                      showSnack({ title: 'Stored', line: 'The blocks below carry your key.' })
                    }}
                  >
                    Done, I stored it
                  </Button>
                </div>
              </>
            ) : minted ? (
              <p className="text-reading text-ink-2">
                Your key is in the blocks below. <span className="font-mono">{minted.prefix}</span>
              </p>
            ) : existing.length > 0 ? (
              <>
                <p className="text-reading text-ink-2">
                  You already have {existing.length === 1 ? 'a key' : `${existing.length} keys`}, but a key is shown{' '}
                  <strong className="text-ink">only once</strong>, at the moment it is made. Talyvor stores a hash, so it cannot
                  be shown again. If you still have it, paste it over the placeholder below. If not, make a fresh one.
                </p>
                <ul className="grid gap-0.5 text-caption text-ink-3">
                  {existing.map((k) => (
                    <li key={k.id}>
                      <span className="font-mono">{k.key_prefix}</span> · {k.name} (identifier, not a credential)
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-reading text-ink-2">You do not have a key yet. Make one and it will be filled into every block below.</p>
            )}
            {minted && !stored ? null : (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={() => mint.mutate()} disabled={mint.isPending}>
                  {mint.isPending ? 'Creating…' : 'Create a key for setup'}
                </Button>
                {/* ⚠ THE LINK IS WITHHELD WHILE AN UNACKNOWLEDGED SECRET IS ON SCREEN. It sat beside the
                    button someone just pressed, so the nearest control was the one that destroys what
                    pressing it produced. The sidebar, the back button and a reload all still work; what
                    is removed is the PRODUCT'S OWN INVITATION to leave. */}
                {!unstoredSecret ? (
                  <Link className={`text-body font-semibold text-ink ${inlineLink}`} to="/keys">
                    Manage keys
                  </Link>
                ) : null}
              </div>
            )}
            {mint.isError ? (
              <p className="text-body text-ink">Couldn’t create a key. Nothing was changed. Try again, or use API keys.</p>
            ) : null}
          </Card>

          <h3 className="font-display text-head font-bold text-ink">Point your tool</h3>
          {/* ⚠ FOUR STATES, AND ONLY ONE OF THEM MAY TALK ABOUT THE DEPLOYMENT. See §publicBase
              above: this used to be a single `publicBase === ''` test, so a read that had not
              happened yet and a read that FAILED both rendered as a settled fact about somebody
              else's configuration. */}
          {baseUrlState === 'reading' ? (
            <Card>
              <p className="text-body text-ink-2">Reading this deployment’s settings…</p>
            </Card>
          ) : baseUrlState === 'unreadable' ? (
            <Card className="grid gap-2">
              {/* The shared failure voice: a panel knows its own request failed and cannot know
                  whether every other panel failed for the same reason, so it must not name a cause. */}
              <PanelFailure error={ctx.error} what="this deployment’s settings" />
              <p className="text-caption text-ink-3">
                The blocks are withheld because the address is UNKNOWN, not because it is missing. Reload, and if it keeps
                failing the setting is not the thing to check.
              </p>
            </Card>
          ) : baseUrlState === 'unset' ? (
            <Card className="grid gap-1">
              <h4 className={cardHeading}>Setup instructions unavailable</h4>
              <p className="text-body text-ink-2">
                This deployment has no public Lens URL configured, so we cannot tell you which address to use, and a guessed
                one would fail with an error that looks like a bad key. Ask your operator to set{' '}
                <span className="font-mono">LENS_PUBLIC_BASE_URL</span> on the app, then reload.
              </p>
            </Card>
          ) : (
            <>
              {!minted ? (
                <p className="text-caption text-ink-3">
                  The blocks below show <span className="font-mono">{KEY_PLACEHOLDER}</span> where your key goes. Make a key
                  above to have it filled in.
                </p>
              ) : null}
              {tools.map((t) => (
                <ToolCard key={t.id} tool={t} />
              ))}
            </>
          )}

          <Card tone="white" className="grid gap-2">
            <h3 className={cardHeading}>Confirm it worked: two requests</h3>
            <ol className={steps}>
              <li>
                <strong className="text-ink">Send one request</strong> from the tool you just set up. Anything: “write me a
                haiku about caching”.
              </li>
              <li>
                <strong className="text-ink">
                  Open the{' '}
                  <Link className={`text-ink ${inlineLink}`} to="/ledger">
                    ledger
                  </Link>
                  .
                </strong>{' '}
                Within a few seconds a row appears for it, with what it cost. That row is the proof your traffic is flowing
                through Talyvor: no row means the request never arrived, and the base URL is the first thing to check.
              </li>
              <li>
                <strong className="text-ink">Send the same request again.</strong> The second one is a cache hit: a new row at
                no cost, answered without going to the provider at all. That is the mechanism, in two requests: the first one
                pays, the repeat does not.
              </li>
            </ol>
            <p className="text-body text-ink-3">
              How much this saves depends entirely on how much your traffic repeats, so we do not print a number here. The
              ledger shows yours.
            </p>
          </Card>
        </div>

        <div className="grid gap-4 wide:col-span-4">
          <Card className="grid gap-2">
            <h3 className={cardHeading}>What Talyvor does with your traffic</h3>
            <p className="text-body text-ink-2">
              You are about to route AI requests through a third party, so here is what happens to them, before you paste
              anything.
            </p>
            <ul className="m-0 grid list-disc gap-1.5 pl-5 text-body text-ink-2">
              <li>
                <strong className="text-ink">What is stored.</strong> To serve a repeat request from cache, Talyvor stores the
                answer that came back, with the question it answered.
                <StoredAnswersFacts className="mt-1 text-body text-ink-2" />
                Under <em>none</em> this workspace&rsquo;s own cache is off: a repeated question goes to the model and is paid
                for again. Answers other companies chose to share can still be served.
              </li>
              {/* ⚠ THIS SAID LOGGING WAS "who called what, when, and what it cost" AND STOPPED —
                  which describes the DEFAULT setting and reads as though prompt text is never
                  persisted. Under the `full` setting Lens writes prompt_text to token_events AND
                  publishes the raw prompt and response to a 30-day stream (proxy.go gates both on
                  LoggingFull). The Privacy page has always said so. */}
              <li>
                <strong className="text-ink">Logging is separate and configurable.</strong> On the default setting the audit
                trail is metadata (who called what, when, and what it cost) and the log does not keep the prompt text. There is
                a <em>full</em> setting that does keep prompt text, and also sends the prompt and the answer to a 30-day stream.
                Nothing in this app turns it on, but an operator can, and you would not be able to tell from here. The{' '}
                <em>none</em> setting keeps nothing: not in the log, and not in the cache.
              </li>
              <li>
                <strong className="text-ink">
                  {sharing === true
                    ? 'Sharing is currently ON for this workspace.'
                    : sharing === false
                      ? 'Sharing is currently OFF for this workspace.'
                      : 'Sharing: check the setting for this workspace.'}
                </strong>{' '}
                {sharing === true
                  ? 'Answers generated here may be served to other companies. One click turns it off.'
                  : sharing === false
                    ? 'Nothing new generated here is shared. Answers shared before stay available to others, and keep earning, until you delete them in Features.'
                    : 'We could not read the recorded value, so we will not guess at it.'}{' '}
                <Link className={`text-ink ${inlineLink}`} to="/settings">
                  {sharing === undefined ? 'See the setting' : 'Change it'}
                </Link>
                .
              </li>
              <li>
                <strong className="text-ink">Your prompts are never served to another company.</strong> Even with pooling on,
                what can be shared is an <em>answer</em> to a semantically equivalent question, never your prompt, never your
                key, never your workspace’s identity. But an answer often restates the question it answered, so the fact to
                plan around is <em>the answer leaves this workspace</em>, not <em>the prompt does not</em>.
              </li>
            </ul>
          </Card>

          {/* ⚠ THE CAVEATS ARE NOT BEHIND THE BASE URL. They describe what Talyvor does and does not
              forward, which is true of the mechanism whatever this deployment publishes, so the reader
              who cannot set up yet still sees what will break. */}
          <Card className="grid gap-2">
            <h3 className={cardHeading}>Worth knowing</h3>
            <ul className="m-0 grid list-disc gap-1.5 pl-5 text-body text-ink-2">
              {MECHANISM_CAVEATS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  )
}
