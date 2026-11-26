// B57.87 — the phone journeys' web export (src/phoneJourneys.ts): talyvor-mobile's own metro.config.js, read from the
// checkout being exported, with one change on the web: expo-secure-store, which has no web half, is this folder's
// keychain.cjs, so the export can keep the session Lens's synthetic sign-in gave it and the ids of the keys it makes.
// Expo reads it through EXPO_OVERRIDE_METRO_CONFIG; nothing in the phone's checkout is changed.
/* eslint-disable @typescript-eslint/no-require-imports -- Metro loads its config as CommonJS, and the app's own with it */
const path = require('path')

const root = process.env.E2E_PHONE_ROOT
if (!root) throw new Error('E2E_PHONE_ROOT names the talyvor-mobile checkout being exported')
const config = require(path.join(root, 'metro.config.js'))
const keychain = path.join(__dirname, 'keychain.cjs')
const next = config.resolver.resolveRequest

config.watchFolders = [...(config.watchFolders ?? []), __dirname]
config.resolver.resolveRequest = (context, name, platform) =>
  platform === 'web' && name === 'expo-secure-store'
    ? { type: 'sourceFile', filePath: keychain }
    : (next ?? context.resolveRequest)(context, name, platform)

module.exports = config
