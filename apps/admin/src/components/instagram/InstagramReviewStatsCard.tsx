import { Card, CardContent } from '@/components/ui/card'
import type { InstagramReviewStats } from '@/lib/api'

type InstagramReviewStatsCardProps = {
  stats: InstagramReviewStats
}

export function InstagramReviewStatsCard({ stats }: InstagramReviewStatsCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-sm text-muted-foreground">Pending Review</p>
            <p className="text-2xl font-bold text-orange-600">{stats.unclassified}</p>
          </div>
          <div className="h-12 w-px bg-border" />
          <div className="flex gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Marked as Event</p>
              <p className="text-xl font-semibold text-green-600">{stats.markedAsEvent}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Not Event</p>
              <p className="text-xl font-semibold text-gray-500">{stats.markedAsNotEvent}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Total</p>
              <p className="text-xl font-semibold">{stats.total}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
