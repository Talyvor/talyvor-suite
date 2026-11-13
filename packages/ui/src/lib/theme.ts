import { create } from 'zustand'

export type Theme = 'light' | 'dark'
const STORAGE_KEY = 'talyvor-theme'

/**
 * STORAGE HAS THREE STATES, AND `typeof` COULD ONLY SEE TWO.
 *
 * `typeof localStorage !== 'undefined'` asks "is there a storage object". A browser answers YES
 * and then THROWS from `getItem`/`setItem` — Safari private browsing, Chrome with site data
 * blocked, an embedded WebView, or a full quota. apps/web/index.html's no-flash script already
 * knows this and wraps its read in try/catch; this module, which owns the WRITE on the same key,
 * did not.
 *
 * ⚠ WHAT THAT COST, MEASURED (theme-storage.test.tsx is the guard): `apply()` set the DOM
 * attribute BEFORE the write, so a throw landed BETWEEN the two halves of one state change. The
 * page repainted dark, `set({ theme })` never ran, and ThemeToggle — whose icon, `title` and
 * `aria-label` all read the store — went on announcing "Switch to dark theme" on a page that was
 * already dark. The next press recomputed `next` from the stale `light` and painted dark again,
 * so the control could never return. Painted dark, labelled light, stuck.
 *
 * ⚠ AND NO TEST IN THIS REPO COULD HAVE SEEN IT. Under Node 26 `localStorage` is a built-in
 * global GETTER that yields `undefined` unless `--localstorage-file` is passed, and it shadows
 * jsdom's — so `'localStorage' in globalThis` was true while `typeof localStorage` was
 * "undefined", every guard below was false, and the whole persistence half was dead in both
 * vitest projects. `sessionStorage`, which Node does not define, came through as jsdom's object;
 * that asymmetry is what named the cause. __tests__/storage-env.ts restores it and pins the
 * asymmetry, and without that file this module's guard cannot fail.
 *
 * So the access is widened to `Storage | undefined` — which is the honest type for a global that
 * may be absent, present, or present-and-refusing — and every call is wrapped.
 */
function storage(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage
}

/** First load: honour the data-theme the no-flash script already set (from stored
 *  choice or prefers-color-scheme), else derive it here. */
function initialTheme(): Theme {
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme')
    if (attr === 'light' || attr === 'dark') return attr
  }
  try {
    const stored = storage()?.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Refused. Fall through to the OS preference — the same answer a first-ever visit gets.
  }
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function paint(theme: Theme): void {
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme)
}

function apply(theme: Theme): void {
  paint(theme)
  try {
    storage()?.setItem(STORAGE_KEY, theme)
  } catch {
    // Refused. The theme is already painted and the store is about to agree with it; forgetting
    // the choice for next time must not abandon this state change half-done.
  }
}

/**
 * B57.42 — Settings' Appearance: Light, Dark, or Same as this device. "Same as this device" is no stored choice at
 * all, so index.html's no-flash script asks prefers-color-scheme on every load, as it does on a first visit.
 */
export type ThemeChoice = Theme | 'device'

function deviceTheme(): Theme {
  try {
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function initialChoice(): ThemeChoice {
  try {
    const stored = storage()?.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Refused: nothing was chosen that could be read, which is following the device.
  }
  return 'device'
}

interface ThemeState {
  theme: Theme
  /** What the person chose in Settings; 'device' while the theme follows the device. */
  choice: ThemeChoice
  setTheme: (t: Theme) => void
  toggle: () => void
  choose: (c: ThemeChoice) => void
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: initialTheme(),
  choice: initialChoice(),
  setTheme: (t) => {
    apply(t)
    set({ theme: t, choice: t })
  },
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    apply(next)
    set({ theme: next, choice: next })
  },
  choose: (c) => {
    if (c !== 'device') {
      get().setTheme(c)
      return
    }
    const t = deviceTheme()
    paint(t)
    try {
      storage()?.removeItem(STORAGE_KEY)
    } catch {
      // Refused: there was nothing stored that could be read either, so the next load follows the device anyway.
    }
    set({ theme: t, choice: 'device' })
  },
}))

// While the theme follows the device, a change on the device repaints the page.
try {
  if (typeof window !== 'undefined') {
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', (e) => {
      if (useTheme.getState().choice !== 'device') return
      const t: Theme = e.matches ? 'dark' : 'light'
      paint(t)
      useTheme.setState({ theme: t })
    })
  }
} catch {
  // No matchMedia: the device has nothing to say, and the page keeps the theme it has.
}
