import { SignInButton, useAuth } from '@clerk/tanstack-react-start'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { Lock } from 'lucide-react'
import { useEffect } from 'react'
import LevelBadge from '#/components/stripe/membership/LevelBadge'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#/components/ui/card'
import { getMembershipFeed } from '#/lib/lab/membership/membership.functions'

export const Route = createFileRoute('/stripe/membership/feed')({
  head: () => ({ meta: [{ title: 'Members-only feed | Stripe Lab' }] }),
  loader: () => getMembershipFeed(),
  component: FeedPage,
})

const published = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })

function FeedPage() {
  const { level, posts, signedIn } = Route.useLoaderData()
  const router = useRouter()
  const { isLoaded, isSignedIn } = useAuth()

  useEffect(() => {
    if (isLoaded && Boolean(isSignedIn) !== signedIn) {
      router.invalidate()
    }
  }, [isLoaded, isSignedIn, signedIn, router])

  return (
    <main className="page-wrap px-4 pb-16 pt-12 sm:pt-16">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <header>
          <Link to="/stripe/membership" className="text-sm font-medium text-ink-soft no-underline hover:text-ink">
            Memberships and patronage
          </Link>
          <h1 className="display-title m-0 mt-2 text-4xl text-ink">Studio feed</h1>
          <p className="m-0 mt-3 flex flex-wrap items-center gap-2 text-base text-ink-soft">
            {level ? (
              <>
                You're reading as <LevelBadge level={level} />
              </>
            ) : signedIn ? (
              'You can read the public posts. Join to open the rest.'
            ) : (
              'Sign in and join to open members-only posts.'
            )}
          </p>
        </header>

        {posts.map((post) => (
          <Card key={post.id} className={post.body === null ? 'border-dashed' : undefined}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                {post.body === null ? <Lock aria-hidden="true" className="size-4 text-ink-soft" /> : null}
                {post.title}
              </CardTitle>
              <CardDescription className="flex flex-wrap items-center gap-2">
                <time dateTime={post.publishedOn}>{published.format(new Date(post.publishedOn))}</time>
                {post.minLevel ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{post.minLevel === 'backer' ? 'All members' : 'For'}</span>
                    {post.minLevel === 'backer' ? null : <LevelBadge level={post.minLevel} />}
                    {post.minLevel !== 'backer' && post.minLevel !== 'patron' ? <span>and up</span> : null}
                  </>
                ) : (
                  <>
                    <span aria-hidden="true">·</span>
                    <Badge variant="secondary">Public</Badge>
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {post.body !== null ? (
                <p className="m-0 text-[0.9375rem] leading-relaxed text-ink">{post.body}</p>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="m-0 text-sm text-ink-soft">{post.teaser}</p>
                  {signedIn ? (
                    <Button variant="outline" size="sm" asChild>
                      <Link to="/stripe/membership">See membership options</Link>
                    </Button>
                  ) : (
                    <SignInButton mode="modal">
                      <Button variant="outline" size="sm">
                        Sign in
                      </Button>
                    </SignInButton>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </main>
  )
}
