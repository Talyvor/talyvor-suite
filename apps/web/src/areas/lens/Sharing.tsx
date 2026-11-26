import { useId, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { cn, focusRing, inlineLink, useSounds, useTheme, type ThemeChoice } from '@talyvor/ui'
import { Card, Dialog, Icon, KindTile, Row, Switch, Tabs, pocketFocusRing } from '@talyvor/ui/pocket'
import { ApiError } from '../../lib/api'
import { useAuthMeReader } from '../../lib/authMe'
import { IfArea } from '../../lib/workspaceAreas'
import { ProviderKeysCard } from './ProviderKeys'
import { CompanyLine } from '../../components/CompanyLine'
import { SettingsCards, SignedIn, useSettingsLinks } from '../../components/PageLinks'
import { STORED_KEY, readStored } from './StoredAnswers'
import { setFiat, useFiat, type Fiat } from './money'
import { usePersonal } from './agentBankApi'
import { AccountCards } from './AccountSettings'

// Sharing.tsx — cross-tenant answer sharing: the explanation, and the control.
//
// ONE FILE ON PURPOSE. The signup prompt and the settings control describe the same thing and
// write to the same endpoint. Kept apart they drift, and the first draft of the signup screen
// already shipped a claim the product could not honour ("you can change this later in settings"
// — there was no settings screen). A claim about CONSENT is the worst kind to let go stale, so
// the words and the control live together and are used by both screens.
//
// THE COPY STATES BOTH SIDES AND SELLS NEITHER. Sharing is what makes the earning half of the
// product work: this workspace's answers earn LENS when another company reuses them, and it is
// served instantly from theirs. It is also a real disclosure: the content of answers leaves the
// workspace. Both facts are load-bearing, so both are stated, in parallel structure and with the
// same weight. No recommendation, no default-highlighted button, no language that makes one
// option feel like the sensible one. A consent screen that sells is worse than one that only
// warns — the person has to be able to read it and decide.
//
// B28.10 — SAVINGS FIRST, EARNINGS LAST. Sharing is a cost saving: a repeated question is served
// from an answer another company already paid for. The royalty a shared answer earns is a side
// effect, so it is the last line on the "on" side and is called a royalty, not the point. The
// disclosure stays exactly where it was, beside the saving, with the same weight.
//
// This matters more since sharing became ON by default: the screen is now the only thing standing
// between a person and disclosure, so it has to be readable by someone who is not looking for it.

/** Writes the choice; throws when it did not save. Every control re-probes /auth/me after it. */
async function savePooling(cachePoolable: boolean): Promise<void> {
  // Relative path ⇒ same-origin ⇒ the browser supplies the Origin the BFF requires.
  const res = await fetch('/api/pooling', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ cache_poolable: cachePoolable }),
  })
  if (!res.ok) throw new ApiError(res.status, '/api/pooling')
}

/**
 * The Share my answers switch, on Settings' Shared answers and a new workspace's first page (B57.50). It draws what Lens
 * RECORDED (the session probe), never what was pressed, and re-reads it after every write; a refused write says so.
 */
