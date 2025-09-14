import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { schedulesApi, sourcesApi, ScheduleWithSource } from '@/lib/api'

export function Schedules() {
  const queryClient = useQueryClient()
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: () => sourcesApi.getAll() })
  const { data: schedulesData } = useQuery({ queryKey: ['schedules'], queryFn: () => schedulesApi.getAll() })

  const [sourceId, setSourceId] = useState('')
  const [cron, setCron] = useState('0 6 * * *')
  const [timezone, setTimezone] = useState('America/Vancouver')

  const createMutation = useMutation({
    mutationFn: (data: { sourceId: string; cron: string; timezone?: string; active?: boolean }) => schedulesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      setSourceId('')
      toast.success('Schedule created')
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => schedulesApi.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedules'] }),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Schedules</h1>
        <p className="text-muted-foreground">Automate scraping by scheduling runs per source</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <Label>Source</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose source..." />
                </SelectTrigger>
                <SelectContent>
                  {sources?.sources
                    .filter(s => s.active && s.moduleKey !== 'ai_poster_import')
                    .map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Cron</Label>
              <Input value={cron} onChange={e => setCron(e.target.value)} placeholder="e.g. 0 6 * * *" />
              <p className="text-xs text-muted-foreground mt-1">Cron format: minute hour day-of-month month day-of-week</p>
            </div>
            <div>
              <Label>Timezone</Label>
              <Input value={timezone} onChange={e => setTimezone(e.target.value)} placeholder="America/Vancouver" />
              <div className="flex flex-wrap gap-2 mt-2">
                <Button type="button" variant="outline" size="xs" onClick={() => setTimezone('America/Vancouver')}>Pacific</Button>
                <Button type="button" variant="outline" size="xs" onClick={() => setTimezone('America/Edmonton')}>Mountain</Button>
                <Button type="button" variant="outline" size="xs" onClick={() => setTimezone('America/Chicago')}>Central</Button>
                <Button type="button" variant="outline" size="xs" onClick={() => setTimezone('America/Toronto')}>Eastern</Button>
                <Button type="button" variant="outline" size="xs" onClick={() => setTimezone('UTC')}>UTC</Button>
              </div>
            </div>
            <div>
              <Button onClick={async () => {
                if (!sourceId || !cron) { toast.error('Select source and cron'); return }
                try {
                  await createMutation.mutateAsync({ sourceId, cron, timezone, active: true })
                } catch { toast.error('Failed to create schedule') }
              }}>Add Schedule</Button>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="mt-4">
            <Label>Quick Presets</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('*/15 * * * *')}>Every 15 minutes</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('0 * * * *')}>Hourly at :00</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('0 6 * * *')}>Daily at 6:00 AM</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('30 7 * * 1-5')}>Weekdays 7:30 AM</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('0 9 * * 1')}>Mondays 9:00 AM</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setCron('0 8 1 * *')}>1st of month 8:00 AM</Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Tip: Cron is five fields: minute hour day-of-month month day-of-week. Use the buttons above if you’re unsure.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Cron</TableHead>
                <TableHead>Timezone</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedulesData?.schedules.map((row: ScheduleWithSource) => (
                <TableRow key={row.schedule.id}>
                  <TableCell>{row.source?.name || row.schedule.sourceId}</TableCell>
                  <TableCell className="font-mono text-xs">{row.schedule.cron}</TableCell>
                  <TableCell className="font-mono text-xs">{row.schedule.timezone}</TableCell>
                  <TableCell>
                    <Switch
                      checked={row.schedule.active}
                      onCheckedChange={async (v) => {
                        try {
                          await updateMutation.mutateAsync({ id: row.schedule.id, data: { active: v } })
                          toast.success(`Schedule ${v ? 'enabled' : 'disabled'}`)
                        } catch { toast.error('Update failed') }
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button variant="secondary" size="sm" onClick={async () => {
                      try {
                        await updateMutation.mutateAsync({ id: row.schedule.id, data: { cron: row.schedule.cron, timezone: row.schedule.timezone } })
                        toast.success('Schedule synced')
                      } catch { toast.error('Sync failed') }
                    }}>Sync</Button>
                    <Button variant="destructive" size="sm" onClick={async () => {
                      try {
                        await deleteMutation.mutateAsync(row.schedule.id)
                        toast.success('Schedule deleted')
                      } catch { toast.error('Delete failed') }
                    }}>Delete</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
