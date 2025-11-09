import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { InstagramReviewStats } from '@/lib/api'
import type { InstagramReviewFilter } from './types'

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

  const tabs = [
    { value: 'pending', label: 'Pending Review', count: stats?.unclassified },
    { value: 'event', label: 'Marked as Event', count: stats?.markedAsEvent },
    { value: 'not-event', label: 'Not Event', count: stats?.markedAsNotEvent },
    { value: 'needs-extraction', label: 'Needs Extraction', count: stats?.needsExtraction },
    { value: 'all', label: 'All', count: stats?.total },
  ] as const

  return (
    <Tabs value={value} onValueChange={handleValueChange}>
      <TabsList className="flex h-auto w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:grid lg:grid-cols-5">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.value}
            value={tab.value}
            className="w-full text-center"
          >
            {tab.label}
            {typeof tab.count === 'number' && ` (${tab.count})`}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
