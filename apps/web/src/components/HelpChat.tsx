import { useEffect, useId, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, CloseX, Icon, Input, Layer, pocketFocusRing } from '@talyvor/ui/pocket'
import { cn, inlineLink } from '@talyvor/ui'
import {
  HELP_BY,
  HELP_CHAT_KEY,
  HelpLimitError,
  type HelpMessage,
  askHelp,
  helpMailto,
  sendHelpToTeam,
  useHelpChat,
} from '../areas/lens/helpChat'
import { useFirstName } from '../areas/lens/Home'
import { useWorkspaceAreas } from '../lib/workspaceAreas'

// HelpChat.tsx — B61.38: the Help panel, opened by Help at the bottom right of every signed-in page and from Settings, Help.
// Answers are written by AI from Talyvor's own help pages; when it does not know, or the question is one our team
// answers, the reply offers "Send it to our team", which files the chat so far in the help inbox and opens the person's
// own email to Talyvor with their question. A line from our team says so, so our team can answer in the same panel.
// B57.175 — drawn as Pocket Live's Help box (design/pocket-live, web view help): Help floats at the bottom right, the
// box opens above it, Help greets the person, offers three questions to start, and the chat is bubbles over a pill.

export const HELP_PARAM = 'help'

/** Pocket Live's three questions to start with, asked as they are written. */
export const HELP_STARTERS = ['How do approvals work?', 'How do I pause an agent?', 'How do I add money?']

/** Help's first line, by the person's first name when it is known. */
export const helpGreeting = (firstName: string) => `Hi${firstName ? ` ${firstName}` : ''}. Ask me how anything in Talyvor works.`

/** The address that opens the Help panel over `pathname`. */
export const helpHref = (pathname: string, search = '') => {
  const q = new URLSearchParams(search)
  q.set(HELP_PARAM, 'open')
  return `${pathname}?${q.toString()}`
}

/** Help, at the bottom right of every signed-in page (Pocket Live's .wb .help). Taly's button takes the corner where
 * the workspace has Chat, so Help sits beside it there. */
export function HelpButton() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const beside = useWorkspaceAreas().has('chat')
  return (
    // Its own landmark, as it sits outside the page's main and the top bar.
    <aside aria-label="Help">
    <button
      type="button"
      onClick={() => navigate(helpHref(pathname, search))}
      className={cn(
        'fixed bottom-5.5 z-30 flex h-10 items-center gap-2 rounded-pill bg-primary px-4 text-body font-semibold text-on-primary shadow-pocket',
        beside ? 'right-20' : 'right-5.5',
        'transition-press active:scale-97',
        pocketFocusRing,
      )}
    >
      <Icon name="chat" size={18} />
      Help
    </button>
    </aside>
  )
}

/** The panel, while the address asks for it. `pageName` names a page of the app by its path. */
export function HelpChatHost({ pageName }: { pageName: (path: string) => string }) {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  if (new URLSearchParams(search).get(HELP_PARAM) !== 'open') return null
  const close = () => {
    const q = new URLSearchParams(search)
    q.delete(HELP_PARAM)
    const rest = q.toString()
    navigate({ pathname, search: rest ? `?${rest}` : '' }, { replace: true })
  }
  return <HelpChat page={pathname} pageName={pageName} onClose={close} />
}

// Pocket Live's .bub (16 round, the tail corner 12): Help's lines in cloud on the left, the person's in ink on the right.
const bubble = 'whitespace-pre-line rounded-inset px-3.5 py-2.5 text-body'

function Line({ m, pageName }: { m: HelpMessage; pageName: (path: string) => string }) {
  const mine = m.by === 'you'
  return (
    <li data-testid={`help-${m.by}`} className={cn('grid gap-1', mine ? 'justify-items-end pl-12' : 'justify-items-start pr-12')}>
      {/* Who wrote it: said aloud for every line, and shown for our team's, which is a person and not the AI. */}
      <span className={m.by === 'team' ? 'text-caption font-semibold text-ink-2' : 'sr-only'}>{HELP_BY[m.by]}</span>
      <p className={cn(bubble, mine ? 'rounded-br-tile bg-primary text-on-primary' : 'rounded-bl-tile bg-cloud text-ink')}>{m.text}</p>
      {m.page ? (
        <Link to={m.page} className={cn(inlineLink, 'text-body font-semibold text-ink')}>
          Open {pageName(m.page)}
        </Link>
      ) : null}
    </li>
  )
}

