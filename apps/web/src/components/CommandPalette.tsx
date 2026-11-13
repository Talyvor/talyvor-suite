import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'

import { cn } from '@talyvor/ui'
import { Button, Icon, type IconName, Input, Layer, Money, pocketFocusRing, showToast } from '@talyvor/ui/pocket'

import { type ChatAction, chatActionHref } from '../areas/chat/chatActions'
import { ApiError } from '../lib/api'
import { useWorkspaceAreas } from '../lib/workspaceAreas'
import { BOOK_KEY } from '../areas/lens/AgentBank'
import { AgentFace } from '../areas/lens/AgentFace'
import { PAYEES_KEY } from '../areas/lens/Pay'
import { type SearchKind, type SearchResult, agentBankApi } from '../areas/lens/agentBankApi'

// B28.135 — THE COMMAND PALETTE AND THE KEYBOARD SHORTCUTS, on every screen behind the gate.
//
// Ctrl+K (Cmd+K on a Mac) opens the palette: a new chat, a search of the conversations, the model picker, the theme,
// this list of shortcuts, and every page of the console by its title. Typing filters them; words that match nothing
// still search the conversations for them. Ctrl+/ opens the list of shortcuts.
//
// B41.7 — it is also the one search box: / opens it too, and two letters or more search the workspace's agents, payees,
// payments, bills, invoices, rules and listings (Lens B41.107), grouped, each result opening its own screen.
//
// Chat's three are an address (chatActions.ts), so they work from any screen: the palette goes to Chat, and Chat does
// what it was asked once it knows who is signed in.
//
// B57.9 — drawn in Pocket (the reference's w-home+cmdk): the bar at the top, "Search agents, payees, bills… or type a
// command", with Actions, every agent by its face to its page, every saved payee to Pay with that payee chosen, the
// bills and invoices the search finds, and every page by its title. Keyboard shortcuts says the three keys in a message.

/** On a Mac the modifier is Command, elsewhere Control; either is taken on both, as Chat's Cmd+Shift+S always has. */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export type ShortcutId = 'palette' | 'new-chat' | 'search' | 'rail' | 'shortcuts' | 'close'

export interface Shortcut {
  id: ShortcutId
  /** The keys in the order they are held; 'Mod' is Cmd on a Mac and Ctrl elsewhere. */
  keys: readonly string[]
  label: string
}

/**
 * Every shortcut, in one table: the list Ctrl+/ opens is drawn from it, and the keys this component handles are
 * matched against it. Cmd+Shift+S is Chat's own (B15.5) and Esc each dialog's; they are listed here so the list is whole.
 */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'palette', keys: ['Mod', 'K'], label: 'Open the command palette' },
  { id: 'new-chat', keys: ['Mod', 'Shift', 'O'], label: 'New chat' },
  { id: 'search', keys: ['/'], label: 'Search everything, when not typing' },
  { id: 'rail', keys: ['Mod', 'Shift', 'S'], label: 'Show or hide the conversations, in Chat' },
  { id: 'shortcuts', keys: ['Mod', '/'], label: 'Show keyboard shortcuts' },
  { id: 'close', keys: ['Esc'], label: 'Close the palette or this list' },
]

const HANDLED: ReadonlySet<ShortcutId> = new Set(['palette', 'new-chat', 'search', 'shortcuts'])

/** B59.2 — Chat's own shortcuts, which go with Chat. */
const CHAT_SHORTCUTS: ReadonlySet<ShortcutId> = new Set(['new-chat', 'rail'])

/** A key as the shortcut table names it, in the words this platform uses. */
function keyLabel(key: string): string {
  if (key === 'Mod') return MAC ? 'Cmd' : 'Ctrl'
  return key
}

/** For a control's aria-keyshortcuts: both modifiers, since both are taken. */
export function ariaKeys(id: ShortcutId): string {
  const keys = SHORTCUTS.find((s) => s.id === id)?.keys ?? []
  if (!keys.includes('Mod')) return keys.join('+')
  return ['Meta', 'Control'].map((m) => keys.map((k) => (k === 'Mod' ? m : k)).join('+')).join(' ')
}

