/*
 * The downloadable products, shared by the seed script and the app.
 * No framework imports: scripts/seed/downloads.ts reads this file too.
 * Files live in private-assets/downloads/, outside public/, so the only way
 * to get one is through a signed download link.
 */

export interface DigitalAsset {
  id: string
  lookupKey: string
  productId: string
  name: string
  description: string
  /** What the seed creates. The app always displays the live Stripe price. */
  unitAmount: number
  fileName: string
  contentType: string
  format: string
}

export const digitalAssets: DigitalAsset[] = [
  {
    id: 'ui-kit',
    lookupKey: 'download_ui_kit',
    productId: 'lab_download_ui_kit',
    name: 'Fintech UI Kit',
    description: 'Payment-screen components as SVG and CSS tokens.',
    unitAmount: 4900,
    fileName: 'fintech-ui-kit.zip',
    contentType: 'application/zip',
    format: 'ZIP',
  },
  {
    id: 'template-pack',
    lookupKey: 'download_template_pack',
    productId: 'lab_download_template_pack',
    name: 'Launch Template Pack',
    description: 'Pricing page, changelog and refund policy templates in Markdown.',
    unitAmount: 1900,
    fileName: 'launch-templates.zip',
    contentType: 'application/zip',
    format: 'ZIP',
  },
  {
    id: 'pdf-guide',
    lookupKey: 'download_pdf_guide',
    productId: 'lab_download_pdf_guide',
    name: 'Pricing Page Guide',
    description: 'A short PDF on choosing between one-time, subscription and usage pricing.',
    unitAmount: 900,
    fileName: 'pricing-page-guide.pdf',
    contentType: 'application/pdf',
    format: 'PDF',
  },
]

/** Each purchased asset can be downloaded this many times. */
export const MAX_DOWNLOADS = 5

/** How long a signed download link works. */
export const LINK_TTL_SECONDS = 10 * 60

/** The launch discount buyers can enter on Stripe's page. */
export const launchPromotion = {
  code: 'LAUNCH20',
  couponId: 'lab_launch20',
  percentOff: 20,
}

export function findDigitalAsset(id: string): DigitalAsset | undefined {
  return digitalAssets.find((asset) => asset.id === id)
}

export function findDigitalAssetByLookupKey(lookupKey: string): DigitalAsset | undefined {
  return digitalAssets.find((asset) => asset.lookupKey === lookupKey)
}
