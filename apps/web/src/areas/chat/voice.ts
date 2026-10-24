// B40.12 — talking to Talyvor in Chat. What the person says is recorded in the browser, transcribed by Lens (B40.10,
// through the BFF's /api/chat/voice/transcriptions) and put in the composer for the person to send (B47.1); the answer
// is shown and read aloud by Lens's speech (/api/chat/voice/speech). Both are billed like any model call. Voice reads and prepares: a payment said
// aloud is only prepared, and paid once the person approves it with a passkey (PayCommand.tsx). There is no voiceprint:
// a voice is never a way to approve anything.

import { ApiError } from '../../lib/api'

/** Set once the person has been told they are talking to an AI (EU AI Act art 50). */
export const AI_NOTICE_KEY = 'talyvor.chat.voice-notice'

export const AI_NOTICE =
  'You’re talking to an AI. What you say is turned into text, an AI model answers, and a computer voice reads the answer aloud. Voice can read and prepare: nothing is paid until you approve it with your passkey.'

/** Lens's limit on one spoken answer (internal/proxy/speech.go maxSpeechChars). */
const SPEECH_LIMIT = 4096

/** A speech call Lens or the BFF refused, with the sentence to show ("speech is not configured on this Lens."). */
export class VoiceError extends ApiError {
  constructor(status: number, path: string, sentence: string) {
    super(status, path)
    this.message = sentence
  }
}

async function refusal(res: Response, path: string, fallback: string): Promise<VoiceError> {
  let sentence = fallback
  try {
    const said = ((await res.json()) as { error?: string }).error
    if (said) sentence = /[.!?]$/.test(said) ? said : `${said}.`
  } catch {
    // a body that is not JSON carries no sentence
  }
  return new VoiceError(res.status, path, sentence)
}

let probed: Promise<boolean> | null = null

/** B47.1 — whether this server has speech, asked once per page. An empty POST costs nothing: Lens answers 503 when
 * speech is not configured before it reads the form, and refuses the missing file otherwise. Only the 503 hides the
 * microphone; a network failure leaves it, and the recording then says what went wrong. */
export function speechAvailable(): Promise<boolean> {
  probed ??= fetch('/api/chat/voice/transcriptions', { method: 'POST', credentials: 'same-origin' }).then(
    (res) => res.status !== 503,
    () => true,
  )
  return probed
}

/** For tests: forget the answer, as a new page would. */
export function forgetSpeechAvailable() {
  probed = null
}

/** The recording, as text. */
export async function transcribe(audio: Blob): Promise<string> {
  const form = new FormData()
  form.append('file', audio, audio.type.includes('mp4') ? 'speech.mp4' : audio.type.includes('ogg') ? 'speech.ogg' : 'speech.webm')
  const res = await fetch('/api/chat/voice/transcriptions', { method: 'POST', body: form, credentials: 'same-origin' })
  // B47.1 — speech is not configured: the rest of this page has no microphone.
  if (res.status === 503) probed = Promise.resolve(false)
  if (!res.ok) throw await refusal(res, '/api/chat/voice/transcriptions', 'What you said could not be heard just now.')
  return (((await res.json()) as { text?: string }).text ?? '').trim()
}

/** An answer as it is read aloud: the words, without the markdown, code said to be on screen, within Lens's limit. */
export function spoken(markdown: string): string {
  const words = markdown
    .replace(/```[\s\S]*?```/g, ' There is code on screen. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (words.length <= SPEECH_LIMIT) return words
  const cut = words.slice(0, SPEECH_LIMIT - 40)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return `${end > 0 ? cut.slice(0, end + 1) : cut} The rest is on screen.`
}

let playing: HTMLAudioElement | null = null

/** Says the words aloud — the first time, after saying that this is an AI. A new answer stops the one before. */
export async function sayAloud(text: string): Promise<void> {
  const words = spoken(text)
  if (words === '') return
  const first = window.localStorage.getItem(AI_NOTICE_KEY) === null
  const res = await fetch('/api/chat/voice/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ input: first ? `You’re talking to an AI. ${words}` : words }),
  })
  if (!res.ok) throw await refusal(res, '/api/chat/voice/speech', 'The answer could not be read aloud just now.')
  window.localStorage.setItem(AI_NOTICE_KEY, 'told')
  const url = URL.createObjectURL(await res.blob())
  playing?.pause()
  playing = new Audio(url)
  playing.onended = () => URL.revokeObjectURL(url)
  await playing.play()
}
