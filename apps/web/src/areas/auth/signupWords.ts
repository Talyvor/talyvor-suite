// signupWords.ts — B59.8: sign-up's words, word for word from the launch pack (SPEC 3.2 and the design's P1, P2 and
// W1). The phone (B59.9) shows the same words, and its tests compare against these.

export type AccountType = 'personal' | 'business'
export type MoneyKind = 'fiat' | 'stablecoin' | 'hybrid'

export const SIGNUP_STEPS = ['Who is this account for?', 'Pick the kind of money', 'Add a passkey or pair your phone'] as const

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

export const TYPE_NOTE = 'The type can’t be changed later. You can hold several accounts and switch between them.'
export const KIND_NOTE = 'Fiat only or Stablecoin and crypto only can become Hybrid at any time.'

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
