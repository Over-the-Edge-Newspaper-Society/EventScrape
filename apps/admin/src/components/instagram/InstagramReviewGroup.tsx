import { Badge } from '@/components/ui/badge'
import type { InstagramEventWithSource } from '@/lib/api'
import type { InstagramReviewFilter } from './types'
import { InstagramReviewPostCard } from './InstagramReviewPostCard'

type InstagramReviewGroupProps = {
  groupKey: string
  accountDisplayName: string
  accountUsername?: string
  postCount: number
  posts: InstagramEventWithSource[]
  filter: InstagramReviewFilter
  isClassifyPending: boolean
  isAiClassifyPending: boolean
  isExtractPending: boolean
  isDeletePending: boolean
  onMarkAsEvent: (postId: string) => void
  onMarkAsNotEvent: (postId: string) => void
  onAiClassify: (postId: string) => void
  onExtract: (postId: string, overwrite?: boolean) => void
  onDelete: (postId: string) => void
}

export function InstagramReviewGroup({
  accountDisplayName,
  accountUsername,
  filter,
  groupKey,
  postCount,
  posts,
  isAiClassifyPending,
  isClassifyPending,
  isExtractPending,
  isDeletePending,
  onAiClassify,
  onExtract,
  onMarkAsEvent,
  onMarkAsNotEvent,
  onDelete,
}: InstagramReviewGroupProps) {
  const displayMatchesHandle =
    accountUsername &&
    accountDisplayName.startsWith('@') &&
    accountDisplayName.slice(1).toLowerCase() === accountUsername.toLowerCase()

  return (
    <div key={groupKey} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Instagram Account
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-2 text-lg font-semibold text-foreground">
              {accountDisplayName}
            </span>
            {accountUsername && !displayMatchesHandle && (
              <span className="text-sm text-muted-foreground">@{accountUsername}</span>
            )}
          </div>
        </div>
        <Badge variant="outline" className="text-xs font-medium">
          {postCount} {postCount === 1 ? 'post' : 'posts'}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {posts.map((item) => {
          const { account: eventAccount, event, source } = item
          const accountLabel = accountUsername
            ? `@${accountUsername}`
            : accountDisplayName !== 'Unknown source'
              ? accountDisplayName
              : eventAccount?.name && eventAccount.name.toLowerCase() !== 'instagram'
                ? eventAccount.name
                : eventAccount?.instagramUsername
                  ? `@${eventAccount.instagramUsername}`
                  : undefined

          const dialogSubject =
            accountLabel ||
            (eventAccount?.instagramUsername ? `@${eventAccount.instagramUsername}` : undefined) ||
            (source?.instagramUsername ? `@${source.instagramUsername}` : undefined)

          return (
            <InstagramReviewPostCard
              key={event.id}
              item={item}
              accountLabel={accountLabel}
              dialogSubject={dialogSubject}
              filter={filter}
              isAiClassifyPending={isAiClassifyPending}
              isClassifyPending={isClassifyPending}
              isExtractPending={isExtractPending}
              isDeletePending={isDeletePending}
              onAiClassify={onAiClassify}
              onExtract={onExtract}
              onMarkAsEvent={onMarkAsEvent}
              onMarkAsNotEvent={onMarkAsNotEvent}
              onDelete={onDelete}
            />
          )
        })}
      </div>
    </div>
  )
}
