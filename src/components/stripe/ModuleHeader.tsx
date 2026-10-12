import { Link } from '@tanstack/react-router'
import type { LabModuleSlug } from '#/lib/lab/modules'
import { labModules } from '#/lib/lab/modules'

/** The title block at the top of every selling-type page. */
export default function ModuleHeader({
  slug,
  summary,
}: {
  slug: LabModuleSlug
  summary: string
}) {
  const module = labModules.find((candidate) => candidate.slug === slug)

  return (
    <header className="max-w-2xl">
      <Link to="/stripe" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
        Selling types
      </Link>
      <h1 className="display-title m-0 mt-2 text-4xl text-ink sm:text-5xl">{module?.name}</h1>
      <p className="m-0 mt-3 text-base text-ink-soft sm:text-lg">{summary}</p>
      {module ? (
        <p className="m-0 mt-2 text-sm text-ink-soft">Sold this way by {module.examples}.</p>
      ) : null}
    </header>
  )
}
