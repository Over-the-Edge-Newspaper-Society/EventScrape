import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EventsQueryParams, Source } from '@/lib/api'
import { Search, Filter, Repeat } from 'lucide-react'

interface EventFiltersProps {
  filters: EventsQueryParams
  sources?: Source[]
  onFilterChange: (key: keyof EventsQueryParams, value: any) => void
  onSearch: () => void
}

export function EventFilters({ filters, sources, onFilterChange, onSearch }: EventFiltersProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const handleSearch = () => {
    onFilterChange('search', searchQuery)
    onSearch()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-5 w-5" />
          Filters
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Search */}
          <div className="flex gap-2">
            <Input
              placeholder="Search events..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} size="sm">
              <Search className="h-4 w-4" />
            </Button>
          </div>

          {/* Source Filter */}
          <Select onValueChange={(value) => onFilterChange('sourceId', value === 'all' ? undefined : value)}>
            <SelectTrigger>
              <SelectValue placeholder="All sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sources</SelectItem>
              {sources?.map((source) => (
                <SelectItem key={source.id} value={source.id}>
                  {source.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* City Filter */}
          <Input
            placeholder="Filter by city"
            value={filters.city || ''}
            onChange={(e) => onFilterChange('city', e.target.value || undefined)}
          />

          {/* Special Filters */}
          <Select
            value={
              filters.hasSeries ? 'series' :
              filters.hasDuplicates ? 'duplicates' :
              filters.missingFields ? 'missing' :
              'all'
            }
            onValueChange={(value) => {
              if (value === 'duplicates') {
                onFilterChange('hasDuplicates', true)
                onFilterChange('missingFields', undefined)
                onFilterChange('hasSeries', undefined)
              } else if (value === 'missing') {
                onFilterChange('missingFields', true)
                onFilterChange('hasDuplicates', undefined)
                onFilterChange('hasSeries', undefined)
              } else if (value === 'series') {
                onFilterChange('hasSeries', true)
                onFilterChange('hasDuplicates', undefined)
                onFilterChange('missingFields', undefined)
              } else {
                onFilterChange('hasDuplicates', undefined)
                onFilterChange('missingFields', undefined)
                onFilterChange('hasSeries', undefined)
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Special filters" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              <SelectItem value="duplicates">Has duplicates</SelectItem>
              <SelectItem value="missing">Missing fields</SelectItem>
              <SelectItem value="series">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4" />
                  Series events
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  )
}
