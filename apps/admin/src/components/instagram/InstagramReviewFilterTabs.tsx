import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CheckCircle, Clock, Layers, Sparkles, XCircle } from 'lucide-react'
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
    { value: 'pending', label: 'Pending Review', count: stats?.unclassified, icon: Clock },
    { value: 'event', label: 'Marked as Event', count: stats?.markedAsEvent, icon: CheckCircle },
    { value: 'not-event', label: 'Not Event', count: stats?.markedAsNotEvent, icon: XCircle },
    { value: 'needs-extraction', label: 'Needs Extraction', count: stats?.needsExtraction, icon: Sparkles },
    { value: 'all', label: 'All', count: stats?.total, icon: Layers },
  ] as const

  return (
    <Tabs value={value} onValueChange={handleValueChange}>
      <TabsList className="flex h-auto w-full flex-row gap-1 sm:flex-wrap sm:gap-2 lg:grid lg:grid-cols-5">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const label = `${tab.label}${typeof tab.count === 'number' ? ` (${tab.count})` : ''}`

          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              aria-label={label}
              className="w-full text-center"
            >
              <span className="flex w-full items-center justify-center sm:hidden">
                <Icon className="h-4 w-4" />
                <span className="sr-only">{tab.label}</span>
              </span>
              <span className="hidden sm:inline">
                {tab.label}
                {typeof tab.count === 'number' && ` (${tab.count})`}
              </span>
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}