/** The shortcut as a tooltip writes it, e.g. "Ctrl+K". */
export function shortcutText(id: ShortcutId): string {
  return (SHORTCUTS.find((s) => s.id === id)?.keys ?? []).map(keyLabel).join('+')
}

function pressed(s: Shortcut, e: KeyboardEvent): boolean {
  const key = s.keys[s.keys.length - 1]
  if (s.keys.includes('Mod') !== (e.metaKey || e.ctrlKey) || e.altKey) return false
  // A letter by the key it types, or by where it sits when the layout types another script.
  if (/^[A-Z]$/.test(key)) {
    if (s.keys.includes('Shift') !== e.shiftKey) return false
    return e.key.toUpperCase() === key || (!/^[a-z]$/i.test(e.key) && e.code === `Key${key}`)
  }
  // A symbol is typed with Shift on some layouts (/ is Shift+7 on a German keyboard), so Shift is not asked of it.
  return e.key === key
}

/** A key pressed in a text field is the person's typing, not a shortcut, unless it holds the modifier. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type)
}

/** A page the palette opens: one of the console's routes, by the title its top bar shows. */
export interface PalettePage {
  path: string
  title: string
}

/** B57.9 — Keyboard shortcuts' message, as the reference words it; the modifier as this platform's keyboard shows it. */
export const SHORTCUTS_LINE = `${MAC ? '⌘K' : 'Ctrl+K'} opens this bar · / searches when you are not typing · Esc closes`

/**
 * What a search found, grouped under these headings in this order, each kind opening the screen it lives on. Agents and
 * payees are listed from the workspace itself when the bar opens, so the search adds the rest.
 */
const FOUND: readonly { kind: SearchKind; group: string; href: (r: SearchResult) => string }[] = [
  { kind: 'bill', group: 'Bills and invoices', href: (r) => `/money/pay#bill-${encodeURIComponent(r.id)}` },
  { kind: 'invoice', group: 'Bills and invoices', href: (r) => `/money/invoices#invoice-${encodeURIComponent(r.id)}` },
  { kind: 'payment', group: 'Payments', href: (r) => `/money/pay#payment-${encodeURIComponent(r.id)}` },
  { kind: 'rule', group: 'Rules', href: (r) => `/agents/${encodeURIComponent(r.agent_id || r.id)}/rules` },
  { kind: 'listing', group: 'Listings', href: (r) => `/marketplace/listings/${encodeURIComponent(r.id)}` },
]
const GROUPS = ['Actions', 'Agents', 'Payees', 'Bills and invoices', 'Payments', 'Rules', 'Listings', 'Pages', 'Conversations']

/** A page's line icon, as the sidebar draws the section it belongs to. */
const PAGE_ICONS: readonly [string, IconName][] = [
  ['/approv', 'approvals'],
  ['/agents', 'agents'],
  ['/statements', 'statements'],
  ['/money/invoices', 'invoices'],
  ['/money/spending', 'spending'],
  ['/money/budgets', 'spending'],
  ['/money/subscriptions', 'spending'],
  ['/money/card', 'card'],
  ['/money', 'payments'],
  ['/chat', 'chat'],
  ['/rooms', 'rooms'],
  ['/marketplace', 'marketplace'],
  ['/scan', 'scan'],
  ['/track', 'work'],
  ['/docs', 'work'],
  ['/setup', 'code'],
  ['/keys', 'key'],
  ['/spend', 'code'],
  ['/features', 'code'],
  ['/billing', 'billing'],
  ['/plans', 'billing'],
  ['/overview', 'billing'],
  ['/ledger', 'billing'],
]
const pageIcon = (path: string): IconName =>
  path === '/' ? 'home' : (PAGE_ICONS.find(([p]) => path.startsWith(p))?.[1] ?? 'settings')

