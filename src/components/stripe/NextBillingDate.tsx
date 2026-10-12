import LocalTime from '#/components/stripe/LocalTime'

export interface BillingDates {
  status: string
  cancelAtPeriodEnd: boolean
  cancelAt: string | null
  currentPeriodEnd: string | null
  trialEnd: string | null
}

/** The renewal, trial-end or cancellation date that matters right now. */
export default function NextBillingDate({ subscription }: { subscription: BillingDates }) {
  if (subscription.status === 'canceled') {
    return <>Ended</>
  }
  if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
    return (
      <>
        Cancels on <LocalTime iso={subscription.cancelAt ?? subscription.currentPeriodEnd} />
      </>
    )
  }
  if (subscription.status === 'trialing' && subscription.trialEnd) {
    return (
      <>
        Trial ends <LocalTime iso={subscription.trialEnd} />, then the first charge
      </>
    )
  }
  if (subscription.currentPeriodEnd) {
    return (
      <>
        Renews on <LocalTime iso={subscription.currentPeriodEnd} />
      </>
    )
  }
  return null
}
