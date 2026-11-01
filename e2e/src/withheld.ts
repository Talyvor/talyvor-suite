// B50.27 — no module here but node's own, so held.ts can write TESTERS.md before pnpm install.
/** What a key looks like: Lens's (tlv_…), a provider's (sk-…, sk-ant-…), Stripe's (sk_/rk_ live or test, whsec_) and AWS's. */
export const KEY_SHAPE = /\b(?:tlv_[A-Za-z0-9_]{16,}|sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|[sr]k_(?:live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|AKIA[0-9A-Z]{16})/
/** B50.27 — text the testers write to a file, every key-shaped string and Bearer token in it taken out. */
export const withheld = (text: string): string =>
  text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, 'Bearer <key withheld>').replace(new RegExp(KEY_SHAPE.source, 'g'), '<key withheld>')
