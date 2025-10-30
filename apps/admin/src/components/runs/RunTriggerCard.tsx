import { ChangeEvent } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Activity,
  Calendar,
  Layers,
  FileSpreadsheet,
  Upload,
  Download,
  ExternalLink,
  Zap,
  Eye,
} from 'lucide-react'
import { Source } from '@/lib/api'
import {
  getModuleIntegrationTags,
  getUploadInstructions,
  PaginationType,
} from './runMetadata'

interface RunTriggerCardProps {
  sources: Source[]
  selectedSourceKey: string
  onSelectSourceKey: (value: string) => void
  runMode: 'scrape' | 'upload'
  onRunModeChange: (mode: 'scrape' | 'upload') => void
  scrapeMode: 'full' | 'incremental'
  onScrapeModeChange: (mode: 'full' | 'incremental') => void
  paginationType: PaginationType
  supportsUpload: boolean
  scrapeAllPages: boolean
  onScrapeAllPagesChange: (value: boolean) => void
  maxPages: number
  onMaxPagesChange: (value: number) => void
  startDate?: Date
  endDate?: Date
  onStartDateChange: (date: Date | undefined) => void
  onEndDateChange: (date: Date | undefined) => void
  csvContent: string
  onCsvContentChange: (value: string) => void
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void
  uploadFileName?: string
  onTriggerRun: () => void
  isTriggering: boolean
  isTestTriggering: boolean
  selectedSource?: Source
}

const renderIntegrationTags = (tags: string[]) => {
  return tags.map((tag) => {
    switch (tag) {
      case 'calendar':
        return (
          <Badge
            key={tag}
            variant="secondary"
            className="text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100 border-emerald-200 dark:border-emerald-700"
          >
            <Calendar className="h-3 w-3 mr-1" />
            Calendar
          </Badge>
        )
      case 'csv':
        return (
          <Badge
            key={tag}
            variant="secondary"
            className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 border-orange-200 dark:border-orange-700"
          >
            <FileSpreadsheet className="h-3 w-3 mr-1" />
            CSV
          </Badge>
        )
      case 'page-navigation':
        return (
          <Badge
            key={tag}
            variant="secondary"
            className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-700"
          >
            <Layers className="h-3 w-3 mr-1" />
            Page Nav
          </Badge>
        )
      default:
        return null
    }
  })
}

const QUICK_RANGES: Array<{
  label: string
  apply: (setStart: (date: Date | undefined) => void, setEnd: (date: Date | undefined) => void) => void
}> = [
  {
    label: 'Last Week',
    apply: (setStart, setEnd) => {
      const now = new Date()
      const oneWeekAgo = new Date(now)
      oneWeekAgo.setDate(now.getDate() - 7)
      setStart(oneWeekAgo)
      setEnd(now)
    },
  },
  {
    label: 'Last Month',
    apply: (setStart, setEnd) => {
      const now = new Date()
      const oneMonthAgo = new Date(now)
      oneMonthAgo.setMonth(now.getMonth() - 1)
      setStart(oneMonthAgo)
      setEnd(now)
    },
  },
  {
    label: 'Last 3 Months',
    apply: (setStart, setEnd) => {
      const now = new Date()
      const threeMonthsAgo = new Date(now)
      threeMonthsAgo.setMonth(now.getMonth() - 3)
      setStart(threeMonthsAgo)
      setEnd(now)
    },
  },
  {
    label: 'Last Year',
    apply: (setStart, setEnd) => {
      const now = new Date()
      const oneYearAgo = new Date(now)
      oneYearAgo.setFullYear(now.getFullYear() - 1)
      setStart(oneYearAgo)
      setEnd(now)
    },
  },
  {
    label: 'Next Month',
    apply: (setStart, setEnd) => {
      const now = new Date()
      const oneMonthForward = new Date(now)
      oneMonthForward.setMonth(now.getMonth() + 1)
      setStart(now)
      setEnd(oneMonthForward)
    },
  },
  {
    label: 'Next 3 Months',
    apply: (setStart, setEnd) => {
      const now = new Date()
      const threeMonthsForward = new Date(now)
      threeMonthsForward.setMonth(now.getMonth() + 3)
      setStart(now)
      setEnd(threeMonthsForward)
    },
  },
  {
    label: 'Next Year',
    apply: (setStart, setEnd) => {
      const now = new Date()
      const oneYearForward = new Date(now)
      oneYearForward.setFullYear(now.getFullYear() + 1)
      setStart(now)
      setEnd(oneYearForward)
    },
  },
]

