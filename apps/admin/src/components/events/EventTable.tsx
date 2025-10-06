import { DialogTrigger } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { EventWithSource, EventsQueryParams } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Calendar, MapPin, ExternalLink, AlertCircle, Eye, ArrowUpDown, ArrowUp, ArrowDown, Repeat } from 'lucide-react'
import { EventDetailDialog } from './EventDetailDialog'

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
  const getSortIcon = (field: string) => {
    if (filters.sortBy !== field) {
      return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
    }
    return filters.sortOrder === 'desc'
      ? <ArrowDown className="h-4 w-4" />
      : <ArrowUp className="h-4 w-4" />
  }

  const getMissingFields = (event: EventWithSource) => {
    const missing = []
    if (!event.event.descriptionHtml) missing.push('Description')
    if (!event.event.venueName) missing.push('Venue')
    if (!event.event.city) missing.push('City')
    if (!event.event.organizer) missing.push('Organizer')
    if (!event.event.category) missing.push('Category')
    return missing
  }

  const isEventSeries = (event: EventWithSource) => {
    const seriesDates = event.event.raw?.seriesDates
    return Array.isArray(seriesDates) && seriesDates.length > 1
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
                        <p className="font-medium text-sm">{event.title}</p>
                        <Badge variant="outline" className="text-xs flex items-center gap-1">
                          <Repeat className="h-3 w-3" />
                          {index + 1}/{seriesCount}
                        </Badge>
                      </div>
                      {event.category && (
                        <Badge variant="secondary" className="text-xs mt-1">
                          {event.category}
                        </Badge>
                      )}
                      {event.organizer && (
                        <p className="text-xs text-muted-foreground mt-1">
                          by {event.organizer}
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
                      {event.price && (
                        <Badge variant="success" className="text-xs">
                          {event.price}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
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
          const eventDate = new Date(event.startDatetime)

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
                    <p className="font-medium text-sm">{event.title}</p>
                  </div>
                  {event.category && (
                    <Badge variant="secondary" className="text-xs mt-1">
                      {event.category}
                    </Badge>
                  )}
                  {event.organizer && (
                    <p className="text-xs text-muted-foreground mt-1">
                      by {event.organizer}
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
                  {event.price && (
                    <Badge variant="success" className="text-xs">
                      {event.price}
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex gap-2">
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
