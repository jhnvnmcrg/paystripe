import { useHydrated } from '@tanstack/react-router'

/** A date in the viewer's own timezone. Renders after hydration so server and browser agree. */
export default function LocalTime({ iso }: { iso: string }) {
  const hydrated = useHydrated()
  return (
    <time dateTime={iso}>
      {hydrated
        ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : null}
    </time>
  )
}
