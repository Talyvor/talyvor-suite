// merchantCategories.ts — B61.64: the merchant categories an agent's rules name, as Lens's economy.MerchantCategories
// (B61.43) lists them, in its order. A card payment in a category the rules do not allow, once they name any, is refused
// before money moves; one in a blocked category always is. Lens also takes a four-digit merchant category code, which a
// summary names as its code.

export const MERCHANT_CATEGORIES = [
  { id: 'software', name: 'Software' },
  { id: 'hosting', name: 'Hosting' },
  { id: 'freight', name: 'Freight' },
  { id: 'advertising', name: 'Advertising' },
  { id: 'travel', name: 'Travel' },
  { id: 'telecoms', name: 'Telecoms' },
  { id: 'gambling', name: 'Gambling' },
] as const

/** A category's name, or "Code 5734" for a merchant category code. */
export function merchantCategoryName(id: string): string {
  return MERCHANT_CATEGORIES.find((c) => c.id === id)?.name ?? `Code ${id}`
}

/** The chosen categories in words and in the list's order, as the reference's row reads them: "Software, hosting, freight"; "" for none. */
export function merchantCategoriesText(ids: readonly string[]): string {
  const at = (id: string) => {
    const i = MERCHANT_CATEGORIES.findIndex((c) => c.id === id)
    return i < 0 ? MERCHANT_CATEGORIES.length : i
  }
  const names = [...ids].sort((a, b) => at(a) - at(b)).map(merchantCategoryName)
  return names.map((n, i) => (i === 0 ? n : n.toLowerCase())).join(', ')
}
