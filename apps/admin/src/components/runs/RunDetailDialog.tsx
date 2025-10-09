import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { runsApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { ExternalLink, XCircle, Activity } from 'lucide-react'
import { LogViewer } from '@/components/LogViewer'

interface RunDetailsProps {
  runId: string | null
  onClose: () => void
  children?: React.ReactNode
}

export function RunDetailDialog({ runId, onClose, children }: RunDetailsProps) {
  return (
    <Dialog open={!!runId} onOpenChange={(open) => !open && onClose()}>
      {children}
      <RunDetails runId={runId} onClose={onClose} />
    </Dialog>
  )
}

function RunDetails({ runId, onClose }: Omit<RunDetailsProps, 'children'>) {
  if (!runId) return null

  const { data, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => runsApi.getById(runId),
    enabled: !!runId,
  })

  if (isLoading || !data) {
    return (
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Loading run details...</DialogTitle>
          <DialogDescription>Fetching run information</DialogDescription>
        </DialogHeader>
        <div className="text-center py-8">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </DialogContent>
    )
  }

  const { run, source, events } = data.run
  const startDate = new Date(run.startedAt)
  const finishDate = run.finishedAt ? new Date(run.finishedAt) : null

  const duration = finishDate && !isNaN(finishDate.getTime()) && !isNaN(startDate.getTime())
    ? finishDate.getTime() - startDate.getTime()
    : !isNaN(startDate.getTime())
    ? Date.now() - startDate.getTime()
    : 0

  const durationFormatted = `${Math.floor(duration / 1000)}s`
  const runEvents = events ?? []

  const formatDateTime = (value?: string | null) => {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
  }

  return (
    <DialogContent className="max-w-7xl max-h-[90vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Run Details
        </DialogTitle>
        <DialogDescription>
          {source?.name} • {formatRelativeTime(run.startedAt)}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6 overflow-y-auto flex-1 pr-2 -mr-2">
        {/* Overview */}
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Execution Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status:</span>
                <Badge
                  variant={
                    run.status === 'success'
                      ? 'success'
                      : run.status === 'error'
                      ? 'destructive'
                      : run.status === 'running'
                      ? 'warning'
                      : 'secondary'
                  }
                >
                  {run.status}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration:</span>
                <span>{durationFormatted}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Events Found:</span>
                <span className="font-medium">{run.eventsFound}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pages Crawled:</span>
                <span>{run.pagesCrawled}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Source Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Source:</span>
                <span className="font-medium">{source?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Module:</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {source?.moduleKey}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Started:</span>
                <span>{!isNaN(startDate.getTime()) ? startDate.toLocaleString() : 'Invalid date'}</span>
              </div>
              {run.finishedAt && finishDate && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Finished:</span>
                  <span>{!isNaN(finishDate.getTime()) ? finishDate.toLocaleString() : 'Invalid date'}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Errors */}
        {run.status === 'error' && run.errorsJsonb && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-destructive flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                Error Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-destructive/10 border border-destructive/20 rounded p-4">
                <pre className="text-sm text-destructive whitespace-pre-wrap">
                  {typeof run.errorsJsonb === 'string' 
                    ? run.errorsJsonb 
                    : JSON.stringify(run.errorsJsonb, null, 2)}
                </pre>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Timing Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-blue-500 dark:bg-blue-400 rounded-full"></div>
                <span className="text-sm">
                  <strong>Started:</strong> {!isNaN(startDate.getTime()) ? startDate.toLocaleString() : 'Invalid date'}
                </span>
              </div>
              {run.finishedAt && finishDate && !isNaN(finishDate.getTime()) && (
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    run.status === 'success' ? 'bg-emerald-500' : 'bg-destructive'
                  }`}></div>
                  <span className="text-sm">
                    <strong>Finished:</strong> {finishDate.toLocaleString()}
                  </span>
                </div>
              )}
              {run.status === 'running' && (
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-yellow-500 dark:bg-yellow-400 rounded-full animate-pulse"></div>
                  <span className="text-sm">
                    <strong>Status:</strong> Currently running...
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Live Logs */}
        <div className="h-[400px]">
          <LogViewer runId={runId} />
        </div>

        {/* Extracted Events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Extracted Events</CardTitle>
            <CardDescription>
              {runEvents.length ? `${runEvents.length} event${runEvents.length === 1 ? '' : 's'} saved for this run` : 'No events were saved during this run'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {runEvents.length ? (
              <div className="rounded-md border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[220px]">Title</TableHead>
                        <TableHead className="min-w-[180px]">Start</TableHead>
                        <TableHead className="min-w-[200px]">Location</TableHead>
                        <TableHead className="min-w-[160px]">Category / Organizer</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {runEvents.map((event) => (
                        <TableRow key={event.id}>
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <a
                                href={event.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                              >
                                <span className="truncate" title={event.title}>{event.title}</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                              {event.sourceEventId && (
                                <span className="text-xs text-muted-foreground font-mono">ID: {event.sourceEventId}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5 text-sm">
                              <span>{formatDateTime(event.startDatetime)}</span>
                              {event.endDatetime && (
                                <span className="text-xs text-muted-foreground">Ends: {formatDateTime(event.endDatetime)}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5 text-sm">
                              <span>{event.venueName || '—'}</span>
                              <span className="text-xs text-muted-foreground">
                                {[event.city, event.region, event.country].filter(Boolean).join(', ') || '—'}
                              </span>
                              {event.venueAddress && (
                                <span className="text-xs text-muted-foreground" title={event.venueAddress}>
                                  {event.venueAddress}
                                </span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col gap-0.5 text-sm">
                              <span>{event.category || '—'}</span>
                              {event.organizer && (
                                <span className="text-xs text-muted-foreground">{event.organizer}</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No events were captured for this run.</p>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </DialogContent>
  )
}

