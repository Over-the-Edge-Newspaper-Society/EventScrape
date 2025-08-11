import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { runsApi, sourcesApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Clock, CheckCircle, XCircle, AlertCircle, RotateCcw, Eye, Zap, Activity } from 'lucide-react'
import { toast } from 'sonner'
import { LogViewer } from '@/components/LogViewer'

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

  const { run, source } = data.run
  const startDate = new Date(run.startedAt)
  const finishDate = run.finishedAt ? new Date(run.finishedAt) : null
  
  const duration = finishDate && !isNaN(finishDate.getTime()) && !isNaN(startDate.getTime())
    ? finishDate.getTime() - startDate.getTime()
    : !isNaN(startDate.getTime())
    ? Date.now() - startDate.getTime()
    : 0
  
  const durationFormatted = `${Math.floor(duration / 1000)}s`

  return (
    <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
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
                  <strong>Started:</strong> {!isNaN(startDate.getTime()) ? startDate.toLocaleString() : 'Invalid date'}
                </span>
              </div>
              {run.finishedAt && finishDate && !isNaN(finishDate.getTime()) && (
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    run.status === 'success' ? 'bg-green-500' : 'bg-red-500'
                  }`}></div>
                  <span className="text-sm">
                    <strong>Finished:</strong> {finishDate.toLocaleString()}
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

        {/* Live Logs */}
        <div className="h-96">
          <LogViewer runId={runId} />
        </div>

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
  const [selectedSourceForTrigger, setSelectedSourceForTrigger] = useState<string>('')
  const [isTestMode, setIsTestMode] = useState(true)

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['runs', { sourceId: sourceFilter === 'all' ? undefined : sourceFilter }],
    queryFn: () => runsApi.getAll({ sourceId: sourceFilter === 'all' ? undefined : sourceFilter }),
    refetchInterval: 5000, // Refresh every 5 seconds to get real-time updates
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

  const triggerTestMutation = useMutation({
    mutationFn: (sourceKey: string) => runsApi.triggerTest(sourceKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const cancelRunMutation = useMutation({
    mutationFn: (runId: string) => runsApi.cancel(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })


  const handleTriggerRun = async () => {
    if (!selectedSourceForTrigger) {
      toast.error('Please select a source to scrape')
      return
    }
    
    try {
      if (isTestMode) {
        await triggerTestMutation.mutateAsync(selectedSourceForTrigger)
        toast.success('Test scrape started successfully')
      } else {
        await triggerScrapeMutation.mutateAsync(selectedSourceForTrigger)
        toast.success('Full scrape started successfully')
      }
    } catch (error) {
      console.error('Trigger failed:', error)
      toast.error('Failed to start scrape. Please try again.')
    }
  }

  const handleCancelRun = async (runId: string) => {
    try {
      await cancelRunMutation.mutateAsync(runId)
      toast.success('Run cancelled successfully')
    } catch (error: any) {
      console.error('Run cancellation failed:', error)
      
      // Check if it's a status-related error (run already completed/cancelled)
      if (error?.message?.includes('status') || error?.status === 400) {
        toast.info('This run has already completed or been cancelled')
        queryClient.invalidateQueries({ queryKey: ['runs'] })
      } else {
        toast.error('Failed to cancel run. Please try again.')
      }
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
          <div>
            <div className="mb-6">
              <h3 className="font-semibold mb-2">Trigger New Runs</h3>
              <p className="text-sm text-muted-foreground">
                Manually start scraping for active sources
              </p>
            </div>
            
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="source-select">Select Source</Label>
                  <Select value={selectedSourceForTrigger} onValueChange={setSelectedSourceForTrigger}>
                    <SelectTrigger id="source-select">
                      <SelectValue placeholder="Choose a scraping source..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sources?.sources
                        .filter(source => source.active)
                        .map((source) => (
                          <SelectItem key={source.id} value={source.moduleKey}>
                            <div className="flex items-center gap-2">
                              <Activity className="h-3 w-3" />
                              {source.name}
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="test-mode">Scrape Mode</Label>
                  <div className="flex items-center space-x-2 h-10 px-3 py-2 border rounded-md">
                    <Switch
                      id="test-mode"
                      checked={isTestMode}
                      onCheckedChange={setIsTestMode}
                    />
                    <Label htmlFor="test-mode" className="text-sm cursor-pointer">
                      {isTestMode ? 'Test Mode (First Event Only)' : 'Full Mode (All Events)'}
                    </Label>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-start">
                <Button
                  onClick={handleTriggerRun}
                  disabled={!selectedSourceForTrigger || triggerScrapeMutation.isPending || triggerTestMutation.isPending}
                  className="flex items-center gap-2"
                  size="lg"
                >
                  {isTestMode ? <Eye className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                  {triggerScrapeMutation.isPending || triggerTestMutation.isPending 
                    ? 'Starting...' 
                    : `Start ${isTestMode ? 'Test' : 'Full'} Scrape`
                  }
                </Button>
              </div>
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
                      {source?.name}
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
                  const startDate = new Date(run.startedAt)
                  const finishDate = run.finishedAt ? new Date(run.finishedAt) : null
                  
                  const duration = finishDate && !isNaN(finishDate.getTime()) && !isNaN(startDate.getTime())
                    ? finishDate.getTime() - startDate.getTime()
                    : !isNaN(startDate.getTime())
                    ? Date.now() - startDate.getTime()
                    : 0
                  
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
                            {!isNaN(startDate.getTime()) ? startDate.toLocaleString() : 'Invalid date'}
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
                        <div className="flex items-center gap-2">
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
                          
                          {(run.status === 'running' || run.status === 'queued') && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleCancelRun(run.id)}
                              disabled={cancelRunMutation.isPending}
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