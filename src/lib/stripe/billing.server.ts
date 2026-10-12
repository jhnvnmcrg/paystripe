import { getAppUrl } from '#/lib/stripe/checkout.server'
import { getStripe } from '#/lib/stripe/client.server'

/*
 * Billing pieces shared by the subscription modules: invoice history and the
 * Customer Portal. Each module has its own Portal configuration, found by key.
 */

export interface InvoiceView {
  id: string
  number: string | null
  status: string | null
  reason: string | null
  amountDue: number
  amountPaid: number
  currency: string
  created: string
  hostedUrl: string | null
}

/** Invoices straight from Stripe: the record of every charge, renewal and failure. */
export async function listInvoices(customerId: string): Promise<InvoiceView[]> {
  const { data } = await getStripe().invoices.list({ customer: customerId, limit: 10 })
  return data.map((invoice) => ({
    id: invoice.id ?? '',
    number: invoice.number,
    status: invoice.status,
    reason: invoice.billing_reason,
    amountDue: invoice.amount_due,
    amountPaid: invoice.amount_paid,
    currency: invoice.currency,
    created: new Date(invoice.created * 1000).toISOString(),
    hostedUrl: invoice.hosted_invoice_url ?? null,
  }))
}

/** A module's Portal configuration, found by `metadata.lab_key` (configurations can't have fixed IDs). */
async function findPortalConfigurationId(key: string, seedHint: string): Promise<string> {
  const { data } = await getStripe().billingPortal.configurations.list({ limit: 100 })
  const configuration = data.find((candidate) => candidate.metadata?.lab_key === key)
  if (!configuration) {
    throw new Error(`The Customer Portal is not set up yet. Run npm run stripe:seed ${seedHint}.`)
  }
  return configuration.id
}

/**
 * A short-lived link to Stripe's hosted billing page for one customer, limited
 * to what the module's configuration allows. Changes made there come back as webhooks.
 */
export async function createPortalSession(options: {
  customerId: string
  configurationKey: string
  returnPath: string
}): Promise<string> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: options.customerId,
    configuration: await findPortalConfigurationId(options.configurationKey, options.configurationKey),
    return_url: `${getAppUrl()}${options.returnPath}`,
  })
  return session.url
}
