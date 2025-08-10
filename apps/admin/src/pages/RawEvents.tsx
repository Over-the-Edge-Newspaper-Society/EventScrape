import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { eventsApi, sourcesApi, EventsQueryParams } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Search, Filter, Calendar, MapPin, ExternalLink, AlertCircle } from 'lucide-react'

export function RawEvents() {
  const [filters, setFilters] = useState<EventsQueryParams>({
    page: 1,
    limit: 20,
  })
  const [searchQuery, setSearchQuery] = useState('')

  const { data: events, isLoading } = useQuery({
    queryKey: ['events', 'raw', filters],
    queryFn: () => eventsApi.getRaw(filters),
  })

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.getAll(),
  })

  const handleFilterChange = (key: keyof EventsQueryParams, value: any) => {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      page: 1, // Reset to first page when filtering
    }))
  }

  const handleSearch = () => {
    handleFilterChange('search', searchQuery)
  }

  const handlePageChange = (newPage: number) => {
    setFilters(prev => ({ ...prev, page: newPage }))
  }

  const getMissingFields = (event: any) => {
    const missing = []
    if (!event.event.descriptionHtml) missing.push('Description')
    if (!event.event.venueName) missing.push('Venue')
    if (!event.event.city) missing.push('City')
    if (!event.event.organizer) missing.push('Organizer')
    if (!event.event.category) missing.push('Category')
    return missing
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Raw Events</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Browse and filter events scraped from sources
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div className="flex gap-2">
              <Input
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1"
              />
              <Button onClick={handleSearch} size="sm">
                <Search className="h-4 w-4" />
              </Button>
            </div>

            {/* Source Filter */}
            <Select onValueChange={(value) => handleFilterChange('sourceId', value === 'all' ? undefined : value)}>
              <SelectTrigger>
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources?.sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* City Filter */}
            <Input
              placeholder="Filter by city"
              value={filters.city || ''}
              onChange={(e) => handleFilterChange('city', e.target.value || undefined)}
            />

            {/* Special Filters */}
            <Select onValueChange={(value) => {
              if (value === 'duplicates') {
                handleFilterChange('hasDuplicates', true)
                handleFilterChange('missingFields', undefined)
              } else if (value === 'missing') {
                handleFilterChange('missingFields', true)
                handleFilterChange('hasDuplicates', undefined)
              } else {
                handleFilterChange('hasDuplicates', undefined)
                handleFilterChange('missingFields', undefined)
              }
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Special filters" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All events</SelectItem>
                <SelectItem value="duplicates">Has duplicates</SelectItem>
                <SelectItem value="missing">Missing fields</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Events Table */}
      <Card>
        <CardHeader>
          <CardTitle>Raw Events</CardTitle>
          <CardDescription>
            {events?.pagination.total
              ? `${events.pagination.total} total events • Page ${events.pagination.page} of ${events.pagination.totalPages}`
              : 'Loading events...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading events...</p>
            </div>
          ) : !events?.events.length ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No events found</p>
            </div>
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead>
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.events.map(({ event, source }) => {
                    const missingFields = getMissingFields({ event, source })
                    const eventDate = new Date(event.startDatetime)
                    
                    return (
                      <TableRow key={event.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium text-sm">{event.title}</p>
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
                              <Badge variant="outline" className="text-xs">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                {missingFields.length} missing
                              </Badge>
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
                                View
                              </a>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Pagination */}
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
                  Showing {((events.pagination.page - 1) * events.pagination.limit) + 1} to{' '}
                  {Math.min(events.pagination.page * events.pagination.limit, events.pagination.total)} of{' '}
                  {events.pagination.total} results
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}