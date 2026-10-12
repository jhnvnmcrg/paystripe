/** Formats a Stripe amount (in the currency's minor unit) as money. Fixed locale, so server and client agree. */
export function formatMoney(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined) {
    return '—'
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency ?? 'usd').toUpperCase(),
  }).format(amount / 100)
}
