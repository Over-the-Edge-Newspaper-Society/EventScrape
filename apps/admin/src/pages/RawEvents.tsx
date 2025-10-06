import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { eventsApi, exportsApi, sourcesApi, EventsQueryParams, CreateExportData } from '@/lib/api'
import { Trash2, Download } from 'lucide-react'
import { EventFilters } from '@/components/events/EventFilters'
import { EventTable } from '@/components/events/EventTable'
import { ExportWizard } from '@/components/exports/ExportWizard'

export function RawEvents() {
  const [filters, setFilters] = useState<EventsQueryParams>({
    page: 1,
    limit: 20,
    sortBy: 'startDatetime',
    sortOrder: 'desc',
  })
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set())
  const [showExportWizard, setShowExportWizard] = useState(false)
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

  const createExportMutation = useMutation({
    mutationFn: (data: CreateExportData) => exportsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports'] })
      setShowExportWizard(false)
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
    // Search is handled by handleFilterChange
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

  const handleExport = async (data: CreateExportData) => {
    try {
      // The ExportWizard already adds the selected event IDs to the filters
      await createExportMutation.mutateAsync(data)
    } catch (error) {
      console.error('Export failed:', error)
    }
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
      <EventFilters
        filters={filters}
        sources={sources?.sources}
        onFilterChange={handleFilterChange}
        onSearch={handleSearch}
      />

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
                <Dialog open={showExportWizard} onOpenChange={setShowExportWizard}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Export Selected
                    </Button>
                  </DialogTrigger>
                  <ExportWizard
                    onClose={() => setShowExportWizard(false)}
                    onExport={handleExport}
                    selectedEventIds={Array.from(selectedEvents)}
                  />
                </Dialog>
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
              <EventTable
                events={events.events}
                selectedEvents={selectedEvents}
                filters={filters}
                onSelectEvent={handleSelectEvent}
                onSelectAll={handleSelectAll}
                onSort={handleSort}
              />

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
