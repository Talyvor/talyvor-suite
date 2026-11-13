/**
 * B56.25 — THE SHIPPED FILES WHOSE COPY STILL BREAKS A RULE. This list only shrinks.
 *
 * copyRules.test.ts holds every string the web app ships to the copy rules (no em or en dash, none of the
 * forbidden words), except in the files named here. Each entry names the B57 item that redraws the file; that item
 * clears its copy and takes the file out in the same merge. copyRules.test.ts fails on an entry that is not shipped
 * or no longer breaks a rule, and B57.88 fails while the list names anything.
 *
 * Paths are relative to apps/web/src.
 */
export const COPY_PENDING: Readonly<Record<string, string>> = {}
