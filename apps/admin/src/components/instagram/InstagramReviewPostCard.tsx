import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { InstagramEventWithSource } from '@/lib/api'
import { API_BASE_URL } from '@/lib/api'
import { cn, formatRelativeTime } from '@/lib/utils'
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
  const swipeEnabled = (filter === 'pending' || filter === 'all') && event.isEventPoster === null

  const cardRef = useRef<HTMLDivElement>(null)
  const pointerIdRef = useRef<number | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const dragXRef = useRef(0)
  const resetTimerRef = useRef<number | null>(null)

  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null)

  const instagramTimestamp =
    parsedRaw?.instagram?.timestamp || parsedRaw?.timestamp || parsedRaw?.post?.timestamp

  const caption = event.instagramCaption || event.title
  const postDate = instagramTimestamp ?? event.scrapedAt

  const handleExtract = () => onExtract(event.id)
  const handleReextract = () => onExtract(event.id, true)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const resetDrag = () => {
    dragXRef.current = 0
    setDragX(0)
    setIsDragging(false)
    setSwipeDirection(null)
  }

  const scheduleReset = () => {
    if (resetTimerRef.current) {
      window.clearTimeout(resetTimerRef.current)
    }
    resetTimerRef.current = window.setTimeout(() => {
      resetDrag()
    }, 420)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!swipeEnabled || isClassifyPending || isAiClassifyPending) return
    if (event.pointerType !== 'touch') return

    const target = event.target as HTMLElement
    if (target.closest('button, a, input, textarea, select')) return

    pointerIdRef.current = event.pointerId
    startRef.current = { x: event.clientX, y: event.clientY }
    dragXRef.current = 0
    setSwipeDirection(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!swipeEnabled || pointerIdRef.current !== event.pointerId || !startRef.current) return

    const dx = event.clientX - startRef.current.x
    const dy = event.clientY - startRef.current.y

    if (!isDragging) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      if (Math.abs(dx) < Math.abs(dy)) {
        pointerIdRef.current = null
        startRef.current = null
        return
      }
      event.currentTarget.setPointerCapture(event.pointerId)
      setIsDragging(true)
    }

    event.preventDefault()
    dragXRef.current = dx
    setDragX(dx)
    if (dx > 0) {
      setSwipeDirection('right')
    } else if (dx < 0) {
      setSwipeDirection('left')
    } else {
      setSwipeDirection(null)
    }
  }

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!swipeEnabled || pointerIdRef.current !== e.pointerId) return

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    pointerIdRef.current = null
    startRef.current = null

    const dx = dragXRef.current
    const width = cardRef.current?.offsetWidth ?? 1
    const threshold = Math.min(140, width * 0.35)

    if (Math.abs(dx) >= threshold) {
      const direction = dx > 0 ? 'right' : 'left'
      const travel = (dx > 0 ? 1 : -1) * Math.max(width, threshold)
      setSwipeDirection(direction)
      setIsDragging(false)
      setDragX(travel)
      scheduleReset()

      if (direction === 'right') {
        onMarkAsEvent(event.id)
      } else {
        onMarkAsNotEvent(event.id)
      }
      return
    }

    resetDrag()
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (pointerIdRef.current === event.pointerId) {
      pointerIdRef.current = null
    }
    startRef.current = null
    resetDrag()
  }

  const showSwipeOverlay = swipeEnabled && (isDragging || Math.abs(dragX) > 0)
  const rotate = swipeEnabled ? dragX / 24 : 0
  const cardStyle = swipeEnabled
    ? {
        transform: `translateX(${dragX}px) rotate(${rotate}deg)`,
        transition: isDragging ? 'none' : 'transform 160ms ease',
      }
    : undefined

  const imageUrl = event.localImagePath
    ? `${API_BASE_URL.replace('/api', '')}/api/instagram-backup/instagram-images/${event.localImagePath}`
    : null

  return (
    <Card
      ref={cardRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={cardStyle}
      className={cn(
        'relative overflow-hidden transition-shadow hover:shadow-lg',
        swipeEnabled && 'touch-pan-y select-none'
      )}
    >
      {/* ===== MOBILE LAYOUT (below md) ===== */}
      <div className="md:hidden">
        {/* Image hero with gradient overlay */}
        {imageUrl && (
          <div className="relative">
            <img
              src={imageUrl}
              alt={caption}
              className="w-full object-cover"
              style={{ maxHeight: '70vh' }}
            />

            {/* Swipe direction indicators */}
            {swipeEnabled && (
              <div
                className={cn(
                  'pointer-events-none absolute inset-0 z-10 flex items-center justify-between px-6 transition-opacity',
                  showSwipeOverlay ? 'opacity-100' : 'opacity-0'
                )}
              >
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition shadow-lg',
                    swipeDirection === 'right'
                      ? 'bg-green-500 text-white'
                      : 'bg-black/40 text-white/60'
                  )}
                >
                  <CheckCircle className="h-4 w-4" />
                  <span>Event</span>
                </div>
                <div
                  className={cn(
                    'flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold uppercase tracking-wide transition shadow-lg',
                    swipeDirection === 'left'
                      ? 'bg-red-500 text-white'
                      : 'bg-black/40 text-white/60'
                  )}
                >
                  <XCircle className="h-4 w-4" />
                  <span>Skip</span>
                </div>
              </div>
            )}

            {/* Top bar: account + delete */}
            <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-between p-3 bg-gradient-to-b from-black/60 to-transparent">
              {accountLabel ? (
                <div className="flex items-center gap-1.5 text-white/90 text-sm font-medium">
                  <Instagram className="h-4 w-4" />
                  <span>{accountLabel}</span>
                </div>
              ) : (
                <div />
              )}
              <Button
                onClick={() => onDelete(event.id)}
                disabled={isDeletePending}
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/70 hover:text-white hover:bg-white/20"
                title="Delete post"
              >
                {isDeletePending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </Button>
            </div>

            {/* Bottom gradient with caption + date */}
            <div className="absolute bottom-0 inset-x-0 z-10 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4 pt-16">
              <p className="text-white text-sm font-medium line-clamp-3 leading-snug">
                {caption}
              </p>
              <div className="mt-2 flex items-center gap-3 text-white/70 text-xs">
                <div className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  <span>
                    {new Date(postDate).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                {event.instagramPostId && (
                  <span className="opacity-60">#{event.instagramPostId}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* No image fallback */}
        {!imageUrl && (
          <div className="p-4 space-y-2">
            {accountLabel && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Instagram className="h-3 w-3" />
                <span>{accountLabel}</span>
              </div>
            )}
            <p className="text-sm font-medium line-clamp-3">{caption}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              <span>
                {new Date(postDate).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </div>
          </div>
        )}

        {/* Mobile action buttons */}
        <div className="p-3 space-y-2">
          {event.url && (
            <a
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-primary hover:underline mb-1"
            >
              View original post
              <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {(filter === 'pending' || filter === 'all') && event.isEventPoster === null && (
            <div className="space-y-2">
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
              <div className="flex gap-2">
                <Button
                  onClick={() => onMarkAsEvent(event.id)}
                  disabled={isClassifyPending || isAiClassifyPending}
                  className="flex-1"
                  size="lg"
                >
                  <CheckCircle className="mr-2 h-5 w-5" />
                  Event
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
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {event.isEventPoster ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-600">Event</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-gray-500" />
                      <span className="text-sm font-medium text-gray-500">Not Event</span>
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
                      Extract with AI
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
        </div>
      </div>

      {/* ===== DESKTOP LAYOUT (md and above) ===== */}
      <div className="hidden md:block">
        <div className="flex flex-col space-y-1.5 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              {accountLabel && (
                <div className="mb-2 flex items-center gap-1 text-xs text-muted-foreground">
                  <Instagram className="h-3 w-3" />
                  <span>{accountLabel}</span>
                </div>
              )}
              <h3 className="font-semibold tracking-tight text-xl">{event.title}</h3>
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
        </div>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {imageUrl && (
              <div className="w-full">
                <div className="overflow-hidden rounded-md bg-muted">
                  <img
                    src={imageUrl}
                    alt={event.title}
                    className="h-auto max-h-96 w-full object-contain"
                  />
                </div>
              </div>
            )}

            <div className="space-y-3">
              {event.scrapedAt && (
                <div className="flex items-start gap-2">
                  <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Instagram Post Date</p>
                    <p className="text-sm">
                      {new Date(postDate).toLocaleDateString(undefined, {
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
      </div>
    </Card>
  )
}
