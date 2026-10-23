import { useEffect, useRef, useState } from 'react'

import { cn, focusRing } from '@talyvor/ui'

import { AI_NOTICE, AI_NOTICE_KEY, transcribe } from './voice'

// B40.12 — the composer's microphone: hold to talk and let go to send, or tap to start and tap again to send. What was
// said goes to Chat as the question (voice.ts). The first time, Chat says plainly that the person is talking to an AI.

/** A press longer than this is hold-to-talk; a shorter one is a tap that keeps listening until the next. */
const HOLD_MS = 400

type State = 'idle' | 'starting' | 'listening' | 'hearing'

/** Whether this browser can record at all; without it there is no microphone in the composer. */
export function canRecord(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaRecorder === 'function' && !!navigator.mediaDevices?.getUserMedia
}

export function VoiceButton({ disabled, onText, onNote }: { disabled: boolean; onText: (text: string) => void; onNote: (note: string | null) => void }) {
  const [state, setState] = useState<State>('idle')
  const recorder = useRef<MediaRecorder | null>(null)
  const press = useRef<{ at: number; fresh: boolean } | null>(null)
  const stopAsked = useRef(false)

  // A microphone left open when Chat closes is let go.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), [])

  if (!canRecord()) return null

  const start = async () => {
    if (window.localStorage.getItem(AI_NOTICE_KEY) === null) onNote(AI_NOTICE)
    else onNote(null)
    setState('starting')
    stopAsked.current = false
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState('idle')
      onNote('Chat can’t use the microphone. Allow it for this site in your browser’s settings, then try again.')
      return
    }
    const rec = new MediaRecorder(stream)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      recorder.current = null
      const audio = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      if (audio.size === 0) {
        setState('idle')
        onNote('Nothing was heard. Hold the button while you talk, or tap it, talk, and tap it again.')
        return
      }
      setState('hearing')
      transcribe(audio)
        .then((text) => {
          if (text === '') onNote('Nothing was heard. Try again a little closer to the microphone.')
          else onText(text)
        })
        .catch((e: unknown) => onNote(e instanceof Error ? e.message : 'What you said could not be heard just now.'))
        .finally(() => setState('idle'))
    }
    recorder.current = rec
    rec.start()
    setState('listening')
    // Let go before the microphone opened: the press was a hold that already ended.
    if (stopAsked.current) rec.stop()
  }

  const stop = () => {
    stopAsked.current = true
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  const busy = state === 'hearing' || state === 'starting'
  const label = state === 'listening' ? 'Listening… let go or tap to send' : state === 'hearing' ? 'Hearing…' : 'Talk'
  return (
    <button
      type="button"
      aria-pressed={state === 'listening'}
      aria-label={state === 'idle' ? 'Talk: hold to talk, or tap to start and stop' : label}
      disabled={disabled || state === 'hearing'}
      title="Hold to talk, or tap to start and stop"
      className={cn(
        'inline-flex h-8 shrink-0 touch-none select-none items-center gap-1.5 rounded-control px-2 text-caption transition-colors duration-200 disabled:opacity-50',
        state === 'listening' ? 'bg-accent-tint text-ink' : 'text-muted hover:text-ink',
        focusRing,
      )}
      onPointerDown={(e) => {
        if (e.button > 0) return // the main button or a touch only
        e.preventDefault()
        if (state === 'idle') {
          press.current = { at: Date.now(), fresh: true }
          void start()
        } else if (!busy) press.current = { at: Date.now(), fresh: false }
      }}
      onPointerUp={() => {
        const p = press.current
        press.current = null
        if (p !== null && (!p.fresh || Date.now() - p.at > HOLD_MS)) stop()
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        if (state === 'idle') void start()
        else if (state === 'listening') stop()
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
      </svg>
      {/* Idle, the microphone alone, so the row keeps room for the model's name; listening, it says so. */}
      <span className={state === 'idle' ? 'sr-only' : undefined}>{label}</span>
    </button>
  )
}
