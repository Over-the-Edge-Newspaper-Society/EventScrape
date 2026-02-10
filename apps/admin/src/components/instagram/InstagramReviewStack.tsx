import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle } from 'lucide-react'
import type { InstagramEventWithSource } from '@/lib/api'
import type { InstagramReviewFilter } from './types'
import { InstagramReviewPostCard } from './InstagramReviewPostCard'
import { deriveAccountDetails } from './InstagramReviewUtils'

type InstagramReviewStackProps = {
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

export function InstagramReviewStack({
  posts,
  filter,
  isClassifyPending,
  isAiClassifyPending,
  isExtractPending,
  isDeletePending,
  onMarkAsEvent,
  onMarkAsNotEvent,
  onAiClassify,
  onExtract,
  onDelete,
}: InstagramReviewStackProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())

  const pendingPosts = useMemo(() => {
    return posts.filter(
      (item) => item.event.isEventPoster === null && !dismissedIds.has(item.event.id)
    )
  }, [posts, dismissedIds])

  const totalPending = useMemo(() => {
    return posts.filter((item) => item.event.isEventPoster === null).length
  }, [posts])

  const reviewed = totalPending - pendingPosts.length

  const handleMarkAsEvent = (postId: string) => {
    setDismissedIds((prev) => new Set(prev).add(postId))
    onMarkAsEvent(postId)
  }

  const handleMarkAsNotEvent = (postId: string) => {
    setDismissedIds((prev) => new Set(prev).add(postId))
    onMarkAsNotEvent(postId)
  }

  const handleAiClassify = (postId: string) => {
    setDismissedIds((prev) => new Set(prev).add(postId))
    onAiClassify(postId)
  }

  if (pendingPosts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-600" />
            <h3 className="mb-2 text-lg font-semibold">All caught up!</h3>
            <p className="text-muted-foreground">
              {reviewed > 0
                ? `You reviewed ${reviewed} post${reviewed === 1 ? '' : 's'} this page. Nice work!`
                : 'No posts waiting for review.'}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // Show at most 3 cards in the stack (top visible, 2 peeking behind)
  const visibleCards = pendingPosts.slice(0, 3)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted-foreground">
          Swipe right = Event, left = Not Event
        </p>
        <p className="text-xs font-medium text-muted-foreground">
          {reviewed + 1} of {totalPending}
        </p>
      </div>

      <div className="relative" style={{ minHeight: 420 }}>
        {visibleCards.map((item, index) => {
          const details = deriveAccountDetails(item)
          const accountLabel = details.username
            ? `@${details.username}`
            : details.displayName !== 'Unknown source'
              ? details.displayName
              : undefined

          const isTop = index === 0
          const scale = 1 - index * 0.04
          const yOffset = index * 8
          const zIndex = visibleCards.length - index

          return (
            <div
              key={item.event.id}
              className="absolute left-0 right-0 top-0"
              style={{
                transform: isTop
                  ? undefined
                  : `scale(${scale}) translateY(${yOffset}px)`,
                transformOrigin: 'top center',
                zIndex,
                pointerEvents: isTop ? 'auto' : 'none',
                opacity: isTop ? 1 : 0.6 - index * 0.2,
              }}
            >
              <InstagramReviewPostCard
                item={item}
                accountLabel={accountLabel}
                filter={filter}
                isClassifyPending={isClassifyPending}
                isAiClassifyPending={isAiClassifyPending}
                isExtractPending={isExtractPending}
                isDeletePending={isDeletePending}
                onMarkAsEvent={handleMarkAsEvent}
                onMarkAsNotEvent={handleMarkAsNotEvent}
                onAiClassify={handleAiClassify}
                onExtract={onExtract}
                onDelete={onDelete}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
