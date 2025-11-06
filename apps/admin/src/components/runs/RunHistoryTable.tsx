import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Eye,
  Clock,
  Activity,
  CheckCircle,
  XCircle,
  RotateCcw,
  AlertCircle,
} from 'lucide-react'
import { RunListItem } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'

interface RunHistoryTableProps {
  runs: RunListItem[]
  isLoading: boolean
  statusFilter: string
  sourceFilter: string
  page: number
  totalPages: number
  totalRuns: number
  onPreviousPage: () => void
  onNextPage: () => void
  onSelectRun: (runId: string) => void
  onCancelRun: (runId: string) => void
  isCanceling: boolean
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'success':
      return <CheckCircle className="h-4 w-4 text-green-600" />
    case 'error':
      return <XCircle className="h-4 w-4 text-destructive" />
    case 'running':
      return <RotateCcw className="h-4 w-4 text-blue-600 animate-spin" />
    case 'partial':
      return <AlertCircle className="h-4 w-4 text-orange-600" />
    default:
      return <Clock className="h-4 w-4 text-gray-600" />
  }
}

const getStatusBadge = (status: string) => {
  const variants = {
    success: 'success',
    error: 'destructive',
    running: 'warning',
    partial: 'warning',
    queued: 'secondary',
  } as const

  return <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>{status}</Badge>
}

export function RunHistoryTable({
  runs,
  isLoading,
  statusFilter,
  sourceFilter,
  page,
  totalPages,
  totalRuns,
  onPreviousPage,
  onNextPage,
  onSelectRun,
  onCancelRun,
  isCanceling,
}: RunHistoryTableProps) {
  const canGoPrevious = page > 1 && !isLoading
  const canGoNext = page < totalPages && !isLoading

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run History</CardTitle>
        <CardDescription>
          {isLoading
            ? 'Loading run history...'
            : totalRuns === 0
            ? 'No runs available yet'
            : `Showing ${runs.length} run${runs.length === 1 ? '' : 's'} on page ${page} of ${totalPages} • ${totalRuns} total`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading runs...</p>
          </div>
        ) : !runs.length ? (
          <div className="text-center py-8">
            <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No runs found</p>
            <p className="text-sm text-muted-foreground mt-2">
              {statusFilter !== 'all' || sourceFilter !== 'all'
                ? 'Try adjusting your filters'
                : 'Trigger your first scrape run above'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Results</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map(({ run, source, summary }) => {
                const startDate = new Date(run.startedAt)
                const finishDate = run.finishedAt ? new Date(run.finishedAt) : null

                const duration =
                  finishDate && !Number.isNaN(finishDate.getTime()) && !Number.isNaN(startDate.getTime())
                    ? finishDate.getTime() - startDate.getTime()
                    : !Number.isNaN(startDate.getTime())
                    ? Date.now() - startDate.getTime()
                    : 0

                const durationFormatted = `${Math.floor(duration / 1000)}s`
                const summaryData = summary || {
                  total: 0,
                  success: 0,
                  failed: 0,
                  pending: 0,
                  running: 0,
                  queued: 0,
                }
                const queuedCount = Math.max(summaryData.pending - summaryData.running, 0)
                const metadata = (run.metadata ?? {}) as Record<string, any>
                const options = metadata.options as { postLimit?: number; batchSize?: number } | undefined
                const pagesLabel = source?.moduleKey === 'instagram' ? 'posts' : 'pages'

                return (
                  <TableRow key={run.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run.status)}
                        {getStatusBadge(run.status)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-sm">{source?.name}</p>
                        <Badge variant="outline" className="text-xs font-mono">
                          {source?.moduleKey}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm">{formatRelativeTime(run.startedAt)}</p>
                        <p className="text-xs text-muted-foreground">
                          {!Number.isNaN(startDate.getTime()) ? startDate.toLocaleString() : 'Invalid date'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-sm">{durationFormatted}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="text-sm font-medium">{run.eventsFound}</span>
                          <span className="text-xs text-muted-foreground">events</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-muted-foreground">
                            {run.pagesCrawled} {pagesLabel}
                          </span>
                        </div>
                        {summaryData.total > 0 && (
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            <div>
                              {summaryData.success} done • {summaryData.running} running • {queuedCount} queued •{' '}
                              {summaryData.failed} failed
                            </div>
                            <div>
                              {summaryData.total} account{summaryData.total === 1 ? '' : 's'} in batch
                            </div>
                          </div>
                        )}
                        {options && (
                          <div className="text-xs text-muted-foreground">
                            Posts/account: {options.postLimit ?? 'default'} • Batch size: {options.batchSize ?? 'default'}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => onSelectRun(run.id)}
                          className="flex items-center gap-1"
                        >
                          <Eye className="h-3 w-3" />
                          Details
                        </Button>

                        {(run.status === 'running' || run.status === 'queued') && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => onCancelRun(run.id)}
                            disabled={isCanceling}
                            className="flex items-center gap-1"
                          >
                            <XCircle className="h-3 w-3" />
                            Cancel
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {!isLoading && totalRuns > 0 && (
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Page {page} of {totalPages} • {totalRuns} total runs
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onPreviousPage} disabled={!canGoPrevious}>
                Previous
              </Button>
              <Button variant="outline" size="sm" onClick={onNextPage} disabled={!canGoNext}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
