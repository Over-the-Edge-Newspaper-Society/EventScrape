import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { runsApi, sourcesApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Play, Clock, CheckCircle, XCircle, AlertCircle, RotateCcw, Eye, Zap, Activity } from 'lucide-react'

interface RunDetailsProps {
  runId: string
  onClose: () => void
}

function RunDetails({ runId, onClose }: RunDetailsProps) {
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

  const { run, source } = data
  const duration = run.finishedAt 
    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
    : Date.now() - new Date(run.startedAt).getTime()
  
  const durationFormatted = `${Math.floor(duration / 1000)}s`

  return (
    <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Run Details
        </DialogTitle>
        <DialogDescription>
          {source.name} • {formatRelativeTime(run.startedAt)}
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
                <span className="font-medium">{source.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Module:</span>
                <Badge variant="outline" className="font-mono text-xs">
                  {source.moduleKey}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Started:</span>
                <span>{new Date(run.startedAt).toLocaleString()}</span>
              </div>
              {run.finishedAt && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Finished:</span>
                  <span>{new Date(run.finishedAt).toLocaleString()}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Errors */}
        {run.status === 'error' && run.errorsJsonb && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-red-600 flex items-center gap-2">
                <XCircle className="h-5 w-5" />
                Error Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-red-50 border border-red-200 rounded p-4">
                <pre className="text-sm text-red-800 whitespace-pre-wrap">
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
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span className="text-sm">
                  <strong>Started:</strong> {new Date(run.startedAt).toLocaleString()}
                </span>
              </div>
              {run.finishedAt && (
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    run.status === 'success' ? 'bg-green-500' : 'bg-red-500'
                  }`}></div>
                  <span className="text-sm">
                    <strong>Finished:</strong> {new Date(run.finishedAt).toLocaleString()}
                  </span>
                </div>
              )}
              {run.status === 'running' && (
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
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

export function Runs() {
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['runs', { sourceId: sourceFilter === 'all' ? undefined : sourceFilter }],
    queryFn: () => runsApi.getAll({ sourceId: sourceFilter === 'all' ? undefined : sourceFilter }),
  })

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.getAll(),
  })

  const triggerScrapeMutation = useMutation({
    mutationFn: (sourceKey: string) => runsApi.triggerScrape(sourceKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const handleTriggerScrape = async (sourceKey: string) => {
    try {
      await triggerScrapeMutation.mutateAsync(sourceKey)
    } catch (error) {
      console.error('Scrape trigger failed:', error)
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-600" />
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
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>
        {status}
      </Badge>
    )
  }

  // Filter runs by status if needed
  const filteredRuns = runs?.runs.filter(runData => {
    if (statusFilter === 'all') return true
    return runData.run.status === statusFilter
  }) || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Scraper Runs</h1>
        <p className="text-gray-600 dark:text-gray-400">
          View scraper execution history and trigger new runs
        </p>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Trigger New Runs</h3>
              <p className="text-sm text-muted-foreground">
                Manually start scraping for active sources
              </p>
            </div>
            <div className="flex gap-2">
              {sources?.sources
                .filter(source => source.active)
                .map((source) => (
                  <Button
                    key={source.id}
                    size="sm"
                    variant="outline"
                    disabled={triggerScrapeMutation.isPending}
                    onClick={() => handleTriggerScrape(source.moduleKey)}
                    className="flex items-center gap-1"
                  >
                    <Zap className="h-3 w-3" />
                    {source.name}
                  </Button>
                ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div>
              <label className="text-sm font-medium">Filter by Source</label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-48">
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
            </div>
            
            <div>
              <label className="text-sm font-medium">Filter by Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="success">Success</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="partial">Partial</SelectItem>
                  <SelectItem value="queued">Queued</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Runs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
          <CardDescription>
            {runs?.runs.length
              ? `${filteredRuns.length} of ${runs.runs.length} runs`
              : 'Loading run history...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading runs...</p>
            </div>
          ) : !filteredRuns.length ? (
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
                {filteredRuns.map(({ run, source }) => {
                  const duration = run.finishedAt 
                    ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()
                    : Date.now() - new Date(run.startedAt).getTime()
                  
                  const durationFormatted = `${Math.floor(duration / 1000)}s`
                  
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
                          <p className="font-medium text-sm">{source.name}</p>
                          <Badge variant="outline" className="text-xs font-mono">
                            {source.moduleKey}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm">{formatRelativeTime(run.startedAt)}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(run.startedAt).toLocaleString()}
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
                            <span className="text-xs text-muted-foreground">{run.pagesCrawled} pages</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedRunId(run.id)}
                              className="flex items-center gap-1"
                            >
                              <Eye className="h-3 w-3" />
                              Details
                            </Button>
                          </DialogTrigger>
                          {selectedRunId && (
                            <RunDetails
                              runId={selectedRunId}
                              onClose={() => setSelectedRunId(null)}
                            />
                          )}
                        </Dialog>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">
                  {runs?.runs.filter(r => r.run.status === 'success').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Successful</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <XCircle className="h-8 w-8 text-red-600" />
              <div>
                <p className="text-2xl font-bold">
                  {runs?.runs.filter(r => r.run.status === 'error').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">
                  {runs?.runs.filter(r => r.run.status === 'running').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Running</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Activity className="h-8 w-8 text-purple-600" />
              <div>
                <p className="text-2xl font-bold">
                  {runs?.runs.reduce((sum, r) => sum + r.run.eventsFound, 0) || 0}
                </p>
                <p className="text-sm text-muted-foreground">Total Events</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}