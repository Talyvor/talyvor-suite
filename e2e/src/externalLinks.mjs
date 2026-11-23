// B17.526 — the test browser never hands a link to the Mac. The run's Chromium (the full one, in its new
// headless mode, run.ts) passes a link it cannot open itself — mailto:, tel:, sms:, facetime: and the rest —
// to macOS, and macOS opened a Mail window to hello@talyvor.com for every explorer that clicked the footer.
// Plain JavaScript so the .mjs scripts in apps/web can use it as the run's .ts files do.

/** Schemes the browser opens itself. Anything else goes to the operating system. blob: and data: are the
 *  app's own downloads, about: and javascript: never leave the page. */
const IN_THE_BROWSER = ['http:', 'https:', 'blob:', 'data:', 'about:', 'javascript:']

/** Runs in every page before the page's own scripts: a click or auxclick on a link that would leave the
 *  browser is cancelled in the capture phase, and window.open with such an address opens nothing. The link
 *  itself, its name and its href stay as they are. */
export const GUARD_SCRIPT = `(() => {
  const inBrowser = new Set(${JSON.stringify(IN_THE_BROWSER)})
  const leaves = (href) => {
    try { return !inBrowser.has(new URL(String(href), location.href).protocol) } catch { return false }
  }
  const stop = (e) => {
    for (const el of e.composedPath()) {
      if (!(el instanceof Element) || (el.localName !== 'a' && el.localName !== 'area') || !el.hasAttribute('href')) continue
      if (leaves(el.getAttribute('href'))) e.preventDefault()
      return
    }
  }
  window.addEventListener('click', stop, true)
  window.addEventListener('auxclick', stop, true)
  const open = window.open
  window.open = function (url, ...rest) {
    if (url !== undefined && url !== null && String(url) !== '' && leaves(url)) return null
    return open.call(this, url, ...rest)
  }
})()`

/** Every context the browser makes from now on — newPage's own included, it goes through newContext —
 *  carries GUARD_SCRIPT. Returns the browser it was given. */
export function guardExternalLinks(browser) {
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (options) => {
    const context = await newContext(options)
    await context.addInitScript(GUARD_SCRIPT)
    return context
  }
  return browser
}

/** What a click on `href` did in the test browser, when it is a link the guard keeps from the Mac:
 *  "a mail link: nothing opens in the test browser". Undefined for a link the browser opens itself. */
export function externalLinkNote(href) {
  let scheme
  try { scheme = new URL(href, 'http://localhost/').protocol } catch { return undefined }
  if (IN_THE_BROWSER.includes(scheme)) return undefined
  const kind = scheme === 'mailto:' ? 'a mail link' : scheme === 'tel:' ? 'a phone link' : `a ${scheme.slice(0, -1)} link`
  return `${kind}: nothing opens in the test browser`
}
