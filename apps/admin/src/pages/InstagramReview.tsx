import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { instagramReviewApi, API_BASE_URL } from '@/lib/api'
import { CheckCircle, XCircle, Calendar, MapPin, Instagram, ExternalLink } from 'lucide-react'
import { formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'

type FilterType = 'pending' | 'event' | 'not-event' | 'all'

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

  const handleMarkAsEvent = (postId: string) => {
    classifyMutation.mutate({ id: postId, isEventPoster: true })
  }

  const handleMarkAsNotEvent = (postId: string) => {
    classifyMutation.mutate({ id: postId, isEventPoster: false })
  }

  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter as FilterType)
    setPage(1) // Reset to first page when changing filter
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Review Queue</h1>
        <p className="text-muted-foreground">
          Classify Instagram posts as events or non-events
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
            <div className="grid grid-cols-1 gap-4">
              {queue.posts.map(({ event, source }) => (
                <Card key={event.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge variant="secondary" className="shrink-0">
                            {source.name}
                          </Badge>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Instagram className="h-3 w-3" />
                            <span>@{source.instagramUsername}</span>
                          </div>
                        </div>
                        <CardTitle className="text-xl">{event.title}</CardTitle>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
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
                              <p className="text-xs font-medium text-muted-foreground">Post Date</p>
                              <p className="text-sm">
                                {new Date(event.scrapedAt).toLocaleDateString(undefined, {
                                  weekday: 'long',
                                  year: 'numeric',
                                  month: 'long',
                                  day: 'numeric',
                                })}
                              </p>
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
                      <div className="pt-4 border-t">
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
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
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