export function ShareMyAnswers() {
  const q = useAuthMeReader()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const recorded = q.data?.cache_poolable

  async function choose(cachePoolable: boolean) {
    setBusy(true)
    setFailed(false)
    try {
      await savePooling(cachePoolable)
      await qc.invalidateQueries({ queryKey: ['auth-me'] })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <span id="share-my-answers" className="text-body font-semibold text-ink">
          Share my answers
        </span>
        <Switch
          aria-labelledby="share-my-answers"
          checked={recorded === true}
          disabledReason={recorded === undefined && !q.isLoading ? 'This workspace’s setting could not be read.' : undefined}
          disabled={busy || q.isLoading}
          onCheckedChange={(on) => void choose(on)}
        />
      </div>
      {failed ? (
        <p role="alert" className="mt-2 text-body text-ink">
          That did not save, so nothing changed. You can try again.
        </p>
      ) : null}
    </>
  )
}

/**
 * B57.42 — Settings' Shared answers: what sharing means, its switch, and how much is stored. The switch draws what Lens
 * RECORDED (the session probe), never what was pressed, and re-reads it after every write; a refused write says so.
 * Every stored answer, and deleting them, is on Gateway features (StoredAnswers).
 */
function SharedAnswersCard() {
  const stored = useQuery({
    queryKey: STORED_KEY,
    queryFn: readStored,
    retry: false,
  })

  const s = stored.data
  const counts = s ? (
    <>
      {s.shared_answers === 0 ? 'No shared answers' : <>{n(s.shared_answers)} answers shared with others</>}, and {n(s.private_answers)}{' '}
      kept to this workspace.{' '}
    </>
  ) : null
  return (
    <Card tone="white" data-testid="settings-sharing">
      <h2 className="font-display text-reading font-bold text-ink">Shared answers</h2>
      <p className="mt-1 text-body text-ink-2">
        An answer made here may be served to another company asking the same, so repeated questions cost less, and you earn a small royalty
        when it is. Your keys, balance and ledger are never shared.
      </p>
      <div className="mt-3">
        <ShareMyAnswers />
      </div>
      <p className="mt-2 text-body text-ink-3" data-testid="settings-stored-counts">
        {counts}Stored answers are kept until you delete them.
      </p>
      <Link to="/features#stored-answers" className={cn(inlineLink, 'mt-2 inline-block text-body font-semibold text-ink')}>
        Every stored answer, and deleting them, on Developers
      </Link>
    </Card>
  )
}

const n = (v: number) => <span className="font-figure">{v.toLocaleString('en-US')}</span>

/** B57.42 — the theme, moved here from the top bar. B57.228 — in Pocket Live's words: Follow my computer, Light or Dark. */
const THEMES: readonly { choice: ThemeChoice; title: string; line?: string; short: string }[] = [
  { choice: 'device', title: 'Follow my computer', line: 'Light by day, dark by night', short: 'Follows your computer' },
  { choice: 'light', title: 'Light', short: 'Light' },
  { choice: 'dark', title: 'Dark', short: 'Dark' },
]

/**
 * pocket.css .pick with its .dot: one of several, a ring that fills with ink when chosen. The ring is the radio, named by
 * the title and described by the line under it, and a press anywhere on the box is a press on it.
 */
function ThemePick({ title, line, on, onPick }: { title: string; line?: string; on: boolean; onPick: () => void }) {
  const lineId = useId()
  return (
    <div className={cn('relative flex items-center gap-3 rounded-control px-4 py-3 text-ink', on ? 'bg-page shadow-pick' : 'bg-cloud')}>
      <button
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={title}
        aria-describedby={line ? lineId : undefined}
        onClick={onPick}
        className={cn(
          'grid h-5 w-5 shrink-0 place-items-center rounded-pill after:absolute after:inset-0',
          on ? 'shadow-edge-current' : 'shadow-edge',
          pocketFocusRing,
        )}
      >
        {on ? <span className="h-2.5 w-2.5 rounded-pill bg-ink" /> : null}
      </button>
      <span className="grid min-w-0 flex-1">
        <span className="text-reading font-semibold">{title}</span>
        {line ? (
          <span id={lineId} className="text-body text-ink-2">
            {line}
          </span>
        ) : null}
      </span>
    </div>
  )
}

/**
 * B61.128 — "Look and sound" (it was "Appearance", Pocket Live section 15): the theme, and a Sounds switch under it, on
 * by default. B57.228 — drawn as Pocket Live's w-settings draws it: a row among the settings, saying what is chosen, that
 * opens its sheet.
 */
function LookAndSound() {
  const [open, setOpen] = useState(false)
  const choice = useTheme((s) => s.choice)
  const choose = useTheme((s) => s.choose)
  const soundsOn = useSounds((s) => s.on)
  const setSoundsOn = useSounds((s) => s.setOn)
  const chosen = THEMES.find((t) => t.choice === choice) ?? THEMES[0]
  return (
    <>
      {/* As Security's sheet rows: the tile drawn as the page links beside it, one button over it that opens the sheet. */}
      <div className="relative flex items-center gap-3 rounded-card bg-cloud p-4 text-ink" data-testid="settings-look-and-sound">
        <KindTile icon={<Icon name="sun" size={18} />} />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="text-reading font-semibold">Look and sound</span>
          <span id="settings-look-line" className="text-body text-ink-3">
            {chosen.short}, {soundsOn ? 'sounds on' : 'sounds off'}
          </span>
        </span>
        <Icon name="chev" size={16} className="shrink-0 text-ink-3" />
        <button
          type="button"
          className={cn('absolute inset-0 rounded-inset', pocketFocusRing)}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label="Look and sound"
          aria-describedby="settings-look-line"
        />
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Look and sound">
        <div role="radiogroup" aria-label="Look" className="grid gap-2">
          {THEMES.map((t) => (
            <ThemePick key={t.choice} title={t.title} line={t.line} on={t.choice === chosen.choice} onPick={() => choose(t.choice)} />
          ))}
        </div>
        <Card tone="white" className="py-1">
          <Row
            title={<span id="settings-sounds">Sounds</span>}
            line="Soft sounds when money moves"
            action={<Switch aria-labelledby="settings-sounds" checked={soundsOn} onCheckedChange={setSoundsOn} />}
          />
        </Card>
      </Dialog>
    </>
  )
}

/** B57.42 — which currency leads beside LXC, moved here from the wallet screens (B57.7). */
const SHOW_IN: Record<string, Fiat> = {
  'US dollars': 'USD',
  Pounds: 'GBP',
  Euros: 'EUR',
}

function ShowAmountsCard() {
  const fiat = useFiat()
  const tabs = Object.keys(SHOW_IN)
  return (
    <Card tone="white">
      <h2 className="font-display text-reading font-bold text-ink">Show amounts in</h2>
      <p className="mt-1 text-body text-ink-2">Dollars are the default; pounds and euros use the day’s rate.</p>
      <Tabs
        label="Show amounts in"
        className="mt-2"
        tabs={tabs}
        value={tabs.find((t) => SHOW_IN[t] === fiat) ?? 'US dollars'}
        onChange={(t) => setFiat(SHOW_IN[t])}
      />
    </Card>
  )
}

/**
 * SharingLine — B28.8: the signup notice as one line to tick, on the onboarding that replaced the
 * full-screen consent page. The box is the RECORDED setting (a new workspace starts with sharing on,
 * Lens's default), so the line tells a person what is already true and one click stops it; the whole
 * account stays one link away in Settings. Like SharingChoice it re-reads what Lens stored after a write.
 */
export function SharingLine() {
  const q = useAuthMeReader()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const recorded = q.data?.cache_poolable

  async function toggle(cachePoolable: boolean) {
    setBusy(true)
    setFailed(false)
    try {
      await savePooling(cachePoolable)
      await qc.invalidateQueries({ queryKey: ['auth-me'] })
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-2 text-caption text-muted">
        <input
          type="checkbox"
          className={`mt-0.5 h-4 w-4 shrink-0 accent-accent transition-colors duration-200 hover:border-rule-strong disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`}
          checked={recorded === true}
          disabled={busy || recorded === undefined}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          Share answers with other companies, so repeated questions cost less: an answer made here may be
          served to another company, and you earn a small royalty when it is.{' '}
          {recorded === undefined ? 'This workspace’s setting could not be read.' : recorded ? 'On now; untick to stop.' : 'Off now.'}{' '}
          <Link to="/settings" className={inlineLink}>
            What sharing means
          </Link>
        </span>
      </label>
      {failed ? <p className="text-caption text-ink">That did not save, so nothing changed. You can try again.</p> : null}
    </div>
  )
}

/** B59.10 — Team, roles and a second approver are a Business's (SPEC 3.4): a Personal account at /members is sent to
 * Settings. Drawn once in the shell; it renders nothing. */
export function TeamOnly() {
  const personal = usePersonal()
  const { pathname } = useLocation()
  return personal && pathname === '/members' ? <Navigate to="/settings" replace /> : null
}

/** Settings — B57.42: every setting on one page (Pocket's w-settings): the pages as cards, the choices beside them. */
export function Settings() {
  const links = useSettingsLinks()
  return (
    <div data-design="pocket" className="grid gap-4.5">
      {/* B57.8 — Sign out moved here from the top bar. */}
      <SignedIn />
      <div className="grid items-start gap-4.5 wide:grid-cols-12">
        <div className="wide:col-span-7">
          <SettingsCards links={links}>
            <LookAndSound />
          </SettingsCards>
        </div>
        <div className="grid gap-3 wide:col-span-5">
          {/* B59.2 — shared answers are the gateway's, and go with it. */}
          <IfArea area="gateway">
            <SharedAnswersCard />
          </IfArea>
          <ShowAmountsCard />
          {/* B27.27 — BYOK's keys: added, replaced and removed here, only their last four ever shown. */}
          <ProviderKeysCard />
          <AccountCards />
        </div>
      </div>
      <CompanyLine className="pb-10" />
    </div>
  )
}
