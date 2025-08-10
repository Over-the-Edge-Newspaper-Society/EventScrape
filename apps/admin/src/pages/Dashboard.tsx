import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { runsApi, sourcesApi, eventsApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Activity, Calendar, Database, GitMerge, Play, AlertTriangle } from 'lucide-react'

export function Dashboard() {
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

  const activeSources = sources?.sources.filter(s => s.active).length || 0
  const totalSources = sources?.sources.length || 0
  const recentRuns = runs?.runs.slice(0, 5) || []
  const totalEvents = rawEvents?.pagination.total || 0

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
      value: '0', // TODO: Add matches count
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
                  return (
                    <div key={run.id} className="flex items-center justify-between py-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {source.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatRelativeTime(run.startedAt)}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
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
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {run.eventsFound} events
                        </span>
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
            <div className="flex items-center p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
              <Calendar className="h-8 w-8 text-blue-600 mr-3" />
              <div>
                <p className="font-medium">View Events</p>
                <p className="text-sm text-gray-500">Browse scraped events</p>
              </div>
            </div>
            
            <div className="flex items-center p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
              <GitMerge className="h-8 w-8 text-orange-600 mr-3" />
              <div>
                <p className="font-medium">Review Matches</p>
                <p className="text-sm text-gray-500">Handle duplicates</p>
              </div>
            </div>
            
            <div className="flex items-center p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
              <Play className="h-8 w-8 text-green-600 mr-3" />
              <div>
                <p className="font-medium">Run Scraper</p>
                <p className="text-sm text-gray-500">Start new scrape</p>
              </div>
            </div>
            
            <div className="flex items-center p-4 border rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
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