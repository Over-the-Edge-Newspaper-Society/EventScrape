import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle } from 'lucide-react'
import type { InstagramEventWithSource, InstagramReviewQueueResponse } from '@/lib/api'
import type { InstagramReviewFilter } from './types'
import { InstagramReviewGroup } from './InstagramReviewGroup'
import { deriveAccountDetails } from './InstagramReviewUtils'

type InstagramReviewQueueProps = {
  posts?: InstagramEventWithSource[]
  filter: InstagramReviewFilter
  isLoading: boolean
  pagination?: InstagramReviewQueueResponse['pagination']
  onMarkAsEvent: (postId: string) => void
  onMarkAsNotEvent: (postId: string) => void
  onAiClassify: (postId: string) => void
  onExtract: (postId: string, overwrite?: boolean) => void
  isClassifyPending: boolean
  isAiClassifyPending: boolean
  isExtractPending: boolean
  onPrevPage: () => void
  onNextPage: () => void
}

export function InstagramReviewQueue({
  posts,
  filter,
  isLoading,
  pagination,
  onMarkAsEvent,
  onMarkAsNotEvent,
  onAiClassify,
  onExtract,
  isClassifyPending,
  isAiClassifyPending,
  isExtractPending,
  onPrevPage,
  onNextPage,
}: InstagramReviewQueueProps) {
  const groupedPosts = useMemo(() => {
    if (!posts?.length) return []

    const groups = new Map<
      string,
      {
        source?: InstagramEventWithSource['source']
        account?: InstagramEventWithSource['account']
        posts: InstagramEventWithSource[]
        username?: string
        displayName?: string
      }
    >()

    posts.forEach((item) => {
      const groupKey =
        item.account?.id ??
        item.source?.id ??
        item.account?.instagramUsername ??
        item.source?.instagramUsername ??
        item.account?.name ??
        item.source?.name ??
        `unknown-${item.event?.id}`

      const details = deriveAccountDetails(item)
      const existing = groups.get(groupKey)

      if (!existing) {
        groups.set(groupKey, {
          source: item.source,
          account: item.account,
          posts: [item],
          username: details.username,
          displayName: details.displayName,
        })
      } else {
        existing.posts.push(item)
        if (!existing.account && item.account) {
          existing.account = item.account
        }
        if (!existing.username && details.username) {
          existing.username = details.username
        }
        if (!existing.displayName && details.displayName) {
          existing.displayName = details.displayName
        }
      }
    })

    return Array.from(groups.entries()).map(([groupKey, value]) => {
      const accountDisplayName =
        value.displayName || (value.username ? `@${value.username}` : 'Unknown source')

      const accountUsername = value.username || value.account?.instagramUsername || undefined

      return {
        groupKey,
        source: value.source,
        account: value.account,
        posts: value.posts,
        accountDisplayName,
        accountUsername,
        postCount: value.posts.length,
      }
    })
  }, [posts])

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-muted-foreground">Loading posts...</p>
        </CardContent>
      </Card>
    )
  }

  if (!groupedPosts.length) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <CheckCircle className="mx-auto mb-4 h-16 w-16 text-green-600" />
            <h3 className="mb-2 text-lg font-semibold">All caught up!</h3>
            <p className="text-muted-foreground">No posts waiting for review. Great job!</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="space-y-8">
        {groupedPosts.map(({ groupKey, posts: grouped, accountDisplayName, accountUsername, postCount }) => (
          <InstagramReviewGroup
            key={groupKey}
            groupKey={groupKey}
            posts={grouped}
            accountDisplayName={accountDisplayName}
            accountUsername={accountUsername}
            postCount={postCount}
            filter={filter}
            isClassifyPending={isClassifyPending}
            isAiClassifyPending={isAiClassifyPending}
            isExtractPending={isExtractPending}
            onMarkAsEvent={onMarkAsEvent}
            onMarkAsNotEvent={onMarkAsNotEvent}
            onAiClassify={onAiClassify}
            onExtract={onExtract}
          />
        ))}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={onPrevPage}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={onNextPage}>
                  Next
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages} • {pagination.total} posts to review
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  )
}
