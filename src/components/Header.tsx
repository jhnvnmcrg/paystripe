import { Link } from '@tanstack/react-router'
import ClerkHeader from '../integrations/clerk/header-user.tsx'
import TanChatAIAssistant from './demo-AIAssistant.tsx'
import ThemeToggle from './ThemeToggle'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-[var(--header-bg)] px-4 backdrop-blur-lg">
      <nav className="page-wrap flex flex-wrap items-center gap-x-3 gap-y-2 py-3 sm:py-4">
        <h2 className="m-0 flex-shrink-0 text-base font-semibold tracking-tight">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-[0.9375rem] font-semibold text-ink no-underline"
          >
            <span aria-hidden="true" className="size-2.5 rounded-[3px] bg-brand" />
            Stripe Lab
          </Link>
        </h2>

        <div className="order-3 flex w-full flex-wrap items-center gap-x-5 gap-y-1 pb-1 text-sm font-medium sm:order-none sm:ml-4 sm:w-auto sm:flex-nowrap sm:pb-0">
          <Link
            to="/"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
            activeOptions={{ exact: true }}
          >
            Home
          </Link>
          <Link
            to="/stripe"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            Selling types
          </Link>
          <Link
            to="/about"
            className="nav-link"
            activeProps={{ className: 'nav-link is-active' }}
          >
            About
          </Link>
          <a
            href="https://docs.stripe.com"
            className="nav-link"
            target="_blank"
            rel="noreferrer"
          >
            Stripe docs
          </a>
          <details className="relative w-full sm:w-auto">
            <summary className="nav-link list-none cursor-pointer">
              Starter demos
            </summary>
            <div className="mt-2 min-w-56 rounded-xl border border-line bg-surface p-2 shadow-lg sm:absolute sm:right-0">
              <a
                href="/demo/clerk"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Clerk
              </a>
              <a
                href="/demo/ai-chat"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Chat
              </a>
              <a
                href="/demo/ai-image"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Generate Image
              </a>
              <a
                href="/demo/ai-structured"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Structured Output
              </a>
              <a
                href="/demo/db-chat"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                DB Chat
              </a>
              <a
                href="/demo/drizzle"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Drizzle
              </a>
              <a
                href="/demo/form/simple"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Simple Form
              </a>
              <a
                href="/demo/form/address"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Address Form
              </a>
              <a
                href="/demo/mcp-todos"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                MCP
              </a>
              <a
                href="/demo/table"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                TanStack Table
              </a>
              <a
                href="/demo/store"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Store
              </a>
              <a
                href="/demo/tanstack-query"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                TanStack Query
              </a>
              <a
                href="/demo/neon"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Neon
              </a>
              <a
                href="/demo/posthog"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                PostHog
              </a>
              <a
                href="/demo/sentry/testing"
                className="block rounded-lg px-3 py-2 text-sm text-[var(--sea-ink-soft)] no-underline transition hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
              >
                Sentry
              </a>
            </div>
          </details>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ClerkHeader />
          <TanChatAIAssistant />

          <ThemeToggle />
        </div>
      </nav>
    </header>
  )
}
