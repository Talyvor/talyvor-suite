// B50.6 — what a browser can download from the app holds no credential and no source map. vite.config.ts runs this
// over every file of a finished build (dist/, public/ included) and fails the build on a finding.

// Key shapes: Talyvor's own tokens and the providers' and partners' published formats, each with enough body that a
// prefix named in a help text is not a key.
export const keyShapes: RegExp[] = [
  /\btlv_[a-z]+_[A-Za-z0-9]{16,}/,
  /\bgwsecret_[A-Za-z0-9]{16,}/,
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/,
  /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}/,
  /\bwhsec_[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[opsu]_[A-Za-z0-9]{36}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{35}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

export function bundleProblems(files: { name: string; text: string }[]): string[] {
  const problems: string[] = []
  for (const { name, text } of files) {
    if (name.endsWith('.map') || /[#@] sourceMappingURL=/.test(text)) {
      problems.push(`${name}: a source map is public`)
    }
    for (const shape of keyShapes) {
      if (shape.test(text)) problems.push(`${name}: a key-shaped string (${shape.source})`)
    }
  }
  return problems
}
