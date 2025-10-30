import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { InstagramReviewStats } from '@/lib/api'
import type { InstagramReviewFilter } from './InstagramReviewQueue'

type InstagramReviewFilterTabsProps = {
  value: InstagramReviewFilter
  onChange: (value: InstagramReviewFilter) => void
  stats?: InstagramReviewStats
}

export function InstagramReviewFilterTabs({
  value,
  onChange,
  stats,
}: InstagramReviewFilterTabsProps) {
  const handleValueChange = (nextValue: string) => {
    onChange(nextValue as InstagramReviewFilter)
  }

  return (
    <Tabs value={value} onValueChange={handleValueChange}>
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="pending">
          Pending Review {stats && `(${stats.unclassified})`}
        </TabsTrigger>
        <TabsTrigger value="event">
          Marked as Event {stats && `(${stats.markedAsEvent})`}
        </TabsTrigger>
        <TabsTrigger value="not-event">
          Not Event {stats && `(${stats.markedAsNotEvent})`}
        </TabsTrigger>
        <TabsTrigger value="all">
          All {stats && `(${stats.total})`}
        </TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
