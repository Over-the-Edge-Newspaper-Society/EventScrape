import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { runsApi, sourcesApi, eventsApi, matchesApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Activity, Calendar, Database, GitMerge, Play, AlertTriangle, Eye, Clock, CheckCircle, XCircle, RotateCcw } from 'lucide-react'

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

        {/* Timeline */}
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

        <div className="flex justify-end">
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </DialogContent>
  )
}

export function Dashboard() {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const navigate = useNavigate()
  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.getAll(),
  })

  const { data: runs } = useQuery({
    queryKey: ['runs', { limit: 10 }],
    queryFn: () => runsApi.getAll({ limit: 10 }),
  })

  const { data: rawEvents } = useQuery({
    queryKey: ['events', 'raw', { limit: 1 }],
    queryFn: () => eventsApi.getRaw({ limit: 1 }),
  })

  const { data: pendingMatches } = useQuery({
    queryKey: ['matches', { status: 'open', limit: 1 }],
    queryFn: () => matchesApi.getAll({ status: 'open', limit: 1 }),
  })

  const activeSources = sources?.sources.filter(s => s.active).length || 0
  const totalSources = sources?.sources.length || 0
  const recentRuns = runs?.runs.slice(0, 5) || []
  const totalEvents = rawEvents?.pagination.total || 0
  const pendingMatchesCount = pendingMatches?.matches.length || 0

  const stats = [
    {
      title: 'Active Sources',
      value: `${activeSources}/${totalSources}`,
      description: 'Sources currently enabled',
      icon: Activity,
      color: 'text-green-600',
    },
    {
      title: 'Total Events',
      value: totalEvents.toLocaleString(),
      description: 'Raw events scraped',
      icon: Database,
      color: 'text-blue-600',
    },
    {
      title: 'Recent Runs',
      value: recentRuns.length.toString(),
      description: 'Last 10 scrape runs',
      icon: Play,
      color: 'text-purple-600',
    },
    {
      title: 'Pending Review',
      value: pendingMatchesCount.toString(),
      description: 'Duplicates to review',
      icon: GitMerge,
      color: 'text-orange-600',
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Overview of your event scraping and review system
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {stat.title}
                </CardTitle>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
                <p className="text-xs text-muted-foreground">
                  {stat.description}
                </p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Recent Runs
            </CardTitle>
            <CardDescription>
              Latest scraper executions
            </CardDescription>
          </CardHeader>
          <CardContent>
            {recentRuns.length === 0 ? (
              <p className="text-muted-foreground text-sm">No runs yet</p>
            ) : (
              <div className="space-y-4">
                {recentRuns.map((runData) => {
                  const { run, source } = runData
                  const startDate = new Date(run.startedAt)
                  const finishDate = run.finishedAt ? new Date(run.finishedAt) : null
                  
                  const duration = finishDate && !isNaN(finishDate.getTime()) && !isNaN(startDate.getTime())
                    ? finishDate.getTime() - startDate.getTime()
                    : !isNaN(startDate.getTime())
                    ? Date.now() - startDate.getTime()
                    : 0
                  const durationFormatted = `${Math.floor(duration / 1000)}s`
                  
                  const getStatusIcon = (status: string) => {
                    switch (status) {
                      case 'success':
                        return <CheckCircle className="h-4 w-4 text-green-600" />
                      case 'error':
                        return <XCircle className="h-4 w-4 text-red-600" />
                      case 'running':
                        return <RotateCcw className="h-4 w-4 text-blue-600 animate-spin" />
                      default:
                        return <Clock className="h-4 w-4 text-gray-600" />
                    }
                  }
                  
                  return (
                    <div key={run.id} className="flex items-center justify-between py-3 px-3 rounded-lg bg-gray-50 dark:bg-gray-800/50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusIcon(run.status)}
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {source.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span>{formatRelativeTime(run.startedAt)}</span>
                          <span>•</span>
                          <span>{durationFormatted}</span>
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <div className="text-right">
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
                            className="mb-1"
                          >
                            {run.status}
                          </Badge>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {run.eventsFound} events
                          </p>
                        </div>
                        <Dialog open={selectedRunId === run.id} onOpenChange={(open) => {
                          if (!open) setSelectedRunId(null)
                        }}>
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
                          {selectedRunId === run.id && (
                            <RunDetails
                              runId={selectedRunId}
                              onClose={() => setSelectedRunId(null)}
                            />
                          )}
                        </Dialog>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sources Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Sources Status
            </CardTitle>
            <CardDescription>
              Configured scraping sources
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!sources?.sources.length ? (
              <p className="text-muted-foreground text-sm">No sources configured</p>
            ) : (
              <div className="space-y-4">
                {sources.sources.slice(0, 5).map((source) => (
                  <div key={source.id} className="flex items-center justify-between py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                        {source.name}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                        {source.moduleKey}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Badge variant={source.active ? 'success' : 'secondary'}>
                        {source.active ? 'Active' : 'Inactive'}
                      </Badge>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {source.rateLimitPerMin}/min
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            Common tasks and shortcuts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div 
              className="flex items-center p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              onClick={() => navigate('/events/raw')}
            >
              <Calendar className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <p className="font-medium">View Events</p>
                <p className="text-sm text-gray-500">Browse scraped events</p>
              </div>
            </div>
            
            <div 
              className="flex items-center p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              onClick={() => navigate('/matches')}
            >
              <GitMerge className="h-8 w-8 text-orange-600 mr-3" />
              <div>
                <p className="font-medium">Review Matches</p>
                <p className="text-sm text-gray-500">Handle duplicates</p>
              </div>
            </div>
            
            <div 
              className="flex items-center p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              onClick={() => navigate('/runs')}
            >
              <Play className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="font-medium">Run Scraper</p>
                <p className="text-sm text-gray-500">Start new scrape</p>
              </div>
            </div>
            
            <div 
              className="flex items-center p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
              onClick={() => navigate('/runs?status=error')}
            >
              <AlertTriangle className="h-8 w-8 text-red-600 mr-3" />
              <div>
                <p className="font-medium">View Errors</p>
                <p className="text-sm text-gray-500">Check failed runs</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}