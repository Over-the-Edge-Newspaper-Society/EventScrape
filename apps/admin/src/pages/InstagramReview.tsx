import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { InstagramReviewFilterTabs } from '@/components/instagram/InstagramReviewFilterTabs'
import {
  InstagramReviewQueue,
  type InstagramReviewFilter,
} from '@/components/instagram/InstagramReviewQueue'
import { InstagramReviewStatsCard } from '@/components/instagram/InstagramReviewStatsCard'
import { instagramReviewApi } from '@/lib/api'
import { toast } from 'sonner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Loader2, Sparkles } from 'lucide-react'

export function InstagramReview() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<InstagramReviewFilter>('pending')
  const [accountId, setAccountId] = useState<string>('all')
  const queryClient = useQueryClient()

  const { data: queue, isLoading } = useQuery({
    queryKey: ['instagram-review-queue', page, filter, accountId],
    queryFn: () => instagramReviewApi.getQueue({ page, limit: 20, filter, accountId: accountId === 'all' ? undefined : accountId }),
  })

  const { data: stats } = useQuery({
    queryKey: ['instagram-review-stats'],
    queryFn: () => instagramReviewApi.getStats(),
  })

  const { data: accountsData } = useQuery({
    queryKey: ['instagram-review-accounts'],
    queryFn: () => instagramReviewApi.getAccounts(),
  })

  const classifyMutation = useMutation({
    mutationFn: ({ id, isEventPoster }: { id: string; isEventPoster: boolean }) =>
      instagramReviewApi.classifyPost(id, { isEventPoster }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['instagram-review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['instagram-review-stats'] })
      toast.success(`Post marked as ${variables.isEventPoster ? 'event' : 'not event'}`)
    },
    onError: () => {
      toast.error('Failed to classify post')
    },
  })

  const extractMutation = useMutation({
    mutationFn: ({ id, overwrite }: { id: string; overwrite?: boolean }) =>
      instagramReviewApi.extractEvent(id, { overwrite, createEvents: true }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['instagram-review-queue'] })
      toast.success(data.message, {
        description: `Created ${data.eventsCreated} event record(s)`,
      })
    },
    onError: (error: any) => {
      if (error.message?.includes('already has extracted')) {
        toast.error('Post already has extracted data', {
          description: 'Use "Re-extract" button to overwrite existing data',
        })
      } else if (error.message?.includes('Gemini API key')) {
        toast.error('Gemini API key not configured', {
          description: 'Configure in Instagram Settings',
        })
      } else if (error.message?.includes('local image')) {
        toast.error('Post does not have a downloaded image', {
          description: 'Image must be downloaded during initial scrape',
        })
      } else {
        toast.error('Failed to extract event data', {
          description: error.message || 'Unknown error',
        })
      }
    },
  })

  const bulkExtractMutation = useMutation({
    mutationFn: () =>
      instagramReviewApi.extractMissing({
        accountId: accountId === 'all' ? undefined : accountId,
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['instagram-review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['instagram-review-stats'] })

      const details: string[] = []
      details.push(`${data.successful} succeeded`)
      if (data.failed) {
        details.push(`${data.failed} failed`)
      }
      details.push(`${data.remaining} remaining`)

      toast.success(data.message, {
        description: details.join(' • '),
      })
    },
    onError: (error: any) => {
      toast.error('Failed to extract event data', {
        description: error?.message || 'Unknown error',
      })
    },
  })

  const aiClassifyMutation = useMutation({
    mutationFn: (id: string) => instagramReviewApi.aiClassifyPost(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['instagram-review-queue'] })
      queryClient.invalidateQueries({ queryKey: ['instagram-review-stats'] })

      const { classification } = data
      const details: string[] = []
      if (typeof classification.confidence === 'number') {
        details.push(`Confidence ${(classification.confidence * 100).toFixed(0)}%`)
      }
      if (classification.reasoning) {
        details.push(classification.reasoning)
      }

      toast.success(data.message, {
        description: details.join(' • ') || undefined,
      })
    },
    onError: (error: any) => {
      toast.error('Failed to classify post with AI', {
        description: error?.message || 'Unknown error',
      })
    },
  })

  const handleMarkAsEvent = (postId: string) => {
    classifyMutation.mutate({ id: postId, isEventPoster: true })
  }

  const handleMarkAsNotEvent = (postId: string) => {
    classifyMutation.mutate({ id: postId, isEventPoster: false })
  }

  const handleAiClassify = (postId: string) => {
    aiClassifyMutation.mutate(postId)
  }

  const handleExtract = (postId: string, overwrite: boolean = false) => {
    extractMutation.mutate({ id: postId, overwrite })
  }

  const handleFilterChange = (newFilter: InstagramReviewFilter) => {
    setFilter(newFilter)
    setPage(1)
  }

  const handleAccountChange = (newAccountId: string) => {
    setAccountId(newAccountId)
    setPage(1)
  }

  const disableBulkExtractButton =
    bulkExtractMutation.isPending || (!!stats && stats.needsExtraction === 0 && accountId === 'all')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Review Queue</h1>
        <p className="text-muted-foreground">
          Classify Instagram posts as events or non-events, then extract event data with AI
        </p>
      </div>

      {stats && <InstagramReviewStatsCard stats={stats} />}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => bulkExtractMutation.mutate()}
          disabled={disableBulkExtractButton}
          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
        >
          {bulkExtractMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          Extract Event Data with AI
        </Button>
        <p className="text-sm text-muted-foreground">
          {accountId === 'all'
            ? `Remaining posts needing extraction (all accounts): ${stats ? stats.needsExtraction : '—'}`
            : 'Runs extraction for posts in this account still missing data.'}
        </p>
      </div>

      <InstagramReviewFilterTabs value={filter} onChange={handleFilterChange} stats={stats} />

      <div className="flex items-center gap-4">
        <label htmlFor="account-filter" className="text-sm font-medium text-foreground">
          Filter by Account:
        </label>
        <Select value={accountId} onValueChange={handleAccountChange}>
          <SelectTrigger id="account-filter" className="w-[280px]">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accountsData?.accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name} {account.instagramUsername && `(@${account.instagramUsername})`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        <InstagramReviewQueue
          posts={queue?.posts}
          filter={filter}
          isLoading={isLoading}
          pagination={queue?.pagination}
          onMarkAsEvent={handleMarkAsEvent}
          onMarkAsNotEvent={handleMarkAsNotEvent}
          onAiClassify={handleAiClassify}
          onExtract={handleExtract}
          isClassifyPending={classifyMutation.isPending}
          isAiClassifyPending={aiClassifyMutation.isPending}
          isExtractPending={extractMutation.isPending}
          onPrevPage={() => setPage((current) => Math.max(1, current - 1))}
          onNextPage={() => setPage((current) => current + 1)}
        />
      </div>
    </div>
  )
}
