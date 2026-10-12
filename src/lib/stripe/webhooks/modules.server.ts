import { licenseKeyWebhooks } from '#/lib/lab/license-keys/webhooks.server'
import type { LabModuleSlug } from '#/lib/lab/modules'
import type { ModuleWebhookHandlers, RegisteredEventHandler } from './types'

/**
 * Each lab module plugs its webhook behaviour in here as it's built.
 * Explicit imports, no side-effect registration, so it's easy to see what runs.
 */
export const moduleHandlers: Partial<Record<LabModuleSlug, ModuleWebhookHandlers>> = {
  'license-keys': licenseKeyWebhooks,
}

/** Raw event handlers for modules that need events beyond Checkout (subscriptions, invoices, ...). */
export const extraEventHandlers: RegisteredEventHandler[] = []
