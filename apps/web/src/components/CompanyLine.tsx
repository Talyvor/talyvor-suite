import { COMPANY_LINE } from '../company'

/** The company line every page of the website shows (B32.2), in the caption style and faint ink; on the moving
 *  background (sign-in, sign-up, welcome) in pk-on-bg instead (B61.98). */
export function CompanyLine({ className = '', onBackground = false }: { className?: string; onBackground?: boolean }) {
  return <p className={`text-caption ${onBackground ? 'pk-on-bg' : 'text-faint'} ${className}`}>{COMPANY_LINE}</p>
}
