import { vi } from 'vitest'

/**
 * B61.128 — the sounds a test's presses asked the browser for, by name (`sent` for /sounds/sent.wav), in order. It reads
 * HTMLMediaElement.play, which test-setup.ts answers as a browser that played; vi.restoreAllMocks puts it back.
 */
export function listenForSounds(): () => string[] {
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
  return () => play.mock.contexts.map((el) => new URL((el as HTMLAudioElement).src).pathname.replace(/^\/sounds\/(.*)\.wav$/, '$1'))
}
