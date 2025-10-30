import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  API_BASE_URL,
  type InstagramEventWithSource,
  type InstagramReviewQueueResponse,
} from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import {
  Bot,
  Calendar,
  CheckCircle,
  ExternalLink,
  Instagram,
  Loader2,
  MapPin,
  Sparkles,
  XCircle,
} from 'lucide-react'

export type InstagramReviewFilter = 'pending' | 'event' | 'not-event' | 'all'

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
            <p className="text-muted-foreground">
              No posts waiting for review. Great job!
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <div className="space-y-8">
        {groupedPosts.map(({ groupKey, posts: grouped, accountDisplayName, accountUsername, postCount }) => {
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
                {grouped.map(({ event, source, account: eventAccount }) => {
                  const parsedRaw = parseEventRaw(event.raw)
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

                  const instagramTimestamp =
                    parsedRaw?.instagram?.timestamp ||
                    parsedRaw?.timestamp ||
                    parsedRaw?.post?.timestamp

                  return (
                    <Card key={event.id} className="transition-shadow hover:shadow-lg">
                      <CardHeader>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            {accountLabel && (
                              <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                                <Instagram className="h-3 w-3" />
                                <span>{accountLabel}</span>
                              </div>
                            )}
                            <CardTitle className="text-xl">{event.title}</CardTitle>
                            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
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
                        <div className="grid gap-4 md:grid-cols-2">
                          {event.localImagePath && (
                            <div className="w-full">
                              <div className="overflow-hidden rounded-md bg-muted">
                                <img
                                  src={`${API_BASE_URL.replace('/api', '')}/api/instagram-backup/instagram-images/${event.localImagePath}`}
                                  alt={event.title}
                                  className="h-auto max-h-96 w-full object-contain"
                                />
                              </div>
                            </div>
                          )}

                          <div className="space-y-3">
                            {event.instagramCaption && (
                              <div>
                                <p className="mb-1 text-xs font-medium text-muted-foreground">Caption</p>
                                <p className="text-sm whitespace-pre-wrap line-clamp-6">
                                  {event.instagramCaption}
                                </p>
                              </div>
                            )}

                            {event.scrapedAt && (
                              <div className="flex items-start gap-2">
                                <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground">
                                    Instagram Post Date
                                  </p>
                                  <p className="text-sm">
                                    {new Date(instagramTimestamp ?? event.scrapedAt).toLocaleDateString(undefined, {
                                      weekday: 'long',
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric',
                                    })}
                                  </p>
                                  {!instagramTimestamp && (
                                    <p className="text-xs italic text-muted-foreground">
                                      (Showing scraped date - post date not available)
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {event.venueName && (
                              <div className="flex items-start gap-2">
                                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <div>
                                  <p className="text-xs font-medium text-muted-foreground">Venue</p>
                                  <p className="text-sm">{event.venueName}</p>
                                </div>
                              </div>
                            )}

                            <div className="border-t pt-2 text-xs text-muted-foreground">
                              Scraped {formatRelativeTime(event.scrapedAt)}
                            </div>

                            {event.url && (
                              <a
                                href={event.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-primary hover:underline"
                              >
                                View original post
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>

                        {(filter === 'pending' || filter === 'all') && event.isEventPoster === null && (
                          <div className="space-y-3 border-t pt-4">
                            <Button
                              onClick={() => onAiClassify(event.id)}
                              disabled={isAiClassifyPending}
                              variant="secondary"
                              size="lg"
                              className="w-full"
                            >
                              {isAiClassifyPending ? (
                                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                              ) : (
                                <Bot className="mr-2 h-5 w-5" />
                              )}
                              Let AI Decide
                            </Button>
                            <div className="flex gap-3">
                              <Button
                                onClick={() => onMarkAsEvent(event.id)}
                                disabled={isClassifyPending || isAiClassifyPending}
                                className="flex-1"
                                size="lg"
                              >
                                <CheckCircle className="mr-2 h-5 w-5" />
                                Mark Event
                              </Button>
                              <Button
                                onClick={() => onMarkAsNotEvent(event.id)}
                                disabled={isClassifyPending || isAiClassifyPending}
                                variant="outline"
                                className="flex-1"
                                size="lg"
                              >
                                <XCircle className="mr-2 h-5 w-5" />
                                Not Event
                              </Button>
                            </div>
                          </div>
                        )}

                        {event.isEventPoster !== null && (
                          <div className="space-y-3 border-t pt-4">
                            <div className="flex items-center justify-between gap-2">
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
                              <Button
                                onClick={() => event.isEventPoster ? onMarkAsNotEvent(event.id) : onMarkAsEvent(event.id)}
                                disabled={isClassifyPending}
                                variant="ghost"
                                size="sm"
                              >
                                Change
                              </Button>
                            </div>

                            {event.isEventPoster && event.localImagePath && (
                              <div className="flex flex-wrap items-center gap-2">
                                {!hasExtraction ? (
                                  <Button
                                    onClick={() => onExtract(event.id)}
                                    disabled={isExtractPending}
                                    variant="default"
                                    size="sm"
                                    className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
                                  >
                                    {isExtractPending ? (
                                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                      <Sparkles className="mr-2 h-4 w-4" />
                                    )}
                                    Extract Event Data with AI
                                  </Button>
                                ) : (
                                  <>
                                    <Badge variant="secondary" className="flex items-center gap-1 text-xs">
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
                                        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
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
                                              <div
                                                key={`${event.id}-extracted-${index}`}
                                                className="space-y-3 rounded-md border p-4"
                                              >
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
                                                      <ExternalLink className="ml-1 inline h-3 w-3" />
                                                    </a>
                                                  )}
                                                </div>

                                                {start && (
                                                  <div className="flex items-start gap-2 text-sm">
                                                    <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                                    <div>
                                                      <p className="font-medium">Starts</p>
                                                      <p className="text-muted-foreground">{start}</p>
                                                    </div>
                                                  </div>
                                                )}

                                                {end && (
                                                  <div className="flex items-start gap-2 text-sm">
                                                    <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                                    <div>
                                                      <p className="font-medium">Ends</p>
                                                      <p className="text-muted-foreground">{end}</p>
                                                    </div>
                                                  </div>
                                                )}

                                                {venue && (
                                                  <div className="flex items-start gap-2 text-sm">
                                                    <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                                    <div>
                                                      <p className="font-medium">Venue</p>
                                                      <p className="text-muted-foreground">{venue}</p>
                                                    </div>
                                                  </div>
                                                )}

                                                {extracted.tags?.length ? (
                                                  <div className="flex flex-wrap gap-2 text-xs">
                                                    {extracted.tags.map((tag) => (
                                                      <Badge key={tag} variant="outline">
                                                        #{tag}
                                                      </Badge>
                                                    ))}
                                                  </div>
                                                ) : null}

                                                {extracted.description && (
                                                  <div>
                                                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                                      Description
                                                    </p>
                                                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                                                      {extracted.description}
                                                    </p>
                                                  </div>
                                                )}
                                              </div>
                                            )
                                          })}
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                          <Button
                                            onClick={() => onExtract(event.id, true)}
                                            disabled={isExtractPending}
                                            variant="outline"
                                            size="sm"
                                          >
                                            {isExtractPending ? (
                                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                              <Sparkles className="mr-2 h-4 w-4" />
                                            )}
                                            Re-extract
                                          </Button>
                                        </div>
                                      </DialogContent>
                                    </Dialog>
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

      {pagination && pagination.totalPages > 1 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasPrev}
                  onClick={onPrevPage}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!pagination.hasNext}
                  onClick={onNextPage}
                >
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
    return raw as Record<string, unknown>
  }

  return undefined
}

const findFirstString = (data: unknown, paths: string[][]) => {
  if (!data || typeof data !== 'object') return undefined

  for (const path of paths) {
    let current: unknown = data
    for (const key of path) {
      if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[key]
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

  if (Array.isArray((parsed as Record<string, unknown>).events)) {
    return (parsed as { events: ExtractedEventDetails[] }).events
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
