/*
 * The metered API's price list, shared by the seed script and the app.
 * No framework imports: scripts/seed/usage.ts reads this file too.
 *
 * Each thing we charge for has a Billing Meter (which adds up usage events)
 * and a monthly metered Price attached to that meter. Nothing is charged up
 * front: at the end of each month Stripe invoices whatever the meters counted.
 */

export type MeterKey = 'requests' | 'images'

export interface UsageMeterSpec {
  key: MeterKey
  /** What the app sends as `event_name`. Unique across the Stripe account. */
  eventName: string
  displayName: string
  productId: string
  productName: string
  lookupKey: string
  unit: string
  units: string
  /** Units included free each month. */
  freeUnits: number
  /** Cents per unit after the free ones, as a decimal string: 0.2 is $0.002. */
  centsPerUnit: string
  /** The batch sizes the API console sends. */
  batches: number[]
}

export const usageMeters: UsageMeterSpec[] = [
  {
    key: 'requests',
    eventName: 'lab_api_requests',
    displayName: 'Lab API requests',
    productId: 'lab_usage_requests',
    productName: 'API requests',
    lookupKey: 'usage_requests_monthly',
    unit: 'request',
    units: 'requests',
    freeUnits: 1000,
    centsPerUnit: '0.2',
    batches: [1, 250, 1000],
  },
  {
    key: 'images',
    eventName: 'lab_image_generations',
    displayName: 'Lab image generations',
    productId: 'lab_usage_images',
    productName: 'Image generations',
    lookupKey: 'usage_images_monthly',
    unit: 'image',
    units: 'images',
    freeUnits: 0,
    centsPerUnit: '4',
    batches: [1, 10],
  },
]

/** The meter event payload keys: who used it, and how much. */
export const PAYLOAD_CUSTOMER_KEY = 'stripe_customer_id'
export const PAYLOAD_VALUE_KEY = 'value'

export const USAGE_PORTAL_KEY = 'usage'

export function findMeter(key: string): UsageMeterSpec | undefined {
  return usageMeters.find((meter) => meter.key === key)
}

/**
 * A rough cost for some usage, before Stripe rounds the invoice line.
 * Only for showing the rate card; the invoice preview is the real number.
 */
export function estimateCents(meter: UsageMeterSpec, units: number): number {
  return Math.max(0, units - meter.freeUnits) * Number(meter.centsPerUnit)
}

/** "$0.002 per request" from a cents-per-unit string, without float noise. */
export function formatUnitPrice(meter: UsageMeterSpec): string {
  const dollars = Number(meter.centsPerUnit) / 100
  return `$${dollars.toFixed(Math.max(2, (meter.centsPerUnit.split('.')[1]?.length ?? 0) + 2))} per ${meter.unit}`
}
