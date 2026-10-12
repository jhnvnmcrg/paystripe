import { Badge } from '#/components/ui/badge'
import type { MemberLevel } from '#/lib/lab/membership/catalog'
import { levelNames } from '#/lib/lab/membership/catalog'

/** A member's level. Patrons get the filled badge. */
export default function LevelBadge({ level }: { level: MemberLevel }) {
  return (
    <Badge variant={level === 'patron' ? 'default' : level === 'backer' ? 'secondary' : 'outline'}>
      {levelNames[level]}
    </Badge>
  )
}
