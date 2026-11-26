import { create } from 'zustand'

/**
 * B61.128 — Pocket Live's sounds on the web (DESIGN.md section 15, Sounds). Short, soft notes that mark an outcome once
 * the server has answered, never a press on its own and never the only signal: a word, a tick or a figure always says
 * the same thing. The files are the phone's, unchanged, without key.wav (people type on a keyboard), served from
 * apps/web/public/sounds.
 *
 * Played with the browser's own audio, at 60% of the phone's level, and only after the person's first press on the
 * page: browsers refuse sound before that, so nothing is even asked for until then. play() never throws and never
 * waits, so it cannot hold up the press or the answer it follows.
 */
export type SoundName =
  | 'tick'
  | 'unlock'
  | 'sent'
  | 'approved'
  | 'declined'
  | 'moneyin'
  | 'moved'
  | 'refused'
  | 'freeze'
  | 'unfreeze'
  | 'pause'
  | 'resume'
  | 'celebrate'
  | 'request'

export const SOUND_NAMES: readonly SoundName[] = [
  'tick',
  'unlock',
  'sent',
  'approved',
  'declined',
  'moneyin',
  'moved',
  'refused',
  'freeze',
  'unfreeze',
  'pause',
  'resume',
  'celebrate',
  'request',
]

/** 60% of the phone's level (section 15: "On the web they play at 60% of the phone's level"). */
export const WEB_SOUND_VOLUME = 0.6

const STORAGE_KEY = 'talyvor-sounds'

function storage(): Storage | undefined {
  return (globalThis as { localStorage?: Storage }).localStorage
}

/** On by default: only a stored "off" turns them off. */
function initialOn(): boolean {
  try {
    return storage()?.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

interface SoundState {
  /** Settings › Look and sound › Sounds. */
  on: boolean
  setOn: (on: boolean) => void
}

export const useSounds = create<SoundState>((set) => ({
  on: initialOn(),
  setOn: (on) => {
    try {
      if (on) storage()?.removeItem(STORAGE_KEY)
      else storage()?.setItem(STORAGE_KEY, 'off')
    } catch {
      // Refused: the choice holds for this visit, and the next load starts from the default.
    }
    set({ on })
    // Section 15: moneyin is "also played once when sounds are switched on".
    if (on) playSound('moneyin')
  },
}))

// The first press on the page. Before it the browser refuses to play, so nothing is asked for.
let pressed = false
function onFirstPress() {
  pressed = true
  for (const kind of PRESS_EVENTS) window.removeEventListener(kind, onFirstPress, true)
}
const PRESS_EVENTS = ['pointerdown', 'keydown', 'click'] as const
if (typeof window !== 'undefined') {
  for (const kind of PRESS_EVENTS) window.addEventListener(kind, onFirstPress, true)
}

function hasPressed(): boolean {
  if (pressed) return true
  const activation = (globalThis.navigator as { userActivation?: { hasBeenActive?: boolean } } | undefined)?.userActivation
  return activation?.hasBeenActive === true
}

// Loaded once each, on first use, and replayed from the start.
const players = new Map<SoundName, HTMLAudioElement>()

function player(name: SoundName): HTMLAudioElement | undefined {
  let a = players.get(name)
  if (!a) {
    if (typeof Audio === 'undefined') return undefined
    a = new Audio(`/sounds/${name}.wav`)
    a.preload = 'auto'
    a.volume = WEB_SOUND_VOLUME
    players.set(name, a)
  }
  return a
}

/** Plays one of section 15's sounds, if the person has Sounds on and has pressed something on the page. */
export function playSound(name: SoundName): void {
  if (!useSounds.getState().on || !hasPressed()) return
  try {
    const a = player(name)
    if (!a) return
    a.currentTime = 0
    void a.play()?.catch(() => {
      // Refused or not loaded: the outcome is already on the screen in words.
    })
  } catch {
    // The same: a sound is never the only signal, so a failure to play is silent.
  }
}

/** Tests only: forget the first press and every loaded player. */
export function resetSoundsForTest(): void {
  pressed = false
  players.clear()
  if (typeof window !== 'undefined') {
    for (const kind of PRESS_EVENTS) window.addEventListener(kind, onFirstPress, true)
  }
}
