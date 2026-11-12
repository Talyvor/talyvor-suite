// recoveryCodeStore.ts — B55.54: the recovery code Lens answers once (the workspace's first key, a new code, or a key
// got back), held in memory until the person says they saved it. Nothing is written to the browser's storage, so a
// reload never shows it again. RecoveryCodeSheet (KeyRecovery.tsx), in the app's shell, shows it.

let code: string | null = null
const listeners = new Set<() => void>()

export function showRecoveryCode(next: string): void {
  code = next
  listeners.forEach((l) => l())
}

export function forgetRecoveryCode(): void {
  code = null
  listeners.forEach((l) => l())
}

export function recoveryCodeShown(): string | null {
  return code
}

export function onRecoveryCode(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
