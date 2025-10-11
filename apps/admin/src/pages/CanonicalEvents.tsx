import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { eventsApi, wordpressApi, EventsQueryParams } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Search, Filter, Calendar, MapPin, ExternalLink, Package, Eye, FileText, Trash2, Globe } from 'lucide-react'
import { toast } from 'sonner'

export function CanonicalEvents() {
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<EventsQueryParams>({
    page: 1,
    limit: 20,
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set())
  const [showWpUploadDialog, setShowWpUploadDialog] = useState(false)
  const [selectedWpSite, setSelectedWpSite] = useState('')
  const [wpPostStatus, setWpPostStatus] = useState<'publish' | 'draft' | 'pending'>('draft')

  const { data: events, isLoading } = useQuery({
    queryKey: ['events', 'canonical', filters],
    queryFn: () => eventsApi.getCanonical(filters),
  })

  const { data: wpSettings } = useQuery({
    queryKey: ['wordpress-settings'],
    queryFn: () => wordpressApi.getSettings(),
  })

  const deleteCanonicalMutation = useMutation({
    mutationFn: (ids: string[]) => eventsApi.deleteCanonicalBulk(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['events', 'canonical'] })
      setSelectedEvents(new Set()) // Clear selection
    },
  })

  const uploadToWordPressMutation = useMutation({
    mutationFn: (data: { settingsId: string; eventIds: string[]; status: 'publish' | 'draft' | 'pending' }) =>
      wordpressApi.uploadEvents(data),
    onSuccess: () => {
      toast.success(`Successfully uploaded ${selectedEvents.size} events to WordPress!`)
      setShowWpUploadDialog(false)
      setSelectedEvents(new Set())
      queryClient.invalidateQueries({ queryKey: ['events', 'canonical'] })
    },
    onError: (error: any) => {
      toast.error(`WordPress upload failed: ${error.message}`)
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
  }

  const handleSelectEvent = (eventId: string) => {
    const newSelected = new Set(selectedEvents)
    if (newSelected.has(eventId)) {
      newSelected.delete(eventId)
    } else {
      newSelected.add(eventId)
    }
    setSelectedEvents(newSelected)
  }

  const handleSelectAll = () => {
    if (selectedEvents.size === events?.events.length) {
      setSelectedEvents(new Set())
    } else {
      setSelectedEvents(new Set(events?.events.map(event => event.id) || []))
    }
  }

  const handleDelete = () => {
    if (selectedEvents.size === 0) return

    if (confirm(`Are you sure you want to delete ${selectedEvents.size} canonical event(s)? This action cannot be undone.`)) {
      deleteCanonicalMutation.mutate(Array.from(selectedEvents))
    }
  }

  const handleWordPressUpload = () => {
    if (!selectedWpSite || selectedEvents.size === 0) return

    uploadToWordPressMutation.mutate({
      settingsId: selectedWpSite,
      eventIds: Array.from(selectedEvents),
      status: wpPostStatus,
    })
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      new: 'secondary',
      ready: 'success', 
      exported: 'outline',
      ignored: 'destructive',
    } as const
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>
        {status}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="outline"
                disabled={selectedEvents.size === 0}
                className="flex items-center gap-2"
              >
                <Package className="h-4 w-4" />
                Export Selected ({selectedEvents.size})
              </Button>
              <Button
                variant="outline"
                disabled={selectedEvents.size === 0}
                size="sm"
              >
                Mark as Ready
              </Button>
              <Button
                variant="outline"
                disabled={selectedEvents.size === 0}
                size="sm"
              >
                Mark as Exported
              </Button>
              <Dialog open={showWpUploadDialog} onOpenChange={setShowWpUploadDialog}>
                <DialogTrigger asChild>
                  <Button
                    variant="default"
                    disabled={selectedEvents.size === 0}
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Globe className="h-4 w-4" />
                    Upload to WordPress ({selectedEvents.size})
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Upload to WordPress</DialogTitle>
                    <DialogDescription>
                      Upload {selectedEvents.size} selected event(s) to your WordPress site
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>WordPress Site</Label>
                      <Select value={selectedWpSite} onValueChange={setSelectedWpSite}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose WordPress site..." />
                        </SelectTrigger>
                        <SelectContent>
                          {wpSettings?.settings
                            .filter((s) => s.active)
                            .map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name} - {s.siteUrl}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      {!wpSettings?.settings.length && (
                        <p className="text-xs text-muted-foreground">
                          No WordPress sites configured. Add one in Settings → WordPress.
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Post Status</Label>
                      <Select value={wpPostStatus} onValueChange={(v: any) => setWpPostStatus(v)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft (for review)</SelectItem>
                          <SelectItem value="pending">Pending Review</SelectItem>
                          <SelectItem value="publish">Publish Immediately</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowWpUploadDialog(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleWordPressUpload}
                      disabled={!selectedWpSite || uploadToWordPressMutation.isPending}
                    >
                      {uploadToWordPressMutation.isPending ? 'Uploading...' : 'Upload'}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
              <Button
                variant="destructive"
                disabled={selectedEvents.size === 0}
                size="sm"
                onClick={handleDelete}
                className="flex items-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete Selected ({selectedEvents.size})
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">
              {selectedEvents.size > 0 && `${selectedEvents.size} selected`}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
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

            {/* Status Filter */}
            <Select onValueChange={(value) => {
              const statusValue = value === 'all' ? undefined : value as 'new' | 'ready' | 'exported' | 'ignored'
              // @ts-ignore - temporary for status filter
              handleFilterChange('status', statusValue)
            }}>
              <SelectTrigger>
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
                <SelectItem value="exported">Exported</SelectItem>
                <SelectItem value="ignored">Ignored</SelectItem>
              </SelectContent>
            </Select>

            {/* City Filter */}
            <Input
              placeholder="Filter by city"
              value={filters.city || ''}
              onChange={(e) => handleFilterChange('city', e.target.value || undefined)}
            />

            {/* Category Filter */}
            <Input
              placeholder="Filter by category"
              // @ts-ignore - temporary for category filter
              value={filters.category || ''}
              onChange={(e) => {
                // @ts-ignore - temporary for category filter
                handleFilterChange('category', e.target.value || undefined)
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Events Table */}
      <Card>
        <CardHeader>
          <CardTitle>Canonical Events</CardTitle>
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
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No canonical events found</p>
              <p className="text-sm text-muted-foreground mt-2">
                Merge some duplicate events to create canonical records.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <input
                        type="checkbox"
                        checked={selectedEvents.size === events.events.length && events.events.length > 0}
                        onChange={handleSelectAll}
                        className="rounded border-gray-300"
                      />
                    </TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead>Date/Time</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Sources</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {events.events.map((event) => {
                    const eventDate = new Date(event.startDatetime)
                    const isSelected = selectedEvents.has(event.id)
                    
                    return (
                      <TableRow key={event.id} className={isSelected ? 'bg-muted/50' : ''}>
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleSelectEvent(event.id)}
                            className="rounded border-gray-300"
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
                            {event.dedupeKey && (
                              <p className="text-xs text-muted-foreground mt-1">
                                ID: {event.dedupeKey.substring(0, 8)}...
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
                              {event.endDatetime && (
                                <p className="text-xs text-muted-foreground">
                                  until {new Date(event.endDatetime).toLocaleTimeString([], { 
                                    hour: '2-digit', 
                                    minute: '2-digit' 
                                  })}
                                </p>
                              )}
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
                              {event.venueAddress && (
                                <p className="text-xs text-muted-foreground">
                                  {event.venueAddress}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <Badge variant="outline" className="text-xs">
                              {event.mergedFromRawIds.length} sources
                            </Badge>
                            <p className="text-xs text-muted-foreground">
                              {formatRelativeTime(event.createdAt)}
                            </p>
                            {event.updatedAt !== event.createdAt && (
                              <p className="text-xs text-muted-foreground">
                                Updated {formatRelativeTime(event.updatedAt)}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            {getStatusBadge(event.status)}
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
                              className="flex items-center gap-1"
                            >
                              <Eye className="h-3 w-3" />
                              View
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              asChild
                            >
                              <a
                                href={event.urlPrimary}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1"
                              >
                                <ExternalLink className="h-3 w-3" />
                                Source
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