// B57.87 — the phone's keychain in the journeys' web export (metro.config.cjs swaps it in for expo-secure-store): kept
// in the tab's sessionStorage, so a reload keeps the session and the key ids, as the test key keeps its key
// (talyvor-mobile modules/talyvor-keys/test-key.ts). The harness puts the synthetic session in before the app opens.
const PREFIX = 'talyvor.e2e-keychain.'
const store = () => globalThis.sessionStorage

exports.getItemAsync = async (key) => store().getItem(PREFIX + key)
exports.setItemAsync = async (key, value) => store().setItem(PREFIX + key, String(value))
exports.deleteItemAsync = async (key) => store().removeItem(PREFIX + key)
exports.isAvailableAsync = async () => true
exports.WHEN_UNLOCKED = 'WHEN_UNLOCKED'
exports.WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY'
exports.AFTER_FIRST_UNLOCK = 'AFTER_FIRST_UNLOCK'
exports.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'
