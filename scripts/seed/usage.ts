import Stripe from 'stripe'
import { getStripe } from '../../src/lib/stripe/client.server.ts'
import {
  PAYLOAD_CUSTOMER_KEY,
  PAYLOAD_VALUE_KEY,
  USAGE_PORTAL_KEY,
  usageMeters,
} from '../../src/lib/lab/usage/catalog.ts'
import type { UsageMeterSpec } from '../../src/lib/lab/usage/catalog.ts'
import { ensurePortalConfiguration, ensurePrice } from './helpers.ts'

/**
 * Meters can't be deleted or have their event name changed, so find one by
 * event name (reactivating it if it was switched off) before creating it.
 */
async function ensureMeter(spec: UsageMeterSpec): Promise<Stripe.Billing.Meter> {
  const stripe = getStripe()
  for (const status of ['active', 'inactive'] as const) {
    for await (const meter of stripe.billing.meters.list({ status, limit: 100 })) {
      if (meter.event_name !== spec.eventName) {
        continue
      }
      if (status === 'inactive') {
        console.log(`  reactivated meter ${spec.eventName}`)
        return stripe.billing.meters.reactivate(meter.id)
      }
      console.log(`  unchanged meter ${spec.eventName}`)
      return meter
    }
  }
  console.log(`  created meter ${spec.eventName}`)
  return stripe.billing.meters.create({
    display_name: spec.displayName,
    event_name: spec.eventName,
    default_aggregation: { formula: 'sum' },
    customer_mapping: { type: 'by_id', event_payload_key: PAYLOAD_CUSTOMER_KEY },
    value_settings: { event_payload_key: PAYLOAD_VALUE_KEY },
  })
}

/**
 * Step 8: a meter and a metered monthly Price for each thing the API charges for.
 * API requests are graduated (the first 1,000 free each month); images are flat per unit.
 */
export async function seedUsage(): Promise<void> {
  for (const spec of usageMeters) {
    const meter = await ensureMeter(spec)
    const product = {
      id: spec.productId,
      name: spec.productName,
      description: `Metered: ${spec.units}, billed monthly in arrears.`,
      metadata: { lab_module: 'usage', meter: spec.key },
    }
    const recurring = { interval: 'month' as const, usage_type: 'metered' as const, meter: meter.id }

    await ensurePrice(
      spec.freeUnits > 0
        ? {
            lookupKey: spec.lookupKey,
            nickname: `${spec.productName}, first ${spec.freeUnits} free`,
            recurring,
            product,
            extra: {
              billing_scheme: 'tiered',
              tiers_mode: 'graduated',
              tiers: [
                { up_to: spec.freeUnits, unit_amount: 0 },
                { up_to: 'inf', unit_amount_decimal: Stripe.Decimal.from(spec.centsPerUnit) },
              ],
            },
          }
        : {
            lookupKey: spec.lookupKey,
            nickname: `${spec.productName}, per ${spec.unit}`,
            unitAmount: Number(spec.centsPerUnit),
            recurring,
            product,
          },
    )
  }

  await ensurePortalConfiguration(USAGE_PORTAL_KEY, {
    business_profile: { headline: 'Stripe Lab API: manage billing' },
    features: {
      customer_update: { enabled: true, allowed_updates: ['email', 'name', 'address'] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      // Cancelling at period end still bills the usage counted until then.
      subscription_cancel: { enabled: true, mode: 'at_period_end' },
      subscription_update: { enabled: false },
    },
  })
}
