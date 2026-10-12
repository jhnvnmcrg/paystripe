import type { MemberLevel } from './catalog'

/*
 * The members-only feed. Server-only on purpose: the browser only receives the
 * text of posts the viewer's level unlocks, never the rest hidden with CSS.
 */

export interface Post {
  id: string
  title: string
  publishedOn: string
  /** Shown to everyone, locked or not. */
  teaser: string
  body: string
  /** Null means public. */
  minLevel: MemberLevel | null
}

export const posts: Post[] = [
  {
    id: 'welcome',
    title: 'Welcome to the studio',
    publishedOn: '2026-10-01',
    teaser: 'What this place is, and what members get.',
    body: 'This is a small studio making tools and writing about how they are built. Most posts are free. Members get the working notes, the recordings and the rough drafts, and their support keeps it all independent.',
    minLevel: null,
  },
  {
    id: 'thank-you',
    title: 'October thank-you note',
    publishedOn: '2026-10-03',
    teaser: 'A short note for everyone who chips in, at any amount.',
    body: 'Thank you. Every member, including everyone paying what they can, covered this month’s hosting and two weeks of writing time. Names are on the supporter wall unless you chose to stay anonymous.',
    minLevel: 'backer',
  },
  {
    id: 'sketchbook',
    title: 'Behind the scenes: the sketchbook',
    publishedOn: '2026-10-06',
    teaser: 'The rough pages that came before the new design.',
    body: 'Forty pages of sketches went into the new layout. The first twenty were wrong in useful ways: too many panels, too little contrast. Page 31 is where the single-column idea appeared, and everything after it is refinement.',
    minLevel: 'supporter',
  },
  {
    id: 'qa',
    title: 'Insider Q&A: pricing a small product',
    publishedOn: '2026-10-08',
    teaser: 'Recording and notes from this month’s live Q&A.',
    body: 'The main question was how to price a first product. The answer we kept coming back to: charge from day one, offer a yearly price with two months free, and raise prices for new customers only. Full recording link: (simulated) members.example/qa-october.',
    minLevel: 'insider',
  },
  {
    id: 'roundtable',
    title: 'Patron roundtable notes',
    publishedOn: '2026-10-10',
    teaser: 'What patrons voted to build next, and why.',
    body: 'Patrons voted on next quarter’s roadmap. First place: an offline mode. Second: a public API. Third: a dark theme for print. The offline mode starts next week; patrons get the first beta builds.',
    minLevel: 'patron',
  },
]
