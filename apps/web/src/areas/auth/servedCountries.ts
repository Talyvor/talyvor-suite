import { usePricing } from '../marketing/pricingApi'
import { AgentBankError } from '../lens/agentBankApi'
import { COUNTRIES } from './signupWords'
import { DoorError } from './doorApi'

// servedCountries.ts — B61.110: sign-up and the identity check offer exactly the countries Lens serves (talyvor-lens
// B61.53's GET /v1/public/countries, which the BFF's public /api/pricing carries as `countries`), and put Lens's
// refusal of any other on the country field.

/** Lens's code for a country Talyvor does not serve. Its sentence is Lens's own: "Talyvor is not available in that
 *  country yet." */
export const COUNTRY_NOT_SERVED = 'country_not_served'

/** The countries a picker offers: exactly the codes Lens serves, each by the app's own name, or by its code where the
 *  app has none, in name order. Until Lens has said, the app's own list; Lens still refuses a country it does not serve. */
export function servedCountries(served: readonly string[] | undefined): readonly (readonly [string, string])[] {
  if (!served) return COUNTRIES
  const names = new Map(COUNTRIES)
  return served.map((code) => [code, names.get(code) ?? code] as const).sort((a, b) => a[1].localeCompare(b[1], 'en'))
}

/** The countries Lens serves, for sign-up's and the identity check's pickers. */
export function useServedCountries(): readonly (readonly [string, string])[] {
  const pricing = usePricing()
  return servedCountries(pricing.status === 'ok' ? pricing.pricing.countries : undefined)
}

/** Lens's sentence when it refused the country, for the country field; null for any other refusal. */
export function countryRefusal(err: unknown): string | null {
  if (err instanceof DoorError && err.reason === COUNTRY_NOT_SERVED && err.message) return err.message
  if (err instanceof AgentBankError && err.body.code === COUNTRY_NOT_SERVED && err.sentence) return err.sentence
  return null
}
