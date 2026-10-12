import { downloadWebhooks } from '#/lib/lab/downloads/webhooks.server'
import { freemiumWebhooks } from '#/lib/lab/freemium/webhooks.server'
import { licenseKeyWebhooks } from '#/lib/lab/license-keys/webhooks.server'
import type { LabModuleSlug } from '#/lib/lab/modules'
import { saasWebhooks } from '#/lib/lab/saas/webhooks.server'
import { shopWebhooks } from '#/lib/lab/shop/webhooks.server'
import { webToolsEventHandlers, webToolsWebhooks } from '#/lib/lab/web-tools/webhooks.server'
import type { ModuleWebhookHandlers, RegisteredEventHandler } from './types'

/**
 * Each lab module plugs its webhook behaviour in here as it's built.
 * Explicit imports, no side-effect registration, so it's easy to see what runs.
 */
export const moduleHandlers: Partial<Record<LabModuleSlug, ModuleWebhookHandlers>> = {
  'license-keys': licenseKeyWebhooks,
  downloads: downloadWebhooks,
  shop: shopWebhooks,
  saas: saasWebhooks,
  'web-tools': webToolsWebhooks,
  freemium: freemiumWebhooks,
}

/** Raw event handlers for modules that need events beyond Checkout and subscriptions. */
export const extraEventHandlers: RegisteredEventHandler[] = [...webToolsEventHandlers]
