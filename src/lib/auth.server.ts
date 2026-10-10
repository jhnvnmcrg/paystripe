import { auth, clerkClient } from '@clerk/tanstack-react-start/server'

/** The signed-in Clerk user's ID. Throws when nobody is signed in. */
export async function requireUserId(): Promise<string> {
  const { isAuthenticated, userId } = await auth()
  if (!isAuthenticated || !userId) {
    throw new Error('Sign in to continue.')
  }
  return userId
}

/** The signed-in Clerk user's ID, or null. */
export async function getOptionalUserId(): Promise<string | null> {
  const { userId } = await auth()
  return userId ?? null
}

/** `auth()` carries no email, so fetch the user record from Clerk. */
export async function getUserEmail(userId: string): Promise<string | undefined> {
  const user = await clerkClient().users.getUser(userId)
  return (
    user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress
  )
}
