import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { EventWithSource, EventsQueryParams, instagramReviewApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Calendar, MapPin, ExternalLink, AlertCircle, Eye, ArrowUpDown, ArrowUp, ArrowDown, Repeat, Sparkles, Loader2 } from 'lucide-react'
import { EventDetailDialog } from './EventDetailDialog'
import { toast } from 'sonner'

interface EventTableProps {
  events: EventWithSource[]
  selectedEvents: Set<string>
  filters: EventsQueryParams
  onSelectEvent: (eventId: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onSort: (field: 'title' | 'startDatetime' | 'city' | 'source') => void
}

export function EventTable({
  events,
  selectedEvents,
  filters,
  onSelectEvent,
  onSelectAll,
  onSort
}: EventTableProps) {
  const queryClient = useQueryClient()
  const [extractingIds, setExtractingIds] = useState<Set<string>>(new Set())

  const extractMutation = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      instagramReviewApi.extractEvent(id, { overwrite: true, createEvents: true }),
    onSuccess: (data, variables) => {
      setExtractingIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(variables.id)
        return newSet
      })
      queryClient.invalidateQueries({ queryKey: ['events', 'raw'] })
      toast.success(data.message, {
        description: `Created ${data.eventsCreated} event record(s)`,
      })
    },
    onError: (error: any, variables) => {
      setExtractingIds(prev => {
        const newSet = new Set(prev)
        newSet.delete(variables.id)
        return newSet
      })
      if (error.message?.includes('Gemini API key')) {
        toast.error('Gemini API key not configured', {
          description: 'Configure in Instagram Settings',
        })
      } else if (error.message?.includes('local image')) {
        toast.error('Post does not have a downloaded image')
      } else {
        toast.error('Failed to extract event data', {
          description: error.message || 'Unknown error',
        })
      }
    },
  })

  const handleReExtract = (eventId: string) => {
    setExtractingIds(prev => new Set(prev).add(eventId))
    extractMutation.mutate({ id: eventId })
  }

  const isInstagramEvent = (source: EventWithSource['source']) => {
    return source.sourceType === 'instagram' || source.moduleKey?.includes('instagram')
  }

  const hasLocalImage = (event: EventWithSource['event']) => {
    return !!event.localImagePath
  }

  const hasExtractedData = (event: EventWithSource['event']) => {
    try {
      const parsed = typeof event.raw === 'string' ? JSON.parse(event.raw) : event.raw
      return parsed?.events && parsed.events.length > 0
    } catch {
      return false
    }
  }

  const getSortIcon = (field: string) => {
    if (filters.sortBy !== field) {
      return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
    }
    return filters.sortOrder === 'desc'
      ? <ArrowDown className="h-4 w-4" />
      : <ArrowUp className="h-4 w-4" />
  }

  // Helper to get display title - use Gemini extraction if available
  const getDisplayTitle = (event: EventWithSource['event']) => {
    // Check if raw data contains Gemini extraction
    const geminiEvent = event.raw?.events?.[0]
    if (geminiEvent?.title) {
      return geminiEvent.title
    }
    return event.title
  }

  // Helper to get display dates - use Gemini extraction if available
  const getDisplayDates = (event: EventWithSource['event']) => {
    const geminiEvent = event.raw?.events?.[0]
    if (geminiEvent?.startDate && geminiEvent?.startTime) {
      // Combine date and time from Gemini extraction
      const startDatetime = new Date(`${geminiEvent.startDate}T${geminiEvent.startTime}`)
      let endDatetime = null

      if (geminiEvent.endDate && geminiEvent.endTime) {
        endDatetime = new Date(`${geminiEvent.endDate}T${geminiEvent.endTime}`)
      }

      return { startDatetime, endDatetime }
    }

    // Fallback to database values
    return {
      startDatetime: new Date(event.startDatetime),
      endDatetime: event.endDatetime ? new Date(event.endDatetime) : null
    }
  }

  // Helper to get display category - use Gemini extraction if available
  const getDisplayCategory = (event: EventWithSource['event']) => {
    const geminiEvent = event.raw?.events?.[0]
    if (geminiEvent?.category) {
      return geminiEvent.category
    }
    return event.category
  }

  // Helper to get display organizer - use Gemini extraction if available
  const getDisplayOrganizer = (event: EventWithSource['event']) => {
    const geminiEvent = event.raw?.events?.[0]
    if (geminiEvent?.organizer) {
      return geminiEvent.organizer
    }
    return event.organizer
  }

  // Helper to get display price - use Gemini extraction if available
  const getDisplayPrice = (event: EventWithSource['event']) => {
    const geminiEvent = event.raw?.events?.[0]
    if (geminiEvent?.price) {
      return geminiEvent.price
    }
    return event.price
  }

  const getMissingFields = (event: EventWithSource) => {
    const missing = []
    const geminiEvent = event.event.raw?.events?.[0]

    // Check description - from database or Gemini extraction
    if (!event.event.descriptionHtml && !geminiEvent?.description) {
      missing.push('Description')
    }

    // Check venue - from database or Gemini extraction
    if (!event.event.venueName && !geminiEvent?.venue?.name) {
      missing.push('Venue')
    }

    // Check city - from database or Gemini extraction
    if (!event.event.city && !geminiEvent?.venue?.city) {
      missing.push('City')
    }

    // Check organizer - from database or Gemini extraction
    if (!event.event.organizer && !geminiEvent?.organizer) {
      missing.push('Organizer')
    }

    // Check category - from database or Gemini extraction
    if (!event.event.category && !geminiEvent?.category) {
      missing.push('Category')
    }

    return missing
  }

  const isEventSeries = (event: EventWithSource) => {
    const seriesDates = event.event.raw?.seriesDates
    return Array.isArray(seriesDates) && seriesDates.length > 1
  }

  const renderReExtractButton = (event: EventWithSource['event'], source: EventWithSource['source']) => {
    // Only show for Instagram events with local images
    if (!isInstagramEvent(source) || !hasLocalImage(event)) {
      return null
    }

    const isExtracting = extractingIds.has(event.id)
    const hasData = hasExtractedData(event)

    return (
      <Button
        size="sm"
        variant={hasData ? "outline" : "default"}
        onClick={() => handleReExtract(event.id)}
        disabled={isExtracting}
        className={hasData ? "" : "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"}
        title={hasData ? "Re-extract event data with Gemini AI" : "Extract event data with Gemini AI"}
      >
        {isExtracting ? (
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3 mr-1" />
        )}
        {hasData ? 'Re-extract' : 'Extract'}
      </Button>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">
            <Checkbox
              checked={events.length > 0 && events.every(({ event }) => selectedEvents.has(event.id))}
              onCheckedChange={onSelectAll}
              aria-label="Select all events"
            />
          </TableHead>
          <TableHead>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 h-8 data-[state=open]:bg-accent"
              onClick={() => onSort('title')}
            >
              Event
              {getSortIcon('title')}
            </Button>
          </TableHead>
          <TableHead>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 h-8 data-[state=open]:bg-accent"
              onClick={() => onSort('startDatetime')}
            >
              Date/Time
              {getSortIcon('startDatetime')}
            </Button>
          </TableHead>
          <TableHead>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 h-8 data-[state=open]:bg-accent"
              onClick={() => onSort('city')}
            >
              Location
              {getSortIcon('city')}
            </Button>
          </TableHead>
          <TableHead>
            <Button
              variant="ghost"
              size="sm"
              className="-ml-3 h-8 data-[state=open]:bg-accent"
              onClick={() => onSort('source')}
            >
              Source
              {getSortIcon('source')}
            </Button>
          </TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {events.flatMap(({ event, source }) => {
          const missingFields = getMissingFields({ event, source })
          const isSeries = isEventSeries({ event, source })
          const seriesDates = isSeries ? event.raw?.seriesDates || [] : []
          const seriesCount = seriesDates.length

          // If it's a series, create a row for each occurrence
          if (isSeries && seriesDates.length > 0) {
            return seriesDates.map((dateInfo: any, index: number) => {
              const eventDate = new Date(dateInfo.start)
              const endDate = dateInfo.end ? new Date(dateInfo.end) : null
              const occurrenceId = `${event.id}-occurrence-${index}`

              return (
                <TableRow key={occurrenceId} className="group">
                  <TableCell>
                    <Checkbox
                      checked={selectedEvents.has(event.id)}
                      onCheckedChange={(checked) => onSelectEvent(event.id, checked as boolean)}
                      aria-label={`Select event ${event.title}`}
                    />
                  </TableCell>
                  <TableCell>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-sm">{getDisplayTitle(event)}</p>
                        <Badge variant="outline" className="text-xs flex items-center gap-1">
                          <Repeat className="h-3 w-3" />
                          {index + 1}/{seriesCount}
                        </Badge>
                      </div>
                      {getDisplayCategory(event) && (
                        <Badge variant="secondary" className="text-xs mt-1">
                          {getDisplayCategory(event)}
                        </Badge>
                      )}
                      {getDisplayOrganizer(event) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          by {getDisplayOrganizer(event)}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm">{eventDate.toLocaleDateString()}</p>
                        <p className="text-xs text-muted-foreground">
                          {eventDate.toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'America/Vancouver'
                          })}
                          {endDate && (
                            <> - {endDate.toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: 'America/Vancouver'
                            })}</>
                          )}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                      <div>
                        {event.venueName && (
                          <p className="text-sm font-medium">{event.venueName}</p>
                        )}
                        {event.city && (
                          <p className="text-xs text-muted-foreground">
                            {event.city}{event.region && `, ${event.region}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{source.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatRelativeTime(event.scrapedAt)}
                      </p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      {missingFields.length > 0 && (
                        <div className="relative group">
                          <Badge
                            variant="outline"
                            className="text-xs cursor-help hover:bg-accent transition-colors"
                            title={`Missing: ${missingFields.join(', ')}`}
                          >
                            <AlertCircle className="h-3 w-3 mr-1" />
                            {missingFields.length} missing
                          </Badge>
                          <div className="absolute z-10 invisible group-hover:visible bg-white border border-gray-200 rounded-md shadow-lg p-3 bottom-full left-0 mb-2 min-w-max">
                            <div className="space-y-1">
                              <p className="font-medium text-sm">Missing fields:</p>
                              <ul className="text-sm text-muted-foreground">
                                {missingFields.map((field, idx) => (
                                  <li key={idx} className="flex items-center gap-1">
                                    <span className="w-1 h-1 bg-current rounded-full"></span>
                                    {field}
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-200"></div>
                          </div>
                        </div>
                      )}
                      {getDisplayPrice(event) && (
                        <Badge variant="success" className="text-xs">
                          {getDisplayPrice(event)}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2 flex-wrap">
                      {renderReExtractButton(event, source)}

                      <EventDetailDialog event={{ event, source }}>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-1"
                          >
                            <Eye className="h-3 w-3" />
                            Details
                          </Button>
                        </DialogTrigger>
                      </EventDetailDialog>

                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                      >
                        <a
                          href={event.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Original
                        </a>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })
          }

          // Otherwise, show a single row for non-series events
          const { startDatetime: eventDate, endDatetime: eventEndDate } = getDisplayDates(event)

          return (
            <TableRow key={event.id}>
              <TableCell>
                <Checkbox
                  checked={selectedEvents.has(event.id)}
                  onCheckedChange={(checked) => onSelectEvent(event.id, checked as boolean)}
                  aria-label={`Select event ${event.title}`}
                />
              </TableCell>
              <TableCell>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">{getDisplayTitle(event)}</p>
                  </div>
                  {getDisplayCategory(event) && (
                    <Badge variant="secondary" className="text-xs mt-1">
                      {getDisplayCategory(event)}
                    </Badge>
                  )}
                  {getDisplayOrganizer(event) && (
                    <p className="text-xs text-muted-foreground mt-1">
                      by {getDisplayOrganizer(event)}
                    </p>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm">{eventDate.toLocaleDateString()}</p>
                    <p className="text-xs text-muted-foreground">
                      {eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {eventEndDate && (
                        <> - {eventEndDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</>
                      )}
                    </p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    {event.venueName && (
                      <p className="text-sm font-medium">{event.venueName}</p>
                    )}
                    {event.city && (
                      <p className="text-xs text-muted-foreground">
                        {event.city}{event.region && `, ${event.region}`}
                      </p>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div>
                  <p className="text-sm font-medium">{source.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(event.scrapedAt)}
                  </p>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-1">
                  {missingFields.length > 0 && (
                    <div className="relative group">
                      <Badge
                        variant="outline"
                        className="text-xs cursor-help hover:bg-accent transition-colors"
                        title={`Missing: ${missingFields.join(', ')}`}
                      >
                        <AlertCircle className="h-3 w-3 mr-1" />
                        {missingFields.length} missing
                      </Badge>
                      <div className="absolute z-10 invisible group-hover:visible bg-white border border-gray-200 rounded-md shadow-lg p-3 bottom-full left-0 mb-2 min-w-max">
                        <div className="space-y-1">
                          <p className="font-medium text-sm">Missing fields:</p>
                          <ul className="text-sm text-muted-foreground">
                            {missingFields.map((field, index) => (
                              <li key={index} className="flex items-center gap-1">
                                <span className="w-1 h-1 bg-current rounded-full"></span>
                                {field}
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-200"></div>
                      </div>
                    </div>
                  )}
                  {getDisplayPrice(event) && (
                    <Badge variant="success" className="text-xs">
                      {getDisplayPrice(event)}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex gap-2 flex-wrap">
                  {renderReExtractButton(event, source)}

                  <EventDetailDialog event={{ event, source }}>
                    <DialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex items-center gap-1"
                      >
                        <Eye className="h-3 w-3" />
                        Details
                      </Button>
                    </DialogTrigger>
                  </EventDetailDialog>

                  <Button
                    size="sm"
                    variant="outline"
                    asChild
                  >
                    <a
                      href={event.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Original
                    </a>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