export function RunTriggerCard({
  sources,
  selectedSourceKey,
  onSelectSourceKey,
  runMode,
  onRunModeChange,
  scrapeMode,
  onScrapeModeChange,
  paginationType,
  supportsUpload,
  scrapeAllPages,
  onScrapeAllPagesChange,
  maxPages,
  onMaxPagesChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  csvContent,
  onCsvContentChange,
  onFileUpload,
  uploadFileName,
  onTriggerRun,
  isTriggering,
  isTestTriggering,
  selectedSource,
}: RunTriggerCardProps) {
  const selectableSources = sources.filter(
    (source) => source.active && source.moduleKey !== 'ai_poster_import',
  )

  const uploadInstructions = selectedSourceKey
    ? getUploadInstructions(selectedSourceKey)
    : undefined

  const disableTrigger = !selectedSourceKey || isTriggering || isTestTriggering

  return (
    <Card>
      <CardContent className="pt-6">
        <div>
          <div className="mb-6">
            <h3 className="font-semibold mb-2">Trigger New Runs</h3>
            <p className="text-sm text-muted-foreground">
              Manually start scraping for active sources
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="source-select">Select Source</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Integration types:{' '}
                  <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100 px-1 py-0.5 rounded text-xs">
                    <Calendar className="h-3 w-3" />
                    Calendar
                  </span>{' '}
                  (date ranges),
                  <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 px-1 py-0.5 rounded text-xs ml-1">
                    <Layers className="h-3 w-3" />
                    Page Nav
                  </span>{' '}
                  (pagination),
                  <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 px-1 py-0.5 rounded text-xs ml-1">
                    <FileSpreadsheet className="h-3 w-3" />
                    CSV
                  </span>{' '}
                  (data files)
                </p>
                <Select value={selectedSourceKey} onValueChange={onSelectSourceKey}>
                  <SelectTrigger id="source-select">
                    <SelectValue placeholder="Choose a scraping source..." />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableSources.map((source) => {
                      const integrationTags = getModuleIntegrationTags(source.moduleKey)
                      return (
                        <SelectItem key={source.id} value={source.moduleKey}>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Activity className="h-3 w-3" />
                            <span>{source.name}</span>
                            <div className="flex gap-1">{renderIntegrationTags(integrationTags)}</div>
                          </div>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>

              {supportsUpload && (
                <div className="space-y-2">
                  <Label>Run Mode</Label>
                  <RadioGroup value={runMode} onValueChange={(value) => onRunModeChange(value as 'scrape' | 'upload')}>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="scrape" id="scrape-mode" />
                      <Label htmlFor="scrape-mode" className="text-sm cursor-pointer">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3" />
                          Scrape from Website
                        </div>
                      </Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="upload" id="upload-mode" />
                      <Label htmlFor="upload-mode" className="text-sm cursor-pointer">
                        <div className="flex items-center gap-2">
                          <Upload className="h-3 w-3" />
                          Upload CSV File
                        </div>
                      </Label>
                    </div>
                  </RadioGroup>
                </div>
              )}

              <div className="space-y-2">
                <Label>Scrape Mode</Label>
                <RadioGroup value={scrapeMode} onValueChange={(value) => onScrapeModeChange(value as 'full' | 'incremental')}>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="full" id="full-mode" />
                    <Label htmlFor="full-mode" className="text-sm cursor-pointer">
                      Full Mode (Default - All Events)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="incremental" id="test-mode" />
                    <Label htmlFor="test-mode" className="text-sm cursor-pointer">
                      Test Mode (First Event Only)
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            </div>

            {scrapeMode === 'full' && selectedSourceKey && runMode === 'scrape' && (
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <div className="space-y-2">
                  <Label>Pagination Type (Auto-detected)</Label>
                  <div className="flex items-center gap-2 p-3 bg-background border rounded-lg">
                    {paginationType === 'page' && (
                      <>
                        <Layers className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium">Page Navigation Support</span>
                        <Badge className="ml-auto bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-700" variant="secondary">
                          Auto-detected
                        </Badge>
                      </>
                    )}
                    {paginationType === 'calendar' && (
                      <>
                        <Calendar className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium">Calendar Integration Support</span>
                        <Badge className="ml-auto bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100 border-emerald-200 dark:border-emerald-700" variant="secondary">
                          Auto-detected
                        </Badge>
                      </>
                    )}
                    {paginationType === 'none' && (
                      <>
                        <span className="text-sm font-medium text-muted-foreground">No pagination support</span>
                        <Badge variant="outline" className="ml-auto">
                          Standard scraping
                        </Badge>
                      </>
                    )}
                  </div>
                  {paginationType === 'page' && (
                    <p className="text-xs text-muted-foreground">
                      This source supports navigating through multiple pages of events. You can scrape all pages or limit the number of pages.
                    </p>
                  )}
                  {paginationType === 'calendar' && (
                    <p className="text-xs text-muted-foreground">
                      This source has calendar integration. You can specify date ranges to scrape events from specific time periods.
                    </p>
                  )}
                  {paginationType === 'none' && (
                    <p className="text-xs text-muted-foreground">
                      This source uses standard scraping without pagination or calendar features.
                    </p>
                  )}
                </div>

                {paginationType === 'page' && (
                  <div className="space-y-3 pl-6">
                    <div className="flex items-center space-x-2">
                      <Switch id="scrape-all" checked={scrapeAllPages} onCheckedChange={onScrapeAllPagesChange} />
                      <Label htmlFor="scrape-all" className="text-sm cursor-pointer">
                        Scrape all pages until the end
                      </Label>
                    </div>

                    {!scrapeAllPages && (
                      <div className="space-y-2">
                        <Label htmlFor="max-pages">Maximum pages to scrape</Label>
                        <Input
                          id="max-pages"
                          type="number"
                          min="1"
                          value={Number.isFinite(maxPages) ? String(maxPages) : ''}
                          onChange={(event) => {
                            const value = parseInt(event.target.value, 10)
                            onMaxPagesChange(Number.isNaN(value) ? 1 : value)
                          }}
                          className="w-32"
                        />
                      </div>
                    )}
                  </div>
                )}

                {paginationType === 'calendar' && (
                  <div className="space-y-4 pl-6">
                    <div className="space-y-3">
                      <Label>Quick Date Range Presets</Label>
                      <div className="flex flex-wrap gap-2">
                        {QUICK_RANGES.map(({ label, apply }) => (
                          <Button
                            key={label}
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => apply(onStartDateChange, onEndDateChange)}
                          >
                            {label}
                          </Button>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            onStartDateChange(undefined)
                            onEndDateChange(undefined)
                          }}
                        >
                          Clear Dates
                        </Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Start Date</Label>
                        <DatePicker date={startDate} onSelect={onStartDateChange} placeholder="Select start date" />
                      </div>
                      <div className="space-y-2">
                        <Label>End Date</Label>
                        <DatePicker date={endDate} onSelect={onEndDateChange} placeholder="Select end date" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Use the preset buttons above for quick date range selection, or manually select specific dates. Leave dates empty to scrape all available events.
                    </p>
                  </div>
                )}
              </div>
            )}

            {scrapeMode === 'full' && selectedSourceKey && runMode === 'upload' && supportsUpload && (
              <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                <div className="space-y-2">
                  <Label className="flex items-center gap-2">
                    <Upload className="h-4 w-4 text-orange-600" />
                    {selectedSource?.moduleKey === 'ai_poster_import' ? 'JSON Upload' : 'CSV File Upload'}
                    <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 border-orange-200 dark:border-orange-700" variant="secondary">
                      File Processing Mode
                    </Badge>
                  </Label>
                  <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-700 rounded-lg">
                    <div className="flex items-center gap-2 mb-2">
                      <Download className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-800 dark:text-blue-100">Download Instructions</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => window.open('https://unbctimberwolves.com/calendar', '_blank')}
                        className="ml-auto text-blue-600 hover:text-blue-700"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Open Site
                      </Button>
                    </div>
                    <div className="text-xs text-blue-700 dark:text-blue-200 whitespace-pre-line">
                      {uploadInstructions}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="csv-upload">
                      {selectedSource?.moduleKey === 'ai_poster_import' ? 'Upload JSON File' : 'Upload CSV File'}
                    </Label>
                    <Input
                      id="csv-upload"
                      type="file"
                      accept={selectedSource?.moduleKey === 'ai_poster_import' ? '.json' : '.csv,.xlsx,.xls'}
                      onChange={onFileUpload}
                      className="file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/80"
                    />
                    {uploadFileName && (
                      <p className="text-xs text-green-600">✓ File loaded: {uploadFileName}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="csv-content">
                      {selectedSource?.moduleKey === 'ai_poster_import' ? 'Or Paste JSON Content' : 'Or Paste CSV Content'}
                    </Label>
                    <Textarea
                      id="csv-content"
                      placeholder={
                        selectedSource?.moduleKey === 'ai_poster_import'
                          ? 'Paste your JSON content here...'
                          : 'Paste your CSV content here...'
                      }
                      value={csvContent}
                      onChange={(event) => onCsvContentChange(event.target.value)}
                      rows={6}
                      className="font-mono text-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      {selectedSource?.moduleKey === 'ai_poster_import'
                        ? 'You can either upload a .json file above or paste the JSON content directly here.'
                        : 'You can either upload a file above or paste the CSV content directly here.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-start">
              <Button
                onClick={onTriggerRun}
                disabled={disableTrigger}
                className="flex items-center gap-2"
                size="lg"
              >
                {scrapeMode === 'incremental' ? <Eye className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                {isTriggering || isTestTriggering
                  ? 'Starting...'
                  : `Start ${scrapeMode === 'incremental' ? 'Test' : 'Full'} Scrape`}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