interface Command {
  id: string
  label: string
  group: string
  /** What is drawn before the label: a line icon, or an agent's face. */
  icon?: IconName
  face?: React.ReactNode
  /** A search result's second line and its amount. */
  detail?: string
  figure?: { minor: number; currency: string }
  /** Other words it is found by. */
  words?: string
  shortcut?: ShortcutId
  run: () => void
}

export function CommandPalette({
  pages,
  trigger,
}: {
  pages: readonly PalettePage[]
  /** B57.8 — the control that opens it; the shell's top bar draws Pocket's search button here. */
  trigger?: (open: () => void) => React.ReactNode
}) {
  const [shown, setShown] = useState(false)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const close = useCallback(() => setShown(false), [])
  // B59.2 — Chat's actions, its conversations and Marketplace listings are offered only to a workspace that has them.
  const areas = useWorkspaceAreas()
  const chat = areas.has('chat')
  const marketplace = areas.has('marketplace')

  const toChat = useCallback(
    (action: ChatAction, q = '') => {
      setShown(false)
      // In Chat already, the address is replaced: another entry for the same screen would make Back do nothing.
      navigate(chatActionHref(action, q), { replace: pathname === '/chat' })
    },
    [navigate, pathname],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const hit = SHORTCUTS.find((s) => HANDLED.has(s.id) && (chat || !CHAT_SHORTCUTS.has(s.id)) && pressed(s, e))
      if (hit === undefined || (!hit.keys.includes('Mod') && typing(e.target))) return
      e.preventDefault()
      if (hit.id === 'palette') setShown((s) => !s)
      else if (hit.id === 'shortcuts') showToast(SHORTCUTS_LINE)
      else if (hit.id === 'new-chat') toChat('new')
      else setShown(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [toChat, chat])

  const commands = useMemo<Command[]>(
    () => [
      ...(chat
        ? ([
            { id: 'new-chat', label: 'New chat', group: 'Actions', icon: 'chat', words: 'start conversation', shortcut: 'new-chat', run: () => toChat('new') },
            { id: 'search', label: 'Search conversations', group: 'Actions', icon: 'search', words: 'find history', run: () => toChat('search') },
            { id: 'model', label: 'Switch model', group: 'Actions', icon: 'model', words: 'change choose pick', run: () => toChat('model') },
          ] satisfies Command[])
        : []),
      {
        id: 'shortcuts',
        label: 'Keyboard shortcuts',
        group: 'Actions',
        icon: 'keyboard',
        words: 'keys help',
        run: () => {
          setShown(false)
          showToast(SHORTCUTS_LINE)
        },
      },
      ...pages.map<Command>((p) => ({
        id: `page:${p.path}`,
        label: p.title,
        group: 'Pages',
        icon: pageIcon(p.path),
        words: `go to open ${p.path}`,
        run: () => {
          setShown(false)
          navigate(p.path)
        },
      })),
    ],
    [pages, toChat, navigate, chat],
  )

  return (
    <>
      {trigger ? trigger(() => setShown(true)) : (
      <button
        type="button"
        onClick={() => setShown(true)}
        aria-label="Search agents, payees, bills… or type a command"
        aria-keyshortcuts={ariaKeys('palette')}
        className={cn('grid h-9 w-9 place-items-center rounded-pill bg-cloud text-ink-3', pocketFocusRing)}
      >
        <Icon name="search" size={16} />
      </button>
      )}
      {shown ? (
        <Bar
          commands={commands}
          found={marketplace ? FOUND : FOUND.filter((f) => f.kind !== 'listing')}
          onSearch={chat ? (q) => toChat('search', q) : undefined}
          onOpen={(href) => {
            setShown(false)
            navigate(href)
          }}
          onClose={close}
        />
      ) : null}
    </>
  )
}

/** pocket.css .cmdk .citem's line icon, or the agent's face, at 22 px beside the label. */
function Mark({ c }: { c: Command }) {
  if (c.face !== undefined) return <span aria-hidden="true" className="flex shrink-0">{c.face}</span>
  if (c.icon === undefined) return null
  return <Icon name={c.icon} size={18} className="shrink-0 text-ink-2" />
}

function Bar({
  commands,
  found: kinds,
  onSearch,
  onOpen,
  onClose,
}: {
  commands: readonly Command[]
  /** The kinds of search result this workspace is shown. */
  found: typeof FOUND
  /** Searches Chat's conversations; absent when the workspace has no Chat. */
  onSearch?: (q: string) => void
  onOpen: (href: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()

  // Every agent and every saved payee, read as their own pages read them, so the bar lists them before a word is typed.
  const book = useQuery({ queryKey: BOOK_KEY, queryFn: agentBankApi.book, retry: false })
  const payees = useQuery({ queryKey: PAYEES_KEY, queryFn: agentBankApi.payees, retry: false })
  const listed = useMemo<Command[]>(
    () => [
      ...(book.data?.agents ?? [])
        .filter((a) => !a.archived_at)
        .map<Command>((a) => ({
          id: `agent:${a.id}`,
          label: a.name,
          group: 'Agents',
          face: <AgentFace agent={a} size={22} />,
          words: 'agent',
          run: () => onOpen(`/agents/${encodeURIComponent(a.id)}`),
        })),
      ...(payees.data?.payees ?? []).map<Command>((p) => ({
        id: `payee:${p.id}`,
        label: p.name,
        group: 'Payees',
        icon: 'payments',
        words: `payee pay ${p.country}`,
        // Pay opens with this payee chosen (B57.31 reads the address).
        run: () => onOpen(`/money/pay#payee-${encodeURIComponent(p.id)}`),
      })),
    ],
    [book.data, payees.data, onOpen],
  )

  // The workspace is searched once typing pauses, from two letters (Lens's own floor).
  const [asked, setAsked] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setAsked(query.trim()), 200)
    return () => clearTimeout(t)
  }, [query])
  const search = useQuery({
    queryKey: ['money-search', asked],
    queryFn: () => agentBankApi.search(asked),
    enabled: [...asked].length >= 2,
    staleTime: 30_000,
    retry: false,
  })

  const found = useMemo<Command[]>(() => {
    const q = query.trim()
    const words = q.toLowerCase().split(/\s+/).filter((w) => w !== '')
    const hits = [...commands, ...listed].filter((c) => words.every((w) => `${c.label} ${c.words ?? ''}`.toLowerCase().includes(w)))
    if (q === '') return hits
    const results = search.data?.query === asked ? search.data.groups ?? [] : []
    const inWorkspace = kinds.flatMap((f) =>
      (results.find((g) => g.kind === f.kind)?.results ?? []).map<Command>((r) => ({
        id: `${r.kind}:${r.id}`,
        label: r.title,
        group: f.group,
        icon: f.kind === 'payment' ? 'payments' : f.kind === 'rule' ? 'shield' : f.kind === 'listing' ? 'marketplace' : 'invoices',
        detail: r.detail || undefined,
        figure: r.amount_minor && r.currency ? { minor: r.amount_minor, currency: r.currency } : undefined,
        run: () => onOpen(f.href(r)),
      })),
    )
    if (onSearch === undefined) return [...hits, ...inWorkspace]
    return [...hits, ...inWorkspace, { id: 'search-for', label: `Search conversations for “${q}”`, group: 'Conversations', icon: 'chat', run: () => onSearch(q) }]
  }, [commands, listed, query, search.data, asked, onSearch, onOpen, kinds])
  // In the order they are drawn, so the arrows go down the bar as it reads.
  const groups = GROUPS.map((g) => ({ group: g, rows: found.filter((c) => c.group === g) })).filter((g) => g.rows.length > 0)
  const ordered = groups.flatMap((g) => g.rows)
  const at = Math.min(active, ordered.length - 1)
  // A member who is not the owner or an admin may not search the workspace: for them the bar is what it lists.
  const unsearched = search.isError && !(search.error instanceof ApiError && search.error.status === 403)
  const optionId = (c: Command) => `${listId}-${c.id}`

  // Keep the active option in view while arrowing through the pages.
  useEffect(() => {
    const el = ordered[at] === undefined ? null : document.getElementById(optionId(ordered[at]))
    if (el !== null && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
  })

  const row = (c: Command) => {
    const i = ordered.indexOf(c)
    const shortcut = SHORTCUTS.find((s) => s.id === c.shortcut)
    return (
      <div
        key={c.id}
        id={optionId(c)}
        role="option"
        aria-selected={i === at}
        onMouseDown={(e) => e.preventDefault()}
        onMouseMove={() => i !== at && setActive(i)}
        onClick={() => c.run()}
        className={cn('flex min-w-0 cursor-pointer items-center gap-2.5 rounded-tile p-2.5 text-body text-ink', i === at && 'bg-cloud')}
      >
        <Mark c={c} />
        {/* "INV-000002 · Orbit Studio · $1,500.00", as the reference lists a bill or an invoice. */}
        <span className="min-w-0 truncate">
          {c.label}
          {c.detail !== undefined ? <span className="text-ink-3"> · {c.detail}</span> : null}
          {c.figure !== undefined ? (
            <>
              <span className="text-ink-3"> · </span>
              <Money minor={c.figure.minor} currency={c.figure.currency} className="font-normal text-ink-3" />
            </>
          ) : null}
        </span>
        {shortcut !== undefined ? (
          <span className="ml-auto hidden shrink-0 font-figure text-caption text-ink-3 wide:inline">{shortcut.keys.map(keyLabel).join('+')}</span>
        ) : null}
      </div>
    )
  }

  return (
    <Layer label="Command palette" onClose={onClose} position="top">
      {/* pocket.css .cmdk: 640 wide, round, on the page's own colour: a Pocket card over the scrim. */}
      <div data-design="pocket" className="flex w-full flex-col overflow-hidden rounded-card bg-page shadow-pocket wide:w-screen wide:max-w-2xl">
        <div className="flex items-center gap-2.5 border-b border-line px-4.5 py-3">
          <Icon name="search" size={18} className="shrink-0 text-ink-3" />
          <Input
            autoFocus
            role="combobox"
            aria-expanded={true}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-activedescendant={ordered[at] === undefined ? undefined : optionId(ordered[at])}
            aria-label="Search, or type a command"
            placeholder="Search agents, payees, bills… or type a command"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onClose()
              } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const step = e.key === 'ArrowDown' ? 1 : -1
                if (ordered.length > 0) setActive((at + step + ordered.length) % ordered.length)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                ordered[at]?.run()
              }
            }}
            className="min-w-0 flex-1"
          />
          <Button variant="secondary" size="sm" onClick={onClose} aria-label="Close">
            Esc
          </Button>
        </div>
        <div id={listId} role="listbox" aria-label="Commands" className="grid max-h-96 overflow-y-auto p-2">
          {groups.map(({ group, rows }) => (
            <div key={group} role="group" aria-label={group} className="grid">
              <p className="px-2.5 pb-1 pt-2 text-pocket-eyebrow uppercase text-ink-3">{group}</p>
              {/* The pages in three columns at full width, as the reference lays them. */}
              <div className={cn('grid', group === 'Pages' && 'wide:grid-cols-3')}>{rows.map(row)}</div>
            </div>
          ))}
        </div>
        {unsearched ? <p className="border-t border-line px-4.5 py-2 text-caption text-ink-3">The workspace could not be searched just now.</p> : null}
        <p className="border-t border-line px-4.5 py-3 text-caption text-ink-3">Enter to choose · Esc to close</p>
      </div>
    </Layer>
  )
}
