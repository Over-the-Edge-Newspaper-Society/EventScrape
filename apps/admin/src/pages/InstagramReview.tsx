import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  instagramReviewApi,
  API_BASE_URL,
  type InstagramEventWithSource,
} from '@/lib/api'
import { CheckCircle, XCircle, Calendar, MapPin, Instagram, ExternalLink, Sparkles, Loader2 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'

type FilterType = 'pending' | 'event' | 'not-event' | 'all'

type ExtractedEventDetails = {
  title?: string
  description?: string
  startDate?: string
  startTime?: string
  endDate?: string
  endTime?: string
  timezone?: string
  venue?: {
    name?: string
    address?: string
    city?: string
    region?: string
    country?: string
  }
  organizer?: string
  category?: string
  price?: string
  tags?: string[]
  url?: string
}

const parseEventRaw = (raw: unknown) => {
  if (!raw) return undefined

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, any>
  }

  return undefined
}

const findFirstString = (data: any, paths: string[][]) => {
  if (!data || typeof data !== 'object') return undefined

  for (const path of paths) {
    let current: any = data
    for (const key of path) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key]
      } else {
        current = undefined
        break
      }
    }

    if (typeof current === 'string' && current.trim().length > 0) {
      return current.trim()
    }
  }

  return undefined
}

const deriveAccountDetails = (item: InstagramEventWithSource) => {
  const parsedRaw = parseEventRaw(item.event.raw)

  const accountUsername = item.account?.instagramUsername?.trim()
  const accountName = item.account?.name?.trim()
  const sourceUsername = item.source?.instagramUsername?.trim()
  const sourceName = item.source?.name?.trim()

  const username =
    accountUsername ||
    sourceUsername ||
    findFirstString(parsedRaw, [
      ['instagram', 'username'],
      ['instagram', 'author', 'username'],
      ['account', 'username'],
      ['profile', 'username'],
      ['post', 'username'],
      ['post', 'owner', 'username'],
      ['user', 'username'],
      ['owner', 'username'],
    ])

  const rawName = findFirstString(parsedRaw, [
    ['instagram', 'author', 'name'],
    ['instagram', 'author', 'fullName'],
    ['instagram', 'author', 'full_name'],
    ['account', 'name'],
    ['profile', 'name'],
    ['post', 'owner', 'full_name'],
    ['owner', 'full_name'],
    ['user', 'full_name'],
    ['organizer'],
  ])

  const displayName =
    (accountName && accountName.toLowerCase() !== 'instagram' ? accountName : undefined) ||
    (sourceName && sourceName.toLowerCase() !== 'instagram' ? sourceName : undefined) ||
    (rawName && rawName.toLowerCase() !== 'instagram' ? rawName : undefined)

  return {
    username,
    displayName,
  }
}

const getExtractedEvents = (event: InstagramEventWithSource['event']): ExtractedEventDetails[] => {
  const parsed = parseEventRaw(event.raw)
  if (!parsed) return []

  if (Array.isArray(parsed.events)) {
    return parsed.events as ExtractedEventDetails[]
  }

  return []
}

const formatExtractedDateParts = (date?: string, time?: string, timezone?: string) => {
  const parts = [date, time, timezone].filter(Boolean)
  return parts.length ? parts.join(' • ') : undefined
}

const formatVenue = (venue?: ExtractedEventDetails['venue']) => {
  if (!venue) return undefined
  const parts = [venue.name, venue.address, venue.city, venue.region, venue.country].filter(Boolean)
  return parts.length ? parts.join(', ') : undefined
}

