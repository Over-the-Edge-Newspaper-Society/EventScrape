import { Card, CardContent } from '@/components/ui/card'
import { CheckCircle, XCircle, RotateCcw, Activity } from 'lucide-react'

interface RunStatsGridProps {
  statusCounts: Record<string, number>
  totalEvents: number
}

export function RunStatsGrid({ statusCounts, totalEvents }: RunStatsGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-8 w-8 text-green-600" />
            <div>
              <p className="text-2xl font-bold">{statusCounts.success || 0}</p>
              <p className="text-sm text-muted-foreground">Successful</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-2">
            <XCircle className="h-8 w-8 text-destructive" />
            <div>
              <p className="text-2xl font-bold">{statusCounts.error || 0}</p>
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
              <p className="text-2xl font-bold">{statusCounts.running || 0}</p>
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
              <p className="text-2xl font-bold">{totalEvents || 0}</p>
              <p className="text-sm text-muted-foreground">Total Events</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
