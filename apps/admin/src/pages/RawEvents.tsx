import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { eventsApi, sourcesApi, EventsQueryParams, EventWithSource } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Search, Filter, Calendar, MapPin, ExternalLink, AlertCircle, Trash2, Eye, Database, Code, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react'

interface EventDetailViewProps {
  event: EventWithSource
  onClose?: () => void
}

function EventDetailView({ event }: EventDetailViewProps) {
  const eventData = event.event
  const sourceData = event.source

  const formatFieldValue = (value: any, fieldName: string) => {
    if (value === null || value === undefined) {
      return <span className="text-muted-foreground italic">Not provided</span>
    }
    
    if (fieldName === 'startDatetime' || fieldName === 'endDatetime' || fieldName === 'scrapedAt') {
      // For Prince George events, display in Pacific Time instead of converting to browser's timezone
      const date = new Date(value)
      const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'numeric', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Vancouver' // Pacific Time for Prince George, BC
      }
      return date.toLocaleString('en-US', options)
    }
    
    if (fieldName === 'tags' && Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : <span className="text-muted-foreground italic">None</span>
    }
    
    if (fieldName === 'descriptionHtml' && value) {
      return (
        <div className="max-h-40 overflow-y-auto">
          <div dangerouslySetInnerHTML={{ __html: value }} className="prose prose-sm max-w-none" />
        </div>
      )
    }
    
    return String(value)
  }

  const structuredFields = [
    { key: 'id', label: 'Event ID', value: eventData.id },
    { key: 'sourceEventId', label: 'Source Event ID', value: eventData.sourceEventId },
    { key: 'title', label: 'Title', value: eventData.title },
    { key: 'descriptionHtml', label: 'Description', value: eventData.descriptionHtml },
    { key: 'startDatetime', label: 'Start Date/Time', value: eventData.startDatetime },
    { key: 'endDatetime', label: 'End Date/Time', value: eventData.endDatetime },
    { key: 'timezone', label: 'Timezone', value: eventData.timezone },
    { key: 'venueName', label: 'Venue Name', value: eventData.venueName },
    { key: 'venueAddress', label: 'Venue Address', value: eventData.venueAddress },
    { key: 'city', label: 'City', value: eventData.city },
    { key: 'region', label: 'Region', value: eventData.region },
    { key: 'country', label: 'Country', value: eventData.country },
    { key: 'lat', label: 'Latitude', value: eventData.lat },
    { key: 'lon', label: 'Longitude', value: eventData.lon },
    { key: 'organizer', label: 'Organizer', value: eventData.organizer },
    { key: 'category', label: 'Category', value: eventData.category },
    { key: 'price', label: 'Price', value: eventData.price },
    { key: 'tags', label: 'Tags', value: eventData.tags },
    { key: 'url', label: 'URL', value: eventData.url },
    { key: 'imageUrl', label: 'Image URL', value: eventData.imageUrl },
    { key: 'scrapedAt', label: 'Scraped At', value: eventData.scrapedAt },
    { key: 'contentHash', label: 'Content Hash', value: eventData.contentHash },
  ]

  return (
    <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Raw Event Details
        </DialogTitle>
        <DialogDescription>
          Complete scraped data from {sourceData.name}
        </DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="structured" className="flex-1 overflow-hidden">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="structured" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Structured View
          </TabsTrigger>
          <TabsTrigger value="raw" className="flex items-center gap-2">
            <Code className="h-4 w-4" />
            Raw JSON
          </TabsTrigger>
          <TabsTrigger value="source" className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            Source Info
          </TabsTrigger>
        </TabsList>

        <TabsContent value="structured" className="overflow-hidden">
          <div className="h-[60vh] overflow-y-auto">
            <div className="space-y-4 pr-4">
              {structuredFields.map(({ key, label, value }) => (
                <div key={key} className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                  <div className="font-medium text-foreground">{label}:</div>
                  <div className="col-span-3 break-words">
                    {key === 'url' || key === 'imageUrl' ? (
                      value ? (
                        <a
                          href={String(value)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:underline flex items-center gap-1"
                        >
                          {String(value)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-muted-foreground italic">Not provided</span>
                      )
                    ) : (
                      formatFieldValue(value, key)
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="raw" className="overflow-hidden">
          <div className="h-[60vh] overflow-y-auto">
            <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto">
              <code>{JSON.stringify(eventData.raw, null, 2)}</code>
            </pre>
          </div>
        </TabsContent>

        <TabsContent value="source" className="overflow-hidden">
          <div className="h-[60vh] overflow-y-auto">
            <div className="space-y-4 pr-4">
              <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                <div className="font-medium text-foreground">Source ID:</div>
                <div className="col-span-3">{sourceData.id}</div>
              </div>
              <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                <div className="font-medium text-foreground">Source Name:</div>
                <div className="col-span-3">{sourceData.name}</div>
              </div>
              <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                <div className="font-medium text-foreground">Module Key:</div>
                <div className="col-span-3 font-mono text-sm">{sourceData.moduleKey}</div>
              </div>
              {sourceData.baseUrl && (
                <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                  <div className="font-medium text-foreground">Base URL:</div>
                  <div className="col-span-3">
                    <a
                      href={sourceData.baseUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline flex items-center gap-1"
                    >
                      {sourceData.baseUrl}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                <div className="font-medium text-foreground">Run ID:</div>
                <div className="col-span-3 font-mono text-sm">{eventData.runId}</div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </DialogContent>
  )
}

export function RawEvents() {
  const [filters, setFilters] = useState<EventsQueryParams>({
    page: 1,
    limit: 20,
    sortBy: 'startDatetime',
    sortOrder: 'desc',
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set())
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
    mutationFn: (ids: string[]) => eventsApi.deleteRawBulk(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'raw'] })
      setSelectedEvents(new Set())
    },
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
    setSelectedEvents(new Set()) // Clear selection when changing pages
  }

  const handleSelectEvent = (eventId: string, checked: boolean) => {
    setSelectedEvents(prev => {
      const newSelection = new Set(prev)
      if (checked) {
        newSelection.add(eventId)
      } else {
        newSelection.delete(eventId)
      }
      return newSelection
    })
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked && events?.events) {
      const allEventIds = new Set(events.events.map(({ event }) => event.id))
      setSelectedEvents(allEventIds)
    } else {
      setSelectedEvents(new Set())
    }
  }

  const handleDeleteSelected = async () => {
    if (selectedEvents.size > 0 && confirm(`Are you sure you want to delete ${selectedEvents.size} events?`)) {
      deleteMutation.mutate(Array.from(selectedEvents))
    }
  }

  const handleSort = (field: 'title' | 'startDatetime' | 'city' | 'source') => {
    setFilters(prev => ({
      ...prev,
      sortBy: field,
      sortOrder: prev.sortBy === field && prev.sortOrder === 'desc' ? 'asc' : 'desc',
      page: 1, // Reset to first page when sorting
    }))
  }

  const getSortIcon = (field: string) => {
    if (filters.sortBy !== field) {
      return <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
    }
    return filters.sortOrder === 'desc' 
      ? <ArrowDown className="h-4 w-4" />
      : <ArrowUp className="h-4 w-4" />
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
        <h1 className="text-3xl font-bold text-foreground">Raw Events</h1>
        <p className="text-muted-foreground">
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
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Raw Events</CardTitle>
              <CardDescription>
                {events?.pagination.total
                  ? `${events.pagination.total} total events • Page ${events.pagination.page} of ${events.pagination.totalPages}`
                  : 'Loading events...'}
              </CardDescription>
            </div>
            {selectedEvents.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedEvents.size} selected
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteSelected}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected
                </Button>
              </div>
            )}
          </div>
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
                    <TableHead className="w-12">
                      <Checkbox
                        checked={
                          events?.events.length > 0 &&
                          events.events.every(({ event }) => selectedEvents.has(event.id))
                        }
                        onCheckedChange={handleSelectAll}
                        aria-label="Select all events"
                      />
                    </TableHead>
                    <TableHead>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="-ml-3 h-8 data-[state=open]:bg-accent"
                        onClick={() => handleSort('title')}
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
                        onClick={() => handleSort('startDatetime')}
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
                        onClick={() => handleSort('city')}
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
                        onClick={() => handleSort('source')}
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
                  {events.events.map(({ event, source }) => {
                    const missingFields = getMissingFields({ event, source })
                    const eventDate = new Date(event.startDatetime)
                    
                    return (
                      <TableRow key={event.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedEvents.has(event.id)}
                            onCheckedChange={(checked) => handleSelectEvent(event.id, checked as boolean)}
                            aria-label={`Select event ${event.title}`}
                          />
                        </TableCell>
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
                            <Dialog>
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
                              <EventDetailView event={{ event, source }} />
                            </Dialog>
                            
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