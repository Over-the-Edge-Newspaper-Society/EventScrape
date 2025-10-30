import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Source } from '@/lib/api'

interface RunFiltersCardProps {
  sources: Source[]
  sourceFilter: string
  onSourceFilterChange: (value: string) => void
  statusFilter: string
  onStatusFilterChange: (value: string) => void
}

export function RunFiltersCard({
  sources,
  sourceFilter,
  onSourceFilterChange,
  statusFilter,
  onStatusFilterChange,
}: RunFiltersCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex gap-4">
          <div>
            <Label className="text-sm font-medium">Filter by Source</Label>
            <Select value={sourceFilter} onValueChange={onSourceFilterChange}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-sm font-medium">Filter by Status</Label>
            <Select value={statusFilter} onValueChange={onStatusFilterChange}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="error">Error</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
