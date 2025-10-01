import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { schedulesApi, sourcesApi, wordpressApi, ScheduleWithSource } from '@/lib/api'
import { Globe, Calendar, Filter } from 'lucide-react'

export function WordPressSchedules() {
  const queryClient = useQueryClient()
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: () => sourcesApi.getAll() })
  const { data: wpSettings } = useQuery({ queryKey: ['wordpress-settings'], queryFn: () => wordpressApi.getSettings() })
  const { data: schedulesData } = useQuery({ queryKey: ['schedules'], queryFn: () => schedulesApi.getAll() })

  const wpSchedules = schedulesData?.schedules.filter((s) => s.schedule.scheduleType === 'wordpress_export') || []

  const [wordpressSettingsId, setWordpressSettingsId] = useState('')
  const [cron, setCron] = useState('0 2 * * *')
  const [timezone, setTimezone] = useState('America/Vancouver')
  const [startDateOffset, setStartDateOffset] = useState<number>(0)
  const [endDateOffset, setEndDateOffset] = useState<number>(30)
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
  const [postStatus, setPostStatus] = useState<'draft' | 'pending' | 'publish'>('draft')

  const createMutation = useMutation({
    mutationFn: () =>
      schedulesApi.create({
        scheduleType: 'wordpress_export',
        wordpressSettingsId,
        cron,
        timezone,
        active: true,
        config: {
          startDateOffset,
          endDateOffset,
          sourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
          status: postStatus,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      setWordpressSettingsId('')
      setSelectedSourceIds([])
      toast.success('WordPress export schedule created')
    },
    onError: (error: any) => {
      toast.error(error.message || 'Failed to create schedule')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => schedulesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      toast.success('Schedule updated')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      toast.success('Schedule deleted')
    },
  })

  const formatDateOffset = (offset: number) => {
    if (offset === 0) return 'Today'
    if (offset > 0) return `${offset} days from now`
    return `${Math.abs(offset)} days ago`
  }

  const toggleSourceSelection = (sourceId: string) => {
    setSelectedSourceIds((prev) =>
      prev.includes(sourceId) ? prev.filter((id) => id !== sourceId) : [...prev, sourceId]
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create WordPress Export Schedule</CardTitle>
          <CardDescription>Automatically export events to WordPress on a schedule</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>WordPress Site</Label>
              <Select value={wordpressSettingsId} onValueChange={setWordpressSettingsId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose WordPress site..." />
                </SelectTrigger>
                <SelectContent>
                  {wpSettings?.settings
                    .filter((s) => s.active)
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4" />
                          {s.name} - {s.siteUrl}
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              {!wpSettings?.settings.length && (
                <p className="text-xs text-muted-foreground mt-1">
                  No WordPress sites configured. Add one in the WordPress settings page.
                </p>
              )}
            </div>

            <div>
              <Label>Post Status</Label>
              <Select value={postStatus} onValueChange={(v: any) => setPostStatus(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft (for review)</SelectItem>
                  <SelectItem value="pending">Pending Review</SelectItem>
                  <SelectItem value="publish">Publish Immediately</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Date Range
            </Label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm text-muted-foreground">Start Date Offset (days)</Label>
                <Input
                  type="number"
                  value={startDateOffset}
                  onChange={(e) => setStartDateOffset(parseInt(e.target.value) || 0)}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Negative = past, 0 = today, Positive = future. Current: {formatDateOffset(startDateOffset)}
                </p>
              </div>
              <div>
                <Label className="text-sm text-muted-foreground">End Date Offset (days)</Label>
                <Input
                  type="number"
                  value={endDateOffset}
                  onChange={(e) => setEndDateOffset(parseInt(e.target.value) || 30)}
                  placeholder="30"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Current: {formatDateOffset(endDateOffset)}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDateOffset(0)
                  setEndDateOffset(7)
                }}
              >
                Next 7 Days
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDateOffset(0)
                  setEndDateOffset(30)
                }}
              >
                Next 30 Days
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDateOffset(-7)
                  setEndDateOffset(30)
                }}
              >
                Last 7 Days + Next 30
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filter by Sources (optional)
            </Label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-48 overflow-y-auto border rounded-md p-3">
              {sources?.sources.map((source) => (
                <label key={source.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedSourceIds.includes(source.id)}
                    onChange={() => toggleSourceSelection(source.id)}
                    className="rounded"
                  />
                  {source.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedSourceIds.length === 0
                ? 'All sources will be included'
                : `${selectedSourceIds.length} source(s) selected`}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Cron Expression</Label>
              <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 2 * * *" />
              <p className="text-xs text-muted-foreground mt-1">
                Current: Daily at 2:00 AM
              </p>
            </div>
            <div>
              <Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Vancouver" />
            </div>
            <div className="flex items-end">
              <Button
                onClick={async () => {
                  if (!wordpressSettingsId || !cron) {
                    toast.error('Select WordPress site and cron')
                    return
                  }
                  try {
                    await createMutation.mutateAsync()
                  } catch {
                    toast.error('Failed to create schedule')
                  }
                }}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Add Schedule'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Quick Presets</Label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('0 2 * * *')}>
                Daily 2:00 AM
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('0 3 * * 1')}>
                Weekly Mon 3:00 AM
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('0 */6 * * *')}>
                Every 6 hours
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('0 0 1 * *')}>
                Monthly 1st 12:00 AM
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WordPress Export Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          {wpSchedules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Globe className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No WordPress export schedules configured yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>WordPress Site</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>Date Range</TableHead>
                  <TableHead>Filters</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wpSchedules.map((row: ScheduleWithSource) => {
                  const config = row.schedule.config || {}
                  return (
                    <TableRow key={row.schedule.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Globe className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{row.wordpressSettings?.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.wordpressSettings?.siteUrl}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.schedule.cron}</TableCell>
                      <TableCell className="text-xs">
                        <div>{formatDateOffset(config.startDateOffset || 0)}</div>
                        <div className="text-muted-foreground">to {formatDateOffset(config.endDateOffset || 30)}</div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div className="space-y-1">
                          {config.sourceIds && config.sourceIds.length > 0 && (
                            <Badge variant="outline">{config.sourceIds.length} sources</Badge>
                          )}
                          {config.status && (
                            <Badge variant={config.status === 'publish' ? 'default' : 'secondary'}>
                              {config.status}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={row.schedule.active}
                          onCheckedChange={async (v) => {
                            try {
                              await updateMutation.mutateAsync({ id: row.schedule.id, data: { active: v } })
                              toast.success(`Schedule ${v ? 'enabled' : 'disabled'}`)
                            } catch {
                              toast.error('Update failed')
                            }
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={async () => {
                            try {
                              await deleteMutation.mutateAsync(row.schedule.id)
                            } catch {
                              toast.error('Delete failed')
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
