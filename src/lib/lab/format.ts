/** Like formatMoney, but drops ".00" from whole amounts: "$29" on a pricing table. */
export function formatPrice(amount: number | null | undefined, currency: string | null | undefined) {
  if (amount === null || amount === undefined) {
    return '—'
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency ?? 'usd').toUpperCase(),
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  }).format(amount / 100)
}

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
