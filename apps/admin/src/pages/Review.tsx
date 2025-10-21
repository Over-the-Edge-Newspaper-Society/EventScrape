import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { eventsApi, EventsQueryParams, EventWithSource } from '@/lib/api'
import { CheckCircle, XCircle, Eye, Calendar, MapPin, Tag, ExternalLink } from 'lucide-react'
import { EventFilters } from '@/components/events/EventFilters'
import { sourcesApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'

export function Review() {
  const [filters, setFilters] = useState<EventsQueryParams>({
    page: 1,
    limit: 20,
    sortBy: 'startDatetime',
    sortOrder: 'desc',
  })
  const [selectedEvent, setSelectedEvent] = useState<EventWithSource | null>(null)
  const [showDetailDialog, setShowDetailDialog] = useState(false)
  const queryClient = useQueryClient()

  const { data: events, isLoading } = useQuery({
    queryKey: ['events', 'raw', filters],
    queryFn: () => eventsApi.getRaw(filters),
  })

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.getAll(),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => eventsApi.deleteRaw(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'raw'] })
      setShowDetailDialog(false)
      setSelectedEvent(null)
    },
  })

  const handleFilterChange = (key: keyof EventsQueryParams, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1,
    }))
  }

  const handlePageChange = (newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }))
  }

  const handleViewDetails = (event: EventWithSource) => {
    setSelectedEvent(event)
    setShowDetailDialog(true)
  }

  const handleApprove = async (eventId: string) => {
    // In a full implementation, this would create a canonical event
    // For now, we'll just show a toast
    console.log('Approve event:', eventId)
  }

  const handleReject = async (eventId: string) => {
    if (confirm('Are you sure you want to reject and delete this event?')) {
      deleteMutation.mutate(eventId)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Review Events</h1>
        <p className="text-muted-foreground">
          Review and approve raw events before they become canonical events
        </p>
      </div>

      {/* Filters */}
      <EventFilters
        filters={filters}
        sources={sources?.sources}
        onFilterChange={handleFilterChange}
        onSearch={() => {}}
      />

      {/* Events Grid */}
      <div className="space-y-4">
        {isLoading ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">Loading events...</p>
            </CardContent>
          </Card>
        ) : !events?.events.length ? (
          <Card>
            <CardContent className="py-8">
              <p className="text-center text-muted-foreground">No events to review</p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {events.events.map(({ event, source }) => (
                <Card key={event.id} className="hover:shadow-lg transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg line-clamp-2">{event.title}</CardTitle>
                      <Badge variant="secondary" className="shrink-0">
                        {source.name}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Event Image */}
                    {event.imageUrl && (
                      <div className="w-full h-40 bg-muted rounded-md overflow-hidden">
                        <img
                          src={event.imageUrl}
                          alt={event.title}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}

                    {/* Event Details */}
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4 shrink-0" />
                        <span className="truncate">
                          {new Date(event.startDatetime).toLocaleDateString(undefined, {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      </div>

                      {event.venueName && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <MapPin className="h-4 w-4 shrink-0" />
                          <span className="truncate">{event.venueName}</span>
                        </div>
                      )}

                      {event.city && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Tag className="h-4 w-4 shrink-0" />
                          <span className="truncate">{event.city}</span>
                        </div>
                      )}

                      <div className="text-xs text-muted-foreground">
                        Scraped {formatRelativeTime(event.scrapedAt)}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleViewDetails({ event, source })}
                        className="flex-1"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleApprove(event.id)}
                        className="flex-1"
                      >
                        <CheckCircle className="h-4 w-4 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleReject(event.id)}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Pagination */}
            <Card>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!events.pagination.hasPrev}
                      onClick={() => handlePageChange(events.pagination.page - 1)}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!events.pagination.hasNext}
                      onClick={() => handlePageChange(events.pagination.page + 1)}
                    >
                      Next
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Page {events.pagination.page} of {events.pagination.totalPages} •{' '}
                    {events.pagination.total} total events
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          {selectedEvent && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedEvent.event.title}</DialogTitle>
                <DialogDescription>
                  From {selectedEvent.source.name} • Scraped{' '}
                  {formatRelativeTime(selectedEvent.event.scrapedAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                {/* Event Image */}
                {selectedEvent.event.imageUrl && (
                  <div className="w-full rounded-md overflow-hidden">
                    <img
                      src={selectedEvent.event.imageUrl}
                      alt={selectedEvent.event.title}
                      className="w-full"
                    />
                  </div>
                )}

                {/* Event Details */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-medium text-muted-foreground">Start Date</p>
                    <p>
                      {new Date(selectedEvent.event.startDatetime).toLocaleString(undefined, {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>

                  {selectedEvent.event.endDatetime && (
                    <div>
                      <p className="font-medium text-muted-foreground">End Date</p>
                      <p>
                        {new Date(selectedEvent.event.endDatetime).toLocaleString(undefined, {
                          weekday: 'long',
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  )}

                  {selectedEvent.event.venueName && (
                    <div>
                      <p className="font-medium text-muted-foreground">Venue</p>
                      <p>{selectedEvent.event.venueName}</p>
                    </div>
                  )}

                  {selectedEvent.event.city && (
                    <div>
                      <p className="font-medium text-muted-foreground">City</p>
                      <p>{selectedEvent.event.city}</p>
                    </div>
                  )}

                  {selectedEvent.event.organizer && (
                    <div>
                      <p className="font-medium text-muted-foreground">Organizer</p>
                      <p>{selectedEvent.event.organizer}</p>
                    </div>
                  )}

                  {selectedEvent.event.category && (
                    <div>
                      <p className="font-medium text-muted-foreground">Category</p>
                      <p>{selectedEvent.event.category}</p>
                    </div>
                  )}

                  {selectedEvent.event.price && (
                    <div>
                      <p className="font-medium text-muted-foreground">Price</p>
                      <p>{selectedEvent.event.price}</p>
                    </div>
                  )}
                </div>

                {/* Description */}
                {selectedEvent.event.descriptionHtml && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-2">Description</p>
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: selectedEvent.event.descriptionHtml }}
                    />
                  </div>
                )}

                {/* Tags */}
                {selectedEvent.event.tags && selectedEvent.event.tags.length > 0 && (
                  <div>
                    <p className="font-medium text-muted-foreground mb-2">Tags</p>
                    <div className="flex flex-wrap gap-2">
                      {selectedEvent.event.tags.map((tag, idx) => (
                        <Badge key={idx} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Source URL */}
                <div>
                  <p className="font-medium text-muted-foreground mb-2">Source URL</p>
                  <a
                    href={selectedEvent.event.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    {selectedEvent.event.url}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4 border-t">
                  <Button
                    variant="default"
                    onClick={() => handleApprove(selectedEvent.event.id)}
                    className="flex-1"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Approve Event
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => handleReject(selectedEvent.event.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Reject & Delete
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