export function HelpChat({ page, pageName, onClose }: { page: string; pageName: (path: string) => string; onClose: () => void }) {
  const heading = useId()
  const qc = useQueryClient()
  const chat = useHelpChat()
  const firstName = useFirstName()
  const [question, setQuestion] = useState('')
  const [limit, setLimit] = useState('')
  const [sent, setSent] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const messages = chat.data ?? []
  const ask = useMutation({
    mutationFn: (q: string) => askHelp(q, page),
    onMutate: () => {
      setLimit('')
      setSent('')
    },
    onSuccess: (msgs) => {
      qc.setQueryData(HELP_CHAT_KEY, msgs)
      setQuestion('')
    },
    onError: (err) => {
      if (err instanceof HelpLimitError) {
        qc.setQueryData(HELP_CHAT_KEY, err.messages)
        setLimit(err.sentence)
        setQuestion('')
      }
    },
  })
  const asked = [...messages].reverse().find((m) => m.by === 'you')?.text ?? ''
  const team = useMutation({
    mutationFn: sendHelpToTeam,
    onSuccess: () => {
      const mail = helpMailto(asked)
      setSent(mail)
      window.open(mail, '_self')
    },
  })
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' })
  }, [messages.length, limit, sent, ask.isPending])
  const last = messages[messages.length - 1]
  const offerTeam = !sent && (limit !== '' || (last?.by === 'ai' && last.team === true && last.topic !== 'complaint'))
  const offerComplaint = !sent && last?.by === 'ai' && last.topic === 'complaint'
  const send = (q: string) => {
    if (q.trim() !== '' && !ask.isPending) ask.mutate(q.trim())
  }

  return (
    <Layer labelledBy={heading} onClose={onClose} position="corner">
      <div
        data-testid="help-chat"
        className="relative flex max-h-120 w-full flex-col overflow-hidden rounded-t-sheet bg-page shadow-pocket-lg wide:h-120 wide:w-105 wide:rounded-card"
      >
        <div className="flex items-center gap-3 border-b border-line py-3.5 pl-4 pr-3">
          <div className="grid min-w-0 flex-1">
            <h2 id={heading} className="font-display text-head font-bold text-ink">
              Help
            </h2>
            <p className="text-caption text-ink-2">Answers are written by AI.</p>
          </div>
          <CloseX onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3.5">
          <ol aria-label="The chat" className="grid gap-2">
            <li data-testid="help-hello" className="grid justify-items-start pr-12">
              <p className={cn(bubble, 'rounded-bl-tile bg-cloud text-ink')}>{helpGreeting(firstName)}</p>
            </li>
            {messages.map((m, i) => (
              <Line key={`${m.at}-${i}`} m={m} pageName={pageName} />
            ))}
            {ask.isPending ? (
              <li className="grid justify-items-start">
                <p role="status" className={cn(bubble, 'flex gap-1 rounded-bl-tile bg-cloud py-3.5')}>
                  <span className="sr-only">Writing an answer…</span>
                  {[0, 1, 2].map((d) => (
                    <span key={d} aria-hidden="true" className="h-1.75 w-1.75 rounded-pill bg-ink-3" />
                  ))}
                </p>
              </li>
            ) : null}
          </ol>
          {chat.isError ? <p className="mt-2 text-body text-ink-2">The chat could not be read. You can still ask.</p> : null}
          {asked === '' && !ask.isPending ? (
            <div className="mt-2 grid justify-items-start gap-2">
              {HELP_STARTERS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send(q)}
                  className={cn('h-9 rounded-pill bg-cloud-2 px-3.5 text-body font-semibold text-ink transition-press active:scale-97', pocketFocusRing)}
                >
                  {q}
                </button>
              ))}
            </div>
          ) : null}
          {limit ? (
            <p role="alert" className="mt-3 text-body text-ink">
              {limit}
            </p>
          ) : null}
          {ask.isError && !(ask.error instanceof HelpLimitError) ? (
            <p role="alert" className="mt-3 text-body text-danger">
              Help could not answer just now. You can try again.
            </p>
          ) : null}
          {offerTeam ? <p className="mt-3 text-body text-ink-2">We answer by email.</p> : null}
          {offerComplaint ? (
            <div className="mt-3">
              <Button asChild size="sm" variant="secondary">
                <Link to="/settings/help?kind=complaint">Make a complaint</Link>
              </Button>
            </div>
          ) : null}
          {sent ? (
            <div role="status" className="mt-3 grid gap-1 text-body text-ink-2">
              <p>Sent to our team. We answer by email.</p>
              <a href={sent} className={cn(inlineLink, 'font-semibold text-ink')}>
                Open the email again
              </a>
            </div>
          ) : null}
          <div ref={end} />
        </div>
        <div className="grid gap-1.5 px-3 pb-3 pt-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              send(question)
            }}
          >
            <Input
              aria-label="Your question"
              className="h-11 rounded-pill pr-1"
              maxLength={4000}
              value={question}
              placeholder="Ask a question"
              autoComplete="off"
              onChange={(e) => setQuestion(e.target.value)}
              unit={
                <button
                  type="submit"
                  aria-label="Ask"
                  disabled={question.trim() === '' || ask.isPending}
                  aria-describedby={question.trim() === '' ? `${heading}-write` : undefined}
                  className={cn(
                    'grid h-9 w-9 place-items-center rounded-pill bg-primary text-on-primary transition-press active:scale-97 disabled:cursor-not-allowed disabled:opacity-50',
                    pocketFocusRing,
                  )}
                >
                  <Icon name="send" size={16} />
                </button>
              }
            />
            <span id={`${heading}-write`} className="sr-only">
              Write your question first.
            </span>
          </form>
          {sent ? null : offerTeam ? (
            <Button size="sm" className="justify-self-center" disabled={team.isPending} onClick={() => team.mutate()}>
              {team.isPending ? 'Sending…' : 'Send it to our team'}
            </Button>
          ) : (
            <button
              type="button"
              disabled={asked === '' || team.isPending}
              aria-describedby={asked === '' ? `${heading}-first` : undefined}
              onClick={() => team.mutate()}
              className={cn('justify-self-center rounded-pill px-3 py-1.5 text-body font-semibold text-ink-2 disabled:cursor-not-allowed disabled:opacity-50', pocketFocusRing)}
            >
              {team.isPending ? 'Sending…' : 'Send it to our team'}
            </button>
          )}
          {asked === '' && !sent ? (
            <span id={`${heading}-first`} className="sr-only">
              Ask your question first.
            </span>
          ) : null}
          {team.isError ? (
            <p role="alert" className="text-center text-body text-danger">
              Nothing was sent. You can try again.
            </p>
          ) : null}
        </div>
      </div>
    </Layer>
  )
}