export function InstagramReview() {
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState<FilterType>('pending')
  const queryClient = useQueryClient()

  const { data: queue, isLoading } = useQuery({
    queryKey: ['instagram-review-queue', page, filter],
    queryFn: () => instagramReviewApi.getQueue({ page, limit: 20, filter }),
  })

  const { data: stats } = useQuery({
    queryKey: ['instagram-review-stats'],
    queryFn: () => instagramReviewApi.getStats(),
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

  const handleMarkAsEvent = (postId: string) => {
    classifyMutation.mutate({ id: postId, isEventPoster: true })
  }

  const handleMarkAsNotEvent = (postId: string) => {
    classifyMutation.mutate({ id: postId, isEventPoster: false })
  }

  const handleExtract = (postId: string, overwrite: boolean = false) => {
    extractMutation.mutate({ id: postId, overwrite })
  }

  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter as FilterType)
    setPage(1) // Reset to first page when changing filter
  }

  const groupedPosts = useMemo(() => {
    if (!queue?.posts?.length) return []

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

    queue.posts.forEach((item: InstagramEventWithSource) => {
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
        value.displayName ||
        (value.username ? `@${value.username}` : 'Unknown source')

      const accountUsername =
        value.username ||
        value.account?.instagramUsername ||
        undefined

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
  }, [queue?.posts])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Review Queue</h1>
        <p className="text-muted-foreground">
          Classify Instagram posts as events or non-events, then extract event data with AI
        </p>
      </div>

      {/* Stats Summary */}
      {stats && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Pending Review</p>
                <p className="text-2xl font-bold text-orange-600">{stats.unclassified}</p>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="flex gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Marked as Event</p>
                  <p className="text-xl font-semibold text-green-600">{stats.markedAsEvent}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Not Event</p>
                  <p className="text-xl font-semibold text-gray-500">{stats.markedAsNotEvent}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total</p>
                  <p className="text-xl font-semibold">{stats.total}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filter Tabs */}
      <Tabs value={filter} onValueChange={handleFilterChange}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="pending">
            Pending Review {stats && `(${stats.unclassified})`}
          </TabsTrigger>
          <TabsTrigger value="event">
            Marked as Event {stats && `(${stats.markedAsEvent})`}
          </TabsTrigger>
          <TabsTrigger value="not-event">
            Not Event {stats && `(${stats.markedAsNotEvent})`}
          </TabsTrigger>
          <TabsTrigger value="all">
            All {stats && `(${stats.total})`}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Review Queue */}
      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">Loading posts...</p>
            </CardContent>
          </Card>
        ) : !queue?.posts.length ? (
          <Card>
            <CardContent className="py-12">
              <div className="text-center">
                <CheckCircle className="h-16 w-16 text-green-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">All caught up!</h3>
                <p className="text-muted-foreground">
                  No posts waiting for review. Great job!
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="space-y-8">
              {groupedPosts.map(({ groupKey, posts, accountDisplayName, accountUsername, postCount }) => {
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
                            <Instagram className="h-4 w-4 text-muted-foreground" />
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
                      {posts.map(({ event, source, account: eventAccount }) => {
                        const extractedEvents = getExtractedEvents(event)
                        const hasExtraction = extractedEvents.length > 0
                        const accountLabel =
                          accountUsername
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
                          <Card key={event.id} className="hover:shadow-lg transition-shadow">
                            <CardHeader>
                              <div className="flex items-start justify-between gap-4">
                                <div className="flex-1">
                                  {accountLabel && (
                                    <div className="flex items-center gap-1 mb-2 text-xs text-muted-foreground">
                                      <Instagram className="h-3 w-3" />
                                      <span>{accountLabel}</span>
                                    </div>
                                  )}
                                  <CardTitle className="text-xl">{event.title}</CardTitle>
                                  <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-muted-foreground">
                                    <div className="flex items-center gap-1">
                                      <Calendar className="h-4 w-4" />
                                      <span>
                                        {new Date(event.scrapedAt).toLocaleString(undefined, {
                                          year: 'numeric',
                                          month: 'short',
                                          day: 'numeric',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </span>
                                    </div>
                                    {event.instagramPostId && (
                                      <Badge variant="outline" className="text-xs">
                                        #{event.instagramPostId}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              <div className="grid md:grid-cols-2 gap-4">
                                {/* Post Image */}
                                {event.localImagePath && (
                                  <div className="w-full">
                                    <div className="bg-muted rounded-md overflow-hidden">
                                      <img
                                        src={`${API_BASE_URL.replace('/api', '')}/api/instagram-backup/instagram-images/${event.localImagePath}`}
                                        alt={event.title}
                                        className="w-full h-auto max-h-96 object-contain"
                                      />
                                    </div>
                                  </div>
                                )}

                                {/* Post Details */}
                                <div className="space-y-3">
                                  {event.instagramCaption && (
                                    <div>
                                      <p className="text-xs font-medium text-muted-foreground mb-1">Caption</p>
                                      <p className="text-sm whitespace-pre-wrap line-clamp-6">
                                        {event.instagramCaption}
                                      </p>
                                    </div>
                                  )}

                                  {event.scrapedAt && (
                                    <div className="flex items-start gap-2">
                                      <Calendar className="h-4 w-4 text-muted-foreground mt-0.5" />
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground">Instagram Post Date</p>
                                        <p className="text-sm">
                                          {(() => {
                                            // Try to extract Instagram post timestamp from raw data
                                            const parsedRaw = parseEventRaw(event.raw);
                                            const instagramTimestamp =
                                              parsedRaw?.instagram?.timestamp ||
                                              parsedRaw?.timestamp ||
                                              parsedRaw?.post?.timestamp;

                                            const displayDate = instagramTimestamp
                                              ? new Date(instagramTimestamp)
                                              : new Date(event.scrapedAt);

                                            return displayDate.toLocaleDateString(undefined, {
                                              weekday: 'long',
                                              year: 'numeric',
                                              month: 'long',
                                              day: 'numeric',
                                            });
                                          })()}
                                        </p>
                                        {!parseEventRaw(event.raw)?.instagram?.timestamp &&
                                         !parseEventRaw(event.raw)?.timestamp &&
                                         !parseEventRaw(event.raw)?.post?.timestamp && (
                                          <p className="text-xs text-muted-foreground italic">
                                            (Showing scraped date - post date not available)
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  )}

                                  {event.venueName && (
                                    <div className="flex items-start gap-2">
                                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                                      <div>
                                        <p className="text-xs font-medium text-muted-foreground">Venue</p>
                                        <p className="text-sm">{event.venueName}</p>
                                      </div>
                                    </div>
                                  )}

                                  <div className="text-xs text-muted-foreground pt-2 border-t">
                                    Scraped {formatRelativeTime(event.scrapedAt)}
                                  </div>

                                  {event.url && (
                                    <a
                                      href={event.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-xs text-primary hover:underline flex items-center gap-1"
                                    >
                                      View original post
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  )}
                                </div>
                              </div>

                              {/* Classification Actions - only show for pending/all views */}
                              {(filter === 'pending' || filter === 'all') && event.isEventPoster === null && (
                                <div className="flex gap-3 pt-4 border-t">
                                  <Button
                                    onClick={() => handleMarkAsEvent(event.id)}
                                    disabled={classifyMutation.isPending}
                                    className="flex-1"
                                    size="lg"
                                  >
                                    <CheckCircle className="h-5 w-5 mr-2" />
                                    Mark Event
                                  </Button>
                                  <Button
                                    onClick={() => handleMarkAsNotEvent(event.id)}
                                    disabled={classifyMutation.isPending}
                                    variant="outline"
                                    className="flex-1"
                                    size="lg"
                                  >
                                    <XCircle className="h-5 w-5 mr-2" />
                                    Not Event
                                  </Button>
                                </div>
                              )}

                              {/* Classification Status - show for already-classified items */}
                              {event.isEventPoster !== null && (
                                <div className="pt-4 border-t space-y-3">
                                  <div className="flex items-center gap-2">
                                    {event.isEventPoster ? (
                                      <>
                                        <CheckCircle className="h-5 w-5 text-green-600" />
                                        <span className="text-sm font-medium text-green-600">Marked as Event</span>
                                      </>
                                    ) : (
                                      <>
                                        <XCircle className="h-5 w-5 text-gray-500" />
                                        <span className="text-sm font-medium text-gray-500">Marked as Not Event</span>
                                      </>
                                    )}
                                  </div>

                                  {/* Extraction buttons - only for events with images */}
                                  {event.isEventPoster && event.localImagePath && (
                                    <div className="flex flex-wrap items-center gap-2">
                                      {!hasExtraction ? (
                                        <Button
                                          onClick={() => handleExtract(event.id)}
                                          disabled={extractMutation.isPending}
                                          variant="default"
                                          size="sm"
                                          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                                        >
                                          {extractMutation.isPending ? (
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                          ) : (
                                            <Sparkles className="h-4 w-4 mr-2" />
                                          )}
                                          Extract Event Data with AI
                                        </Button>
                                      ) : (
                                        <>
                                          <Badge variant="secondary" className="text-xs flex items-center gap-1">
                                            <Sparkles className="h-3 w-3" />
                                            Event data extracted
                                          </Badge>
                                          <Dialog>
                                            <DialogTrigger asChild>
                                              <Button variant="outline" size="sm">
                                                View extracted data
                                              </Button>
                                            </DialogTrigger>
                                            <DialogContent className="sm:max-w-2xl">
                                              <DialogHeader>
                                                <DialogTitle>Extracted event details</DialogTitle>
                                                <DialogDescription>
                                                  {dialogSubject
                                                    ? `Results generated for ${dialogSubject}`
                                                    : 'Structured event data generated from this post'}
                                                </DialogDescription>
                                              </DialogHeader>
                                              <div className="space-y-4 max-h-[65vh] overflow-y-auto pr-1">
                                                {extractedEvents.map((extracted, index) => {
                                                  const start = formatExtractedDateParts(
                                                    extracted.startDate,
                                                    extracted.startTime,
                                                    extracted.timezone
                                                  )
                                                  const end = formatExtractedDateParts(
                                                    extracted.endDate,
                                                    extracted.endTime,
                                                    extracted.timezone
                                                  )
                                                  const venue = formatVenue(extracted.venue)
                                                  return (
                                                    <div key={`${event.id}-extracted-${index}`} className="space-y-3 rounded-md border p-4">
                                                      <div className="flex flex-wrap items-start justify-between gap-2">
                                                        <div>
                                                          <p className="text-base font-semibold">
                                                            {extracted.title || `Event ${index + 1}`}
                                                          </p>
                                                          {extracted.category && (
                                                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                                              {extracted.category}
                                                            </p>
                                                          )}
                                                        </div>
                                                        {extracted.url && (
                                                          <a
                                                            href={extracted.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-xs text-primary hover:underline"
                                                          >
                                                            Open linked URL
                                                          </a>
                                                        )}
                                                      </div>

                                                      {extracted.description && (
                                                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                                                          {extracted.description}
                                                        </p>
                                                      )}

                                                      <div className="grid gap-3 text-sm sm:grid-cols-2">
                                                        {start && (
                                                          <div>
                                                            <p className="font-medium text-foreground">Starts</p>
                                                            <p className="text-muted-foreground">{start}</p>
                                                          </div>
                                                        )}
                                                        {end && (
                                                          <div>
                                                            <p className="font-medium text-foreground">Ends</p>
                                                            <p className="text-muted-foreground">{end}</p>
                                                          </div>
                                                        )}
                                                        {venue && (
                                                          <div className="sm:col-span-2">
                                                            <p className="font-medium text-foreground">Venue</p>
                                                            <p className="text-muted-foreground">{venue}</p>
                                                          </div>
                                                        )}
                                                        {extracted.organizer && (
                                                          <div>
                                                            <p className="font-medium text-foreground">Organizer</p>
                                                            <p className="text-muted-foreground">{extracted.organizer}</p>
                                                          </div>
                                                        )}
                                                        {extracted.price && (
                                                          <div>
                                                            <p className="font-medium text-foreground">Price</p>
                                                            <p className="text-muted-foreground">{extracted.price}</p>
                                                          </div>
                                                        )}
                                                        {extracted.tags && extracted.tags.length > 0 && (
                                                          <div className="sm:col-span-2">
                                                            <p className="font-medium text-foreground">Tags</p>
                                                            <p className="text-muted-foreground">{extracted.tags.join(', ')}</p>
                                                          </div>
                                                        )}
                                                      </div>
                                                    </div>
                                                  )
                                                })}
                                                {extractedEvents.length === 0 && (
                                                  <p className="text-sm text-muted-foreground">
                                                    No structured events were stored for this post.
                                                  </p>
                                                )}
                                              </div>
                                            </DialogContent>
                                          </Dialog>
                                          <Button
                                            onClick={() => handleExtract(event.id, true)}
                                            disabled={extractMutation.isPending}
                                            variant="outline"
                                            size="sm"
                                          >
                                            {extractMutation.isPending ? (
                                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            ) : (
                                              <Sparkles className="h-4 w-4 mr-2" />
                                            )}
                                            Re-extract
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </CardContent>
                          </Card>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Pagination */}
            {queue && queue.pagination.totalPages > 1 && (
              <Card>
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!queue.pagination.hasPrev}
                        onClick={() => setPage(p => p - 1)}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!queue.pagination.hasNext}
                        onClick={() => setPage(p => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Page {queue.pagination.page} of {queue.pagination.totalPages} •{' '}
                      {queue.pagination.total} posts to review
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
