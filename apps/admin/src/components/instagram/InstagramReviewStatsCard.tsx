import { Card, CardContent } from '@/components/ui/card'
import type { InstagramReviewStats } from '@/lib/api'

type InstagramReviewStatsCardProps = {
  stats: InstagramReviewStats
}

export function InstagramReviewStatsCard({ stats }: InstagramReviewStatsCardProps) {
  return (
    <Card>
      <CardContent className="pt-4 sm:pt-6">
        <div className="flex flex-wrap items-center gap-3 sm:gap-6">
          <div>
            <p className="text-xs sm:text-sm text-muted-foreground">Pending</p>
            <p className="text-lg sm:text-2xl font-bold text-orange-600">{stats.unclassified}</p>
          </div>
          <div className="hidden sm:block h-12 w-px bg-border" />
          <div className="flex flex-wrap gap-3 sm:gap-6">
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">Event</p>
              <p className="text-base sm:text-xl font-semibold text-green-600">{stats.markedAsEvent}</p>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">Not Event</p>
              <p className="text-base sm:text-xl font-semibold text-gray-500">{stats.markedAsNotEvent}</p>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">Extract</p>
              <p className="text-base sm:text-xl font-semibold text-indigo-600">{stats.needsExtraction}</p>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">Total</p>
              <p className="text-base sm:text-xl font-semibold">{stats.total}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
