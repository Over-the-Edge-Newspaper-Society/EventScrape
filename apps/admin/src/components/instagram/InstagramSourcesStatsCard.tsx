import { Card, CardContent } from '@/components/ui/card'

interface InstagramSourcesStatsCardProps {
  totalSources: number
  activeSources: number
  inactiveSources: number
}

export function InstagramSourcesStatsCard({
  totalSources,
  activeSources,
  inactiveSources,
}: InstagramSourcesStatsCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-6">
          <div>
            <p className="text-sm text-muted-foreground">Tracked Clubs</p>
            <p className="text-2xl font-bold">
              {activeSources}/{totalSources} active
            </p>
          </div>
          <div className="h-12 w-px bg-border" />
          <div className="flex gap-6">
            <div>
              <p className="text-sm text-muted-foreground">Active</p>
              <p className="text-xl font-semibold text-green-600">{activeSources}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Inactive</p>
              <p className="text-xl font-semibold text-gray-500">{inactiveSources}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">All</p>
              <p className="text-xl font-semibold">{totalSources}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
