import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useQuery } from '@tanstack/react-query'
import { runsApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Activity, XCircle } from 'lucide-react'

interface RunDetailsProps {
  runId: string | null
  onClose: () => void
  children?: React.ReactNode
}

export function DashboardRunDetails({ runId, onClose, children }: RunDetailsProps) {
  return (
    <Dialog open={!!runId} onOpenChange={(open) => !open && onClose()}>
      {children}
      <RunDetailsContent runId={runId} onClose={onClose} />
    </Dialog>
  )
}

function RunDetailsContent({ runId, onClose }: Omit<RunDetailsProps, 'children'>) {
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
        </DialogHeader>
        <div className="text-center py-8">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </DialogContent>
    )
  }

  const { run, source } = data.run
  const startDate = new Date(run.startedAt)
  const finishDate = run.finishedAt ? new Date(run.finishedAt) : null
  
  const duration = finishDate && !isNaN(finishDate.getTime()) && !isNaN(startDate.getTime())
    ? finishDate.getTime() - startDate.getTime()
    : !isNaN(startDate.getTime())
    ? Date.now() - startDate.getTime()
    : 0
  
  const durationFormatted = `${Math.floor(duration / 1000)}s`
  const pagesLabel = source?.moduleKey === 'instagram' ? 'Posts Processed' : 'Pages Crawled'

  return (
    <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Run Details
        </DialogTitle>
        <DialogDescription>
          {source?.name} • {formatRelativeTime(run.startedAt)}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6">
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
                <span className="text-muted-foreground">{pagesLabel}:</span>
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
              {run.finishedAt && finishDate && !isNaN(finishDate.getTime()) && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Finished:</span>
                  <span>{finishDate.toLocaleString()}</span>
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

        {/* Timeline */}
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

        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </DialogContent>
  )
}
