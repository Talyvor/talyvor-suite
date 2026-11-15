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

// HelpChat.tsx — B61.38: the Help panel, opened by Help in the top bar of every signed-in page and from Settings, Help.
// Answers are written by AI from Talyvor's own help pages; when it does not know, or the question is one our team
// answers, the reply offers "Send to our team", which files the chat so far in the help inbox and opens the person's
// own email to Talyvor with their question. Each line says who wrote it, so our team can answer in the same panel.
// It opens over whichever page ?help=open is on, in the corner Pocket gives Taly.

export const HELP_PARAM = 'help'

/** The address that opens the Help panel over `pathname`. */
export const helpHref = (pathname: string, search = '') => {
  const q = new URLSearchParams(search)
  q.set(HELP_PARAM, 'open')
  return `${pathname}?${q.toString()}`
}

/** Help, in the top bar: below 840 its icon alone, so the bar fits 390. */
export function HelpButton() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  return (
    <button
      type="button"
      aria-label="Help"
      onClick={() => navigate(helpHref(pathname, search))}
      className={cn(
        'flex h-9 shrink-0 items-center gap-1.5 rounded-pill bg-cloud px-2.5 text-body font-semibold text-ink wide:px-3.5',
        'transition-colors duration-200 active:scale-98',
        pocketFocusRing,
      )}
    >
      <Icon name="chat" size={16} />
      <span className="hidden wide:inline">Help</span>
    </button>
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

function Line({ m, pageName }: { m: HelpMessage; pageName: (path: string) => string }) {
  const mine = m.by === 'you'
  return (
    <li data-testid={`help-${m.by}`} className={cn('grid gap-1', mine ? 'ml-10 justify-self-end text-right' : 'mr-10 justify-self-start')}>
      <span className="text-caption font-semibold text-ink-3">{HELP_BY[m.by]}</span>
      <p className={cn('whitespace-pre-line rounded-card-tight px-3.5 py-2.5 text-left text-body', mine ? 'bg-cloud text-ink' : 'bg-page text-ink shadow-pocket')}>
        {m.text}
      </p>
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
  }, [messages.length, limit, sent])
  const last = messages[messages.length - 1]
  const offerTeam = !sent && (limit !== '' || (last?.by === 'ai' && last.team === true && last.topic !== 'complaint'))
  const offerComplaint = !sent && last?.by === 'ai' && last.topic === 'complaint'

  return (
    <Layer labelledBy={heading} onClose={onClose} position="corner">
      <div
        data-testid="help-chat"
        className="relative flex w-full flex-col rounded-t-sheet bg-page shadow-pocket-lg wide:w-105 wide:rounded-card"
      >
        <div className="grid gap-1 border-b border-line px-5 pb-3.5 pt-5">
          <CloseX onClose={onClose} className="absolute right-4 top-4" />
          <h2 id={heading} className="pr-10 font-display text-pocket-dialog text-ink">
            Help
          </h2>
          <p className="text-reading text-ink-2">Ask us anything about Talyvor.</p>
          <p className="text-caption text-ink-3">Answers are written by AI.</p>
        </div>
        <div className="max-h-96 overflow-y-auto px-5 py-4">
          {chat.isError ? <p className="text-body text-ink-2">The chat could not be read. You can still ask.</p> : null}
          <ol aria-label="The chat" className="grid gap-3">
            {messages.map((m, i) => (
              <Line key={`${m.at}-${i}`} m={m} pageName={pageName} />
            ))}
          </ol>
          {ask.isPending ? <p className="mt-3 text-body text-ink-3">Writing an answer…</p> : null}
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
          {offerTeam ? (
            <div className="mt-3 grid justify-items-start gap-2">
              <p className="text-body text-ink-2">We answer by email.</p>
              <Button size="sm" disabled={team.isPending} onClick={() => team.mutate()}>
                {team.isPending ? 'Sending…' : 'Send to our team'}
              </Button>
              {team.isError ? (
                <p role="alert" className="text-body text-danger">
                  Nothing was sent. You can try again.
                </p>
              ) : null}
            </div>
          ) : null}
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
        <form
          className="flex items-center gap-2 border-t border-line px-5 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (question.trim() !== '' && !ask.isPending) ask.mutate(question.trim())
          }}
        >
          <Input
            aria-label="Your question"
            className="flex-1"
            maxLength={4000}
            value={question}
            placeholder="Ask a question"
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="submit" size="sm" icon={<Icon name="send" size={16} />} disabled={ask.isPending} disabledReason={question.trim() === '' ? 'Write your question first.' : undefined}>
            Ask
          </Button>
        </form>
      </div>
    </Layer>
  )
}
