import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { InstagramEventWithSource } from '@/lib/api'
import { API_BASE_URL } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { InstagramExtractedEventDialog } from './InstagramExtractedEventDialog'
import { getExtractedEvents, parseEventRaw } from './InstagramReviewUtils'
import type { InstagramReviewFilter } from './types'
import {
  Bot,
  Calendar,
  CheckCircle,
  ExternalLink,
  Instagram,
  Loader2,
  MapPin,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react'

type InstagramReviewPostCardProps = {
  item: InstagramEventWithSource
  accountLabel?: string
  dialogSubject?: string
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

export function InstagramReviewPostCard({
  item,
  accountLabel,
  dialogSubject,
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
}: InstagramReviewPostCardProps) {
  const { event } = item
  const parsedRaw = parseEventRaw(event.raw)
  const extractedEvents = getExtractedEvents(event)
  const hasExtraction = extractedEvents.length > 0

  const instagramTimestamp =
    parsedRaw?.instagram?.timestamp || parsedRaw?.timestamp || parsedRaw?.post?.timestamp

  const handleExtract = () => onExtract(event.id)
  const handleReextract = () => onExtract(event.id, true)

  return (
    <Card className="transition-shadow hover:shadow-lg">
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
          <Button
            onClick={() => onDelete(event.id)}
            disabled={isDeletePending}
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            title="Delete post and image"
          >
            {isDeletePending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Trash2 className="h-5 w-5" />
            )}
          </Button>
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
                <p className="text-sm whitespace-pre-wrap line-clamp-6">{event.instagramCaption}</p>
              </div>
            )}

            {event.scrapedAt && (
              <div className="flex items-start gap-2">
                <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Instagram Post Date</p>
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
                onClick={() =>
                  event.isEventPoster ? onMarkAsNotEvent(event.id) : onMarkAsEvent(event.id)
                }
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
                    onClick={handleExtract}
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
                  <InstagramExtractedEventDialog
                    eventId={event.id}
                    dialogSubject={dialogSubject}
                    extractedEvents={extractedEvents}
                    isExtractPending={isExtractPending}
                    onReextract={handleReextract}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
