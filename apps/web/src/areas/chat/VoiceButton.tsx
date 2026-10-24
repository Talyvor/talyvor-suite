import { useEffect, useRef, useState } from 'react'

import { cn, focusRing } from '@talyvor/ui'

import { AI_NOTICE, AI_NOTICE_KEY, speechAvailable, transcribe, VoiceError } from './voice'

// B47.1 — the composer's microphone, immediately left of Send: tap to start, tap again to stop. What was said lands in
// the box for the person to edit; nothing is sent until they press Send. Esc cancels a recording. When the server says
// speech is not configured, there is no microphone at all. The first time, Chat says plainly that this is an AI.

type State = 'idle' | 'starting' | 'recording' | 'transcribing'

export const MIC_REFUSED = 'Chat can’t use the microphone. Allow it for this site in your browser’s settings, then try again.'
export const NOT_HEARD = 'Couldn’t hear that. Try again.'

/** Whether this browser can record at all; without it there is no microphone in the composer. */
export function canRecord(): boolean {
  return typeof window !== 'undefined' && typeof window.MediaRecorder === 'function' && !!navigator.mediaDevices?.getUserMedia
}

/** m:ss, as the recording runs. */
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export function VoiceButton({ disabled, onText, onNote }: { disabled: boolean; onText: (text: string) => void; onNote: (note: string | null) => void }) {
  const [state, setState] = useState<State>('idle')
  const [available, setAvailable] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [level, setLevel] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)
  const cancelled = useRef(false)

  // Asked once per page: a server without speech shows no microphone.
  useEffect(() => {
    if (!canRecord()) return
    let live = true
    void speechAvailable().then((on) => live && setAvailable(on))
    return () => {
      live = false
    }
  }, [])

  // A microphone left open when Chat closes is let go.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), [])

  // While recording, the timer.
  useEffect(() => {
    if (state !== 'recording') return
    const began = Date.now()
    const tick = window.setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 250)
    return () => window.clearInterval(tick)
  }, [state])

  // While recording, the live level and Esc to cancel.
  useEffect(() => {
    if (state !== 'recording' || recorder.current === null) return
    const stream = recorder.current.stream
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      cancelled.current = true
      recorder.current?.stop()
    }
    window.addEventListener('keydown', onKey)
    // The level is a nicety: a browser without Web Audio records just the same.
    let frame = 0
    let audio: AudioContext | null = null
    if (typeof window.AudioContext === 'function') {
      audio = new AudioContext()
      const analyser = audio.createAnalyser()
      analyser.fftSize = 256
      audio.createMediaStreamSource(stream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      const read = () => {
        analyser.getByteTimeDomainData(samples)
        let peak = 0
        for (const v of samples) peak = Math.max(peak, Math.abs(v - 128))
        setLevel(Math.min(1, peak / 32))
        frame = requestAnimationFrame(read)
      }
      read()
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      cancelAnimationFrame(frame)
      void audio?.close()
    }
  }, [state])

  if (!available) return null

  const start = async () => {
    onNote(window.localStorage.getItem(AI_NOTICE_KEY) === null ? AI_NOTICE : null)
    setState('starting')
    setSeconds(0)
    setLevel(0)
    cancelled.current = false
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setState('idle')
      onNote(MIC_REFUSED)
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
      if (cancelled.current || audio.size === 0) {
        setState('idle')
        if (!cancelled.current) onNote(NOT_HEARD)
        return
      }
      setState('transcribing')
      transcribe(audio)
        .then((text) => (text === '' ? onNote(NOT_HEARD) : onText(text)))
        .catch((e: unknown) => {
          const off = e instanceof VoiceError && e.status === 503
          if (off) setAvailable(false)
          onNote(off ? null : NOT_HEARD)
        })
        .finally(() => setState('idle'))
    }
    recorder.current = rec
    rec.start()
    setState('recording')
  }

  const recording = state === 'recording'
  return (
    <>
      {recording ? (
        <span className="flex items-center gap-2 px-1 text-caption text-muted" role="status" data-testid="voice-recording">
          <span aria-hidden="true" className="flex h-4 items-center gap-0.5">
            {[0.5, 1, 0.7, 0.4].map((w, i) => (
              <span key={i} className="w-1 rounded-pill bg-accent transition-all duration-75" style={{ height: `${Math.max(25, level * w * 100)}%` }} />
            ))}
          </span>
          <span className="font-figure text-ink">{clock(seconds)}</span>
          <span className="hidden sm:inline">Esc to cancel</span>
        </span>
      ) : state === 'transcribing' ? (
        <span className="flex items-center gap-2 px-1 text-caption text-muted" role="status" data-testid="voice-transcribing">
          <span aria-hidden="true" className="h-3 w-3 animate-spin rounded-pill border-2 border-rule border-t-accent motion-reduce:animate-none" />
          Transcribing…
        </span>
      ) : null}
      {/* Send's size and Button's default look, square: Button's px-3 cannot be overridden (cn does not merge). */}
      <button
        type="button"
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-rule bg-surface text-ink',
          'transition-colors duration-200 hover:border-rule-strong active:bg-accent-tint disabled:pointer-events-none disabled:opacity-50',
          recording && 'bg-accent-tint',
          focusRing,
        )}
        aria-label={recording ? 'Stop recording' : state === 'transcribing' ? 'Transcribing' : 'Talk'}
        title={recording ? 'Stop recording' : 'Talk: tap to start, tap again to stop'}
        disabled={(disabled && !recording) || state === 'starting' || state === 'transcribing'}
        data-testid="chat-mic"
        onClick={() => (recording ? recorder.current?.stop() : void start())}
      >
        {recording ? (
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          </svg>
        ) : (
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        )}
      </button>
    </>
  )
}
