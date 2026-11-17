// signupWords.ts — B59.8: sign-up's words, word for word from the launch pack (SPEC 3.2 and the design's P1, P2 and
// W1). The phone (B59.9) shows the same words, and its tests compare against these. B61.20 adds step 4, the identity
// check, and its words below (the phone's B61.21 shows the same).

export type AccountType = 'personal' | 'business'
export type MoneyKind = 'fiat' | 'stablecoin' | 'hybrid'

export const SIGNUP_STEPS = ['Who is this account for?', 'Pick the kind of money', 'Add a passkey or pair your phone', 'Confirm who you are'] as const

export const ACCOUNT_TYPES: readonly { value: AccountType; title: string; line: string }[] = [
  { value: 'personal', title: 'Personal', line: 'For you and your own agents.' },
  { value: 'business', title: 'Business', line: 'For a company and its team.' },
]

export const MONEY_KINDS: readonly { value: MoneyKind; title: string; line: string; list: (type: AccountType) => string[] }[] = [
  {
    value: 'fiat',
    title: 'Fiat only',
    line: 'Your agents pay ordinary bills with cards and bank transfers.',
    list: (type) => ['Balances in GBP, EUR and USD', type === 'personal' ? 'Cards with Personal art' : 'Cards with Corporate art', 'Bank transfers in and out'],
  },
  {
    value: 'stablecoin',
    title: 'Stablecoin and crypto only',
    line: 'Your agents work on chain.',
    list: () => ['Stablecoin and crypto balances', 'A card that spends from the stablecoin balance', 'Wallet addresses, on-chain send and receive'],
  },
  {
    value: 'hybrid',
    title: 'Hybrid',
    line: 'Both side by side, under one set of rules.',
    list: () => ['Both balances, one total with the split', 'All cards', 'Convert between the two sides', 'Instant transfer'],
  },
]

/** The profile each type asks for. No identity document is asked for. */
export const PROFILE_LABELS = {
  name: 'Your name',
  companyName: 'Company name',
  registrationNumber: 'Registration number',
  country: 'Country',
} as const

export const PROFILE_ERRORS = {
  name: 'Add your name.',
  companyName: 'Add the company name.',
  registrationNumber: 'Add the registration number.',
  country: 'Pick your country.',
} as const

// B61.4 — Nick, 15 Nov: the type and the kind are fixed once the account is open; another of either is another
// account. Settings, Account says the same two sentences.
export const TYPE_NOTE = 'The type can’t be changed later. To use another type, open another account.'
export const KIND_NOTE = 'The kind of money can’t be changed later. To use another kind, open another account.'

/** W1's line under step 2's title: "For Northwind Studio, a Business account." */
export function kindFor(name: string, type: AccountType): string {
  return `For ${name}, a ${type === 'personal' ? 'Personal' : 'Business'} account.`
}

/** The countries sign-up offers: the same list the marketplace's seller tax form offers. */
export const COUNTRIES: readonly (readonly [string, string])[] = [
  ['AU', 'Australia'], ['AT', 'Austria'], ['BE', 'Belgium'], ['BR', 'Brazil'], ['BG', 'Bulgaria'], ['CA', 'Canada'],
  ['HR', 'Croatia'], ['CY', 'Cyprus'], ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'],
  ['FR', 'France'], ['DE', 'Germany'], ['GR', 'Greece'], ['HU', 'Hungary'], ['IS', 'Iceland'], ['IN', 'India'],
  ['IE', 'Ireland'], ['IL', 'Israel'], ['IT', 'Italy'], ['JP', 'Japan'], ['LV', 'Latvia'], ['LI', 'Liechtenstein'],
  ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MT', 'Malta'], ['MX', 'Mexico'], ['NL', 'Netherlands'],
  ['NZ', 'New Zealand'], ['NO', 'Norway'], ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SG', 'Singapore'],
  ['SK', 'Slovakia'], ['SI', 'Slovenia'], ['ZA', 'South Africa'], ['ES', 'Spain'], ['SE', 'Sweden'],
  ['CH', 'Switzerland'], ['AE', 'United Arab Emirates'], ['GB', 'United Kingdom'], ['US', 'United States'],
]

/** B61.20 — step 4, "Confirm who you are": the identity check, run against Lens's levels. Settings, Verification shows
 *  the same parts with the same words. */
export const IDENTITY_WORDS = {
  intro: {
    personal: 'Talyvor checks who you are before your account can move money. It takes a minute.',
    business: 'Talyvor checks who you are and your company before the account can move money. It takes a minute.',
  },
  checks: 'The checks',
  contact: 'Email and phone',
  person: 'Who you are',
  company: 'Your company',
  you: 'You',
  email: 'Email',
  phone: 'Phone number',
  phoneHint: 'With the country code, like +447700900123.',
  legalName: 'Legal name',
  legalNameHint: 'As it is written on your ID.',
  dateOfBirth: 'Date of birth',
  homeAddress: 'Home address',
  addressLine1: 'Address line 1',
  addressLine2: 'Address line 2',
  town: 'Town or city',
  postcode: 'Postcode',
  country: 'Country you live in',
  run: 'Confirm who I am',
  running: 'Checking…',
  passed: 'Passed',
  passedSandbox: 'Passed in Sandbox',
  checking: 'Checking…',
  waiting: 'Waiting for the checker',
  notPassed: 'Not passed',
  notYet: 'Not checked yet',
  documentTitle: 'Your ID document',
  documentLine: 'When our identity partner is live, its own screen opens here to photograph your ID. In Sandbox nothing is asked for and nothing is kept.',
  done: 'You’re confirmed. Your account is open.',
  open: 'Open the app',
  // B61.118 — the way into the app while a check waits, or after one did not pass; never says the check passed.
  openWaiting: 'We’ll finish checking your identity in the background. Live money waits for it; everything in Sandbox works now.',
  openNotPassed: 'You can try the check again from Settings, Verification.',
  gate: 'Your account can look around but can’t move money until you confirm who you are.',
  finish: 'Finish confirming who you are',
} as const

export const IDENTITY_ERRORS = {
  email: 'Add your email address.',
  phone: 'Add your phone number with its country code, like +447700900123.',
  legalName: 'Add your legal name.',
  dateOfBirth: 'Add your date of birth.',
  addressLine1: 'Add the first line of your home address.',
  town: 'Add your town or city.',
  postcode: 'Add your postcode.',
  country: 'Pick the country you live in.',
  companyFirst: 'Save the company details, with at least one director, first.',
  named: (name: string) => `Add ${name} to the people with control, and save.`,
  failed: {
    contact: 'We couldn’t confirm your email and phone. Check them and try again.',
    person: 'We couldn’t confirm who you are. Check your legal name, date of birth, home address and country, and try again.',
    company: 'We couldn’t confirm your company. Check the company details and the people with control, and try again.',
  },
  expired: 'Your identity check expired. Start it again.',
  unknown: 'Nothing was checked. You can try again.',
} as const
