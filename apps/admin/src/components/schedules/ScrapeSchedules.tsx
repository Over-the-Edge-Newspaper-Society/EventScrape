import { useState, useEffect } from 'react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Play } from 'lucide-react'

export function ScrapeSchedules() {
  const queryClient = useQueryClient()
  const { data: sources } = useQuery({ queryKey: ['sources'], queryFn: () => sourcesApi.getAll() })
  const { data: schedulesData } = useQuery({ queryKey: ['schedules'], queryFn: () => schedulesApi.getAll() })

  const scrapeSchedules = schedulesData?.schedules.filter((s) => s.schedule.scheduleType === 'scrape') || []

  const [sourceId, setSourceId] = useState('')
  const [cron, setCron] = useState('0 6 * * *')
  const [timezone, setTimezone] = useState('America/Vancouver')

  // Schedule Builder state
  const [mode, setMode] = useState<'custom' | 'everyNMinutes' | 'hourly' | 'daily' | 'weekly' | 'monthly'>('daily')
  const [everyN, setEveryN] = useState<number>(15)
  const [hourlyMinute, setHourlyMinute] = useState<number>(0)
  const [dailyHour12, setDailyHour12] = useState<number>(6)
  const [dailyMinute, setDailyMinute] = useState<number>(0)
  const [dailyMeridiem, setDailyMeridiem] = useState<'AM' | 'PM'>('AM')
  const [weeklyHour12, setWeeklyHour12] = useState<number>(6)
  const [weeklyMinute, setWeeklyMinute] = useState<number>(0)
  const [weeklyMeridiem, setWeeklyMeridiem] = useState<'AM' | 'PM'>('AM')
  const [weeklyDays, setWeeklyDays] = useState<{ [k: string]: boolean }>({
    '1': true,
    '2': true,
    '3': true,
    '4': true,
    '5': true,
  })
  const [monthlyDay, setMonthlyDay] = useState<number>(1)
  const [monthlyHour12, setMonthlyHour12] = useState<number>(6)
  const [monthlyMinute, setMonthlyMinute] = useState<number>(0)
  const [monthlyMeridiem, setMonthlyMeridiem] = useState<'AM' | 'PM'>('AM')

  const to24h = (h12: number, mer: 'AM' | 'PM') => (h12 % 12) + (mer === 'PM' ? 12 : 0)
  const [manualCron, setManualCron] = useState(false)
  const handleBuilderInteraction = () => {
    if (manualCron) {
      setManualCron(false)
    }
  }

  useEffect(() => {
    if (manualCron) return
    const clampMin = (n?: number) => Math.max(0, Math.min(59, Math.floor(n ?? 0)))
    const clampDom = (n?: number) => Math.max(1, Math.min(31, Math.floor(n ?? 1)))

    switch (mode) {
      case 'everyNMinutes': {
        const n = Math.max(1, Math.min(59, Math.floor(everyN || 1)))
        setCron(`*/${n} * * * *`)
        break
      }
      case 'hourly': {
        setCron(`${clampMin(hourlyMinute)} * * * *`)
        break
      }
      case 'daily': {
        const h = to24h(dailyHour12 || 12, dailyMeridiem)
        const m = clampMin(dailyMinute)
        setCron(`${m} ${h} * * *`)
        break
      }
      case 'weekly': {
        const h = to24h(weeklyHour12 || 12, weeklyMeridiem)
        const m = clampMin(weeklyMinute)
        const selected = Object.entries(weeklyDays)
          .filter(([, v]) => v)
          .map(([k]) => k)
        const dow = selected.length ? selected.join(',') : '1-5'
        setCron(`${m} ${h} * * ${dow}`)
        break
      }
      case 'monthly': {
        const h = to24h(monthlyHour12 || 12, monthlyMeridiem)
        const m = clampMin(monthlyMinute)
        const dom = clampDom(monthlyDay)
        setCron(`${m} ${h} ${dom} * *`)
        break
      }
      case 'custom':
      default:
        break
    }
  }, [
    manualCron,
    mode,
    everyN,
    hourlyMinute,
    dailyHour12,
    dailyMinute,
    dailyMeridiem,
    weeklyHour12,
    weeklyMinute,
    weeklyMeridiem,
    weeklyDays,
    monthlyDay,
    monthlyHour12,
    monthlyMinute,
    monthlyMeridiem,
  ])

  const createMutation = useMutation({
    mutationFn: () =>
      schedulesApi.create({
        scheduleType: 'scrape',
        sourceId,
        cron,
        timezone,
        active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
      setSourceId('')
      toast.success('Scrape schedule created')
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

  const triggerMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.trigger(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
      toast.success('Schedule triggered successfully')
    },
    onError: () => {
      toast.error('Failed to trigger schedule')
    },
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Create Scrape Schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3">
            <Label>Schedule Builder</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => {
                setMode(v as any)
                handleBuilderInteraction()
              }}
              className="grid grid-cols-1 md:grid-cols-3 gap-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="everyNMinutes" id="mode-everyN" />
                <Label htmlFor="mode-everyN" className="text-sm cursor-pointer">
                  Every N minutes
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="hourly" id="mode-hourly" />
                <Label htmlFor="mode-hourly" className="text-sm cursor-pointer">
                  Hourly at minute
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="daily" id="mode-daily" />
                <Label htmlFor="mode-daily" className="text-sm cursor-pointer">
                  Daily at time
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="weekly" id="mode-weekly" />
                <Label htmlFor="mode-weekly" className="text-sm cursor-pointer">
                  Weekly on days
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="monthly" id="mode-monthly" />
                <Label htmlFor="mode-monthly" className="text-sm cursor-pointer">
                  Monthly on day
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="custom" id="mode-custom" />
                <Label htmlFor="mode-custom" className="text-sm cursor-pointer">
                  Custom cron
                </Label>
              </div>
            </RadioGroup>

            {mode === 'everyNMinutes' && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">Every</Label>
                <Input
                  type="number"
                  min={1}
                  max={59}
                  value={everyN}
                  onChange={(e) => {
                    handleBuilderInteraction()
                    setEveryN(parseInt(e.target.value || '1', 10))
                  }}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
            )}
            {mode === 'hourly' && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">At minute</Label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={hourlyMinute}
                  onChange={(e) => {
                    handleBuilderInteraction()
                    setHourlyMinute(parseInt(e.target.value || '0', 10))
                  }}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">each hour</span>
              </div>
            )}
            {mode === 'daily' && (
              <div className="flex items-center gap-2">
                <Label className="text-sm">Time</Label>
                <Select
                  value={String(dailyHour12)}
                  onValueChange={(v) => {
                    handleBuilderInteraction()
                    setDailyHour12(parseInt(v, 10))
                  }}
                >
                  <SelectTrigger className="w-20">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={String(dailyMinute)}
                  onValueChange={(v) => {
                    handleBuilderInteraction()
                    setDailyMinute(parseInt(v, 10))
                  }}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 60 }, (_, i) => i)
                      .filter((m) => m % 5 === 0)
                      .map((m) => (
                        <SelectItem key={m} value={String(m)}>
                          {String(m).padStart(2, '0')}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select
                  value={dailyMeridiem}
                  onValueChange={(v) => {
                    handleBuilderInteraction()
                    setDailyMeridiem(v as 'AM' | 'PM')
                  }}
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {mode === 'weekly' && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Time</Label>
                  <Select
                    value={String(weeklyHour12)}
                    onValueChange={(v) => {
                      handleBuilderInteraction()
                      setWeeklyHour12(parseInt(v, 10))
                    }}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(weeklyMinute)}
                    onValueChange={(v) => {
                      handleBuilderInteraction()
                      setWeeklyMinute(parseInt(v, 10))
                    }}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 60 }, (_, i) => i)
                        .filter((m) => m % 5 === 0)
                        .map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {String(m).padStart(2, '0')}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={weeklyMeridiem}
                    onValueChange={(v) => {
                      handleBuilderInteraction()
                      setWeeklyMeridiem(v as 'AM' | 'PM')
                    }}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AM">AM</SelectItem>
                      <SelectItem value="PM">PM</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-3">
                  {[
                    { k: '0', label: 'Sun' },
                    { k: '1', label: 'Mon' },
                    { k: '2', label: 'Tue' },
                    { k: '3', label: 'Wed' },
                    { k: '4', label: 'Thu' },
                    { k: '5', label: 'Fri' },
                    { k: '6', label: 'Sat' },
                  ].map((d) => (
                    <label key={d.k} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={!!weeklyDays[d.k]}
                        onCheckedChange={(v) => {
                          const next = { ...weeklyDays, [d.k]: !!v }
                          handleBuilderInteraction()
                          setWeeklyDays(next)
                        }}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {mode === 'monthly' && (
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Day</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={monthlyDay}
                    onChange={(e) => {
                      handleBuilderInteraction()
                      setMonthlyDay(parseInt(e.target.value || '1', 10))
                    }}
                    className="w-24"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm">Time</Label>
                  <Select
                    value={String(monthlyHour12)}
                    onValueChange={(v) => {
                      handleBuilderInteraction()
                      setMonthlyHour12(parseInt(v, 10))
                    }}
                  >
                    <SelectTrigger className="w-20">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                        <SelectItem key={h} value={String(h)}>
                          {h}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(monthlyMinute)}
                    onValueChange={(v) => {
                      handleBuilderInteraction()
                      setMonthlyMinute(parseInt(v, 10))
                    }}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 60 }, (_, i) => i)
                        .filter((m) => m % 5 === 0)
                        .map((m) => (
                          <SelectItem key={m} value={String(m)}>
                            {String(m).padStart(2, '0')}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={monthlyMeridiem}
                    onValueChange={(v) => {
                      handleBuilderInteraction()
                      setMonthlyMeridiem(v as 'AM' | 'PM')
                    }}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AM">AM</SelectItem>
                      <SelectItem value="PM">PM</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-start">
            <div>
              <Label>Source</Label>
              <Select value={sourceId} onValueChange={setSourceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose source..." />
                </SelectTrigger>
                <SelectContent>
                  {sources?.sources
                    .filter((s) => s.active && s.moduleKey !== 'ai_poster_import')
                    .map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label>
                  {manualCron ? 'Cron (manual)' : mode === 'custom' ? 'Cron (custom)' : 'Cron (generated)'}
                </Label>
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={manualCron} onCheckedChange={(v) => setManualCron(!!v)} />
                  Edit manually
                </label>
              </div>
              <Input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="e.g. 0 6 * * *"
                disabled={!manualCron && mode !== 'custom'}
              />
            </div>
            <div>
              <Label>Timezone</Label>
              <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/Vancouver" />
            </div>
            <div className="flex items-end">
              <Button
                onClick={async () => {
                  if (!sourceId || !cron) {
                    toast.error('Select source and cron')
                    return
                  }
                  try {
                    await createMutation.mutateAsync()
                  } catch {
                    toast.error('Failed to create schedule')
                  }
                }}
              >
                Add Schedule
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scrape Schedules</CardTitle>
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
              {scrapeSchedules.map((row: ScheduleWithSource) => (
                <TableRow key={row.schedule.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Play className="h-4 w-4 text-muted-foreground" />
                      {row.source?.name || row.schedule.sourceId}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.schedule.cron}</TableCell>
                  <TableCell className="font-mono text-xs">{row.schedule.timezone}</TableCell>
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
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await triggerMutation.mutateAsync(row.schedule.id)
                        } catch {
                          // Error handled by mutation
                        }
                      }}
                      disabled={triggerMutation.isPending}
                    >
                      <Play className="h-3 w-3 mr-1" />
                      Run Now
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        try {
                          await deleteMutation.mutateAsync(row.schedule.id)
                          toast.success('Schedule deleted')
                        } catch {
                          toast.error('Delete failed')
                        }
                      }}
                    >
                      Delete
                    </Button>
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
