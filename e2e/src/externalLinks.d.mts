import type { Browser } from 'playwright'

export const GUARD_SCRIPT: string
export function guardExternalLinks<B extends Browser>(browser: B): B
export function externalLinkNote(href: string): string | undefined
