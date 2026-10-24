// B45.27 — "Hey Taly": a wake word heard on this device, only while Chat's tab is open and in view. The browser's own
// speech recogniser listens on the device (processLocally), so no audio leaves it; what the person says after "Hey Taly"
// goes to Chat as a spoken question, exactly as if they had tapped the microphone and pressed Send. A browser that cannot
// recognise speech on the device has no Hey Taly, and a hidden tab stops listening at once (phones forbid background wake
// words, and so do we). A payment said this way is only prepared: it is read back and paid once a passkey approves it.

interface Recogniser {
  lang: string
  continuous: boolean
  interimResults: boolean
  processLocally?: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  abort(): void
}

type On = { langs: string[]; processLocally: boolean }

interface RecogniserClass {
  new (): Recogniser
  available?: (o: On) => Promise<string>
  install?: (o: On) => Promise<boolean>
}

const ON_DEVICE: On = { langs: ['en-US'], processLocally: true }

/** Set once the person has turned Hey Taly on. */
export const WAKE_KEY = 'talyvor.chat.hey-taly'

function recogniser(): RecogniserClass | undefined {
  const w = window as unknown as { SpeechRecognition?: RecogniserClass; webkitSpeechRecognition?: RecogniserClass }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** Whether this browser can hear "Hey Taly" on the device. One that would send the audio away to be recognised cannot. */
export async function canWake(): Promise<boolean> {
  const available = recogniser()?.available
  if (available === undefined) return false
  try {
    return ['available', 'downloadable', 'downloading'].includes(await available(ON_DEVICE))
  } catch {
    return false
  }
}

/** Fetches the browser's on-device English model if it is not on the device yet; true once it is. */
export async function readyToWake(): Promise<boolean> {
  const r = recogniser()
  if (r?.available === undefined) return false
  try {
    return (await r.available(ON_DEVICE)) === 'available' || ((await r.install?.(ON_DEVICE)) ?? false)
  } catch {
    return false
  }
}

const WAKE = /\bhey[\s,]+tal+(?:y|i|ie|ee|ey)\b[\s,.!?]*/i

/** What was said after "Hey Taly" ('' when nothing yet), or null when it was not said. */
export function afterWake(said: string): string | null {
  const m = WAKE.exec(said)
  return m === null ? null : said.slice(m.index + m[0].length).trim()
}

/** Listens for "Hey Taly" until the returned function is called. What follows it, in the same breath or the next, is
 *  the request; "Hey Taly" alone wakes and waits. A refused microphone ends the listening for good. */
export function listenForWake({ onWake, onRequest, onRefused }: { onWake: () => void; onRequest: (text: string) => void; onRefused: () => void }): () => void {
  const R = recogniser()
  if (R === undefined) return () => {}
  let stopped = false
  let awake = false
  const rec = new R()
  rec.lang = ON_DEVICE.langs[0]
  rec.continuous = true
  rec.interimResults = false
  rec.processLocally = true
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]
      if (!result.isFinal) continue
      const said = result[0].transcript.trim()
      const rest = awake ? said : afterWake(said)
      if (rest === null || said === '') continue
      if (rest === '') {
        awake = true
        onWake()
        continue
      }
      awake = false
      onRequest(rest)
    }
  }
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'language-not-supported') {
      stopped = true
      onRefused()
    }
  }
  // The recogniser ends itself after a silence; while wanted, it listens again, no longer awake.
  rec.onend = () => {
    awake = false
    if (!stopped) rec.start()
  }
  rec.start()
  return () => {
    stopped = true
    rec.abort()
  }
}
