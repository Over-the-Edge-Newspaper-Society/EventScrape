import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { runsApi, sourcesApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { toast } from 'sonner'
import { DatePicker } from '@/components/ui/date-picker'
import { Play, CheckCircle2, XCircle, Clock, Filter, Eye, Activity, CheckCircle, RotateCcw, AlertCircle, Calendar, Layers, FileSpreadsheet, Upload, Download, ExternalLink, Zap } from 'lucide-react'
import { RunDetailDialog } from '@/components/runs/RunDetailDialog'
export function Runs() {
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedSourceForTrigger, setSelectedSourceForTrigger] = useState<string>('')
  const [scrapeMode, setScrapeMode] = useState<'full' | 'incremental'>('full')
  const [scrapeAllPages, setScrapeAllPages] = useState(true)
  const [maxPages, setMaxPages] = useState<number>(10)
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [runMode, setRunMode] = useState<'scrape' | 'upload'>('scrape')
  const [csvContent, setCsvContent] = useState<string>('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  // Poster Import UI moved to dedicated page

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['runs', { sourceId: sourceFilter === 'all' ? undefined : sourceFilter }],
    queryFn: () => runsApi.getAll({ sourceId: sourceFilter === 'all' ? undefined : sourceFilter }),
    refetchInterval: 5000, // Refresh every 5 seconds to get real-time updates
  })

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.getAll(),
  })

  // Auto-detect pagination type based on selected source
  const getSourcePaginationType = (moduleKey: string): 'page' | 'calendar' | 'none' => {
    // Map module keys to their pagination types
    const paginationMap: Record<string, 'page' | 'calendar' | 'none'> = {
      'tourismpg_com': 'calendar',
      'unbctimberwolves_com': 'calendar',
      'unbc_ca': 'page',
      'prince_george_ca': 'calendar',
      'downtownpg_com': 'calendar',
      // Add more modules as needed
    }
    return paginationMap[moduleKey] || 'none'
  }

  // Get integration tags for a module
  const getModuleIntegrationTags = (moduleKey: string): string[] => {
    const integrationTagsMap: Record<string, string[]> = {
      'tourismpg_com': ['calendar'],
      'unbctimberwolves_com': ['calendar', 'csv'],
      'unbc_ca': ['page-navigation'],
      'prince_george_ca': ['calendar'],
      'downtownpg_com': ['calendar'],
      'ai_poster_import': ['csv'], // signals upload capability in current UI
      // Add more modules as needed
    }
    return integrationTagsMap[moduleKey] || []
  }

  // Check if module supports uploads
  const moduleSupportsUpload = (moduleKey: string): boolean => {
    const uploadSupportMap: Record<string, boolean> = {
      'unbctimberwolves_com': true,
      'ai_poster_import': true,
    }
    return uploadSupportMap[moduleKey] || false
  }

  // Get upload instructions for a module
  const getUploadInstructions = (moduleKey: string): string => {
    const instructionsMap: Record<string, string> = {
      'unbctimberwolves_com': `To download events manually:
1. Go to https://unbctimberwolves.com/calendar
2. Click the "Sync/Download" button (calendar icon)
3. Select "Excel" as the export format
4. Click "Download Now"
5. Upload the downloaded CSV file below`,
      'ai_poster_import': `To import events from posters:
1. Use the Poster Import prompt (see repo: Poster Import/poster-import-prompt.md)
2. Run the prompt on your poster image with an LLM (Claude/GPT-4o etc.)
3. Copy the JSON output that matches the prompt schema
4. Upload a .json file below or paste the JSON into the text area`
    }
    return instructionsMap[moduleKey] || 'Upload instructions not available'
  }

  // Render integration tag badges
  const renderIntegrationTags = (tags: string[]) => {
    return tags.map((tag) => {
      switch (tag) {
        case 'calendar':
          return (
            <Badge key={tag} variant="secondary" className="text-xs bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100 border-emerald-200 dark:border-emerald-700">
              <Calendar className="h-3 w-3 mr-1" />
              Calendar
            </Badge>
          )
        case 'csv':
          return (
            <Badge key={tag} variant="secondary" className="text-xs bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 border-orange-200 dark:border-orange-700">
              <FileSpreadsheet className="h-3 w-3 mr-1" />
              CSV
            </Badge>
          )
        case 'page-navigation':
          return (
            <Badge key={tag} variant="secondary" className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-700">
              <Layers className="h-3 w-3 mr-1" />
              Page Nav
            </Badge>
          )
        default:
          return null
      }
    })
  }

  const selectedSource = sources?.sources.find(s => s.moduleKey === selectedSourceForTrigger)
  const currentPaginationType = selectedSource ? getSourcePaginationType(selectedSource.moduleKey) : 'none'
  const currentModuleSupportsUpload = selectedSource ? moduleSupportsUpload(selectedSource.moduleKey) : false

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setUploadFile(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setCsvContent(content)
      }
      reader.readAsText(file)
    }
  }

  // Poster Import UI moved to dedicated page

  const triggerScrapeMutation = useMutation({
    mutationFn: (params: { sourceKey: string; options?: any }) => 
      runsApi.triggerScrape(params.sourceKey, params.options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const triggerTestMutation = useMutation({
    mutationFn: (sourceKey: string) => runsApi.triggerTest(sourceKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const cancelRunMutation = useMutation({
    mutationFn: (runId: string) => runsApi.cancel(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  // Poster Import UI moved to dedicated page


  const handleTriggerRun = async () => {
    if (!selectedSourceForTrigger) {
      toast.error('Please select a source to scrape')
      return
    }
    
    // Validation for upload mode
    if (runMode === 'upload' && !csvContent) {
      const isJson = selectedSourceForTrigger && selectedSource && selectedSource.moduleKey === 'ai_poster_import'
      toast.error(`Please upload a ${isJson ? 'JSON' : 'CSV'} file or paste content`)
      return
    }
    
    try {
      if (scrapeMode === 'incremental') {
        await triggerTestMutation.mutateAsync(selectedSourceForTrigger)
        toast.success('Test scrape started successfully')
      } else {
        const options: any = {
          scrapeMode,
        }
        
        // Add upload data if in upload mode
        if (runMode === 'upload' && csvContent) {
          const isJson = selectedSource && selectedSource.moduleKey === 'ai_poster_import'
          options.uploadedFile = {
            format: (isJson ? 'json' : 'csv') as 'csv' | 'json',
            content: csvContent,
            path: uploadFile?.name || (isJson ? 'uploaded.json' : 'uploaded.csv')
          }
        } else if (runMode === 'scrape' && currentPaginationType !== 'none') {
          // Only add pagination options for scrape mode
          options.paginationOptions = {
            type: currentPaginationType,
          }
          
          if (currentPaginationType === 'page') {
            options.paginationOptions.scrapeAllPages = scrapeAllPages
            if (!scrapeAllPages && maxPages > 0) {
              options.paginationOptions.maxPages = maxPages
            }
          } else if (currentPaginationType === 'calendar') {
            if (startDate) {
              // Set start of day for start date
              const start = new Date(startDate)
              start.setHours(0, 0, 0, 0)
              options.paginationOptions.startDate = start.toISOString()
            }
            if (endDate) {
              // Set end of day for end date
              const end = new Date(endDate)
              end.setHours(23, 59, 59, 999)
              options.paginationOptions.endDate = end.toISOString()
            }
          }
        }
        
        await triggerScrapeMutation.mutateAsync({ sourceKey: selectedSourceForTrigger, options })
        const modeText = runMode === 'upload' ? 'File upload processing' : 'Full scrape'
        toast.success(`${modeText} started successfully`)
      }
    } catch (error) {
      console.error('Trigger failed:', error)
      toast.error('Failed to start processing. Please try again.')
    }
  }

  const handleCancelRun = async (runId: string) => {
    try {
      await cancelRunMutation.mutateAsync(runId)
      toast.success('Run cancelled successfully')
    } catch (error: any) {
      console.error('Run cancellation failed:', error)
      
      // Check if it's a status-related error (run already completed/cancelled)
      if (error?.message?.includes('status') || error?.status === 400) {
        toast.info('This run has already completed or been cancelled')
        queryClient.invalidateQueries({ queryKey: ['runs'] })
      } else {
        toast.error('Failed to cancel run. Please try again.')
      }
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-600" />
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />
      case 'running':
        return <RotateCcw className="h-4 w-4 text-blue-600 animate-spin" />
      case 'partial':
        return <AlertCircle className="h-4 w-4 text-orange-600" />
      default:
        return <Clock className="h-4 w-4 text-gray-600" />
    }
  }

  const getStatusBadge = (status: string) => {
    const variants = {
      success: 'success',
      error: 'destructive',
      running: 'warning',
      partial: 'warning',
      queued: 'secondary',
    } as const
    
    return (
      <Badge variant={variants[status as keyof typeof variants] || 'secondary'}>
        {status}
      </Badge>
    )
  }

  // Filter runs by status if needed
  const filteredRuns = runs?.runs.filter(runData => {
    if (statusFilter === 'all') return true
    return runData.run.status === statusFilter
  }) || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Scraper Runs</h1>
        <p className="text-muted-foreground">
          View scraper execution history and trigger new runs
        </p>
      </div>

      {/* Poster Import UI moved to its own page */}

      {/* Quick Actions */}
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
                    Integration types: <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100 px-1 py-0.5 rounded text-xs"><Calendar className="h-3 w-3" />Calendar</span> (date ranges), 
                    <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 px-1 py-0.5 rounded text-xs ml-1"><Layers className="h-3 w-3" />Page Nav</span> (pagination), 
                    <span className="inline-flex items-center gap-1 bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 px-1 py-0.5 rounded text-xs ml-1"><FileSpreadsheet className="h-3 w-3" />CSV</span> (data files)
                  </p>
                  <Select value={selectedSourceForTrigger} onValueChange={setSelectedSourceForTrigger}>
                    <SelectTrigger id="source-select">
                      <SelectValue placeholder="Choose a scraping source..." />
                    </SelectTrigger>
                    <SelectContent>
                      {sources?.sources
                        .filter(source => source.active && source.moduleKey !== 'ai_poster_import')
                        .map((source) => {
                          const integrationTags = getModuleIntegrationTags(source.moduleKey)
                          return (
                            <SelectItem key={source.id} value={source.moduleKey}>
                              <div className="flex items-center gap-2 flex-wrap">
                                <Activity className="h-3 w-3" />
                                <span>{source.name}</span>
                                <div className="flex gap-1">
                                  {renderIntegrationTags(integrationTags)}
                                </div>
                              </div>
                            </SelectItem>
                          )
                        })}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Run Mode Selection - only show for modules that support upload */}
                {currentModuleSupportsUpload && (
                  <div className="space-y-2">
                    <Label>Run Mode</Label>
                    <RadioGroup value={runMode} onValueChange={(value) => setRunMode(value as 'scrape' | 'upload')}>
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
                  <RadioGroup value={scrapeMode} onValueChange={(value) => setScrapeMode(value as 'full' | 'incremental')}>
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
              
              {scrapeMode === 'full' && selectedSourceForTrigger && runMode === 'scrape' && (
                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                  <div className="space-y-2">
                    <Label>Pagination Type (Auto-detected)</Label>
                    <div className="flex items-center gap-2 p-3 bg-background border rounded-lg">
                      {currentPaginationType === 'page' && (
                        <>
                          <Layers className="h-4 w-4 text-blue-600" />
                          <span className="text-sm font-medium">Page Navigation Support</span>
                          <Badge variant="secondary" className="ml-auto bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-100 border-blue-200 dark:border-blue-700">Auto-detected</Badge>
                        </>
                      )}
                      {currentPaginationType === 'calendar' && (
                        <>
                          <Calendar className="h-4 w-4 text-green-600" />
                          <span className="text-sm font-medium">Calendar Integration Support</span>
                          <Badge variant="secondary" className="ml-auto bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100 border-emerald-200 dark:border-emerald-700">Auto-detected</Badge>
                        </>
                      )}
                      {currentPaginationType === 'none' && (
                        <>
                          <span className="text-sm font-medium text-muted-foreground">No pagination support</span>
                          <Badge variant="outline" className="ml-auto">Standard scraping</Badge>
                        </>
                      )}
                    </div>
                    {currentPaginationType === 'page' && (
                      <p className="text-xs text-muted-foreground">
                        This source supports navigating through multiple pages of events. You can scrape all pages or limit the number of pages.
                      </p>
                    )}
                    {currentPaginationType === 'calendar' && (
                      <p className="text-xs text-muted-foreground">
                        This source has calendar integration. You can specify date ranges to scrape events from specific time periods.
                      </p>
                    )}
                    {currentPaginationType === 'none' && (
                      <p className="text-xs text-muted-foreground">
                        This source uses standard scraping without pagination or calendar features.
                      </p>
                    )}
                  </div>
                  
                  {currentPaginationType === 'page' && (
                    <div className="space-y-3 pl-6">
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="scrape-all"
                          checked={scrapeAllPages}
                          onCheckedChange={setScrapeAllPages}
                        />
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
                            value={maxPages}
                            onChange={(e) => setMaxPages(parseInt(e.target.value) || 1)}
                            className="w-32"
                          />
                        </div>
                      )}
                    </div>
                  )}
                  
                  {currentPaginationType === 'calendar' && (
                    <div className="space-y-4 pl-6">
                      <div className="space-y-3">
                        <Label>Quick Date Range Presets</Label>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const now = new Date()
                              const oneWeekAgo = new Date(now)
                              oneWeekAgo.setDate(now.getDate() - 7)
                              setStartDate(oneWeekAgo)
                              setEndDate(now)
                            }}
                          >
                            Last Week
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const now = new Date()
                              const oneMonthAgo = new Date(now)
                              oneMonthAgo.setMonth(now.getMonth() - 1)
                              setStartDate(oneMonthAgo)
                              setEndDate(now)
                            }}
                          >
                            Last Month
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const now = new Date()
                              const threeMonthsAgo = new Date(now)
                              threeMonthsAgo.setMonth(now.getMonth() - 3)
                              setStartDate(threeMonthsAgo)
                              setEndDate(now)
                            }}
                          >
                            Last 3 Months
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const now = new Date()
                              const oneYearAgo = new Date(now)
                              oneYearAgo.setFullYear(now.getFullYear() - 1)
                              setStartDate(oneYearAgo)
                              setEndDate(now)
                            }}
                          >
                            Last Year
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const now = new Date()
                              const oneMonthForward = new Date(now)
                              oneMonthForward.setMonth(now.getMonth() + 1)
                              setStartDate(now)
                              setEndDate(oneMonthForward)
                            }}
                          >
                            Next Month
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const now = new Date()
                              const threeMonthsForward = new Date(now)
                              threeMonthsForward.setMonth(now.getMonth() + 3)
                              setStartDate(now)
                              setEndDate(threeMonthsForward)
                            }}
                          >
                            Next 3 Months
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const now = new Date()
                              const oneYearForward = new Date(now)
                              oneYearForward.setFullYear(now.getFullYear() + 1)
                              setStartDate(now)
                              setEndDate(oneYearForward)
                            }}
                          >
                            Next Year
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setStartDate(undefined)
                              setEndDate(undefined)
                            }}
                          >
                            Clear Dates
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label>Start Date</Label>
                          <DatePicker
                            date={startDate}
                            onSelect={setStartDate}
                            placeholder="Select start date"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>End Date</Label>
                          <DatePicker
                            date={endDate}
                            onSelect={setEndDate}
                            placeholder="Select end date"
                          />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Use the preset buttons above for quick date range selection, or manually select specific dates. Leave dates empty to scrape all available events.
                      </p>
                    </div>
                  )}
                </div>
              )}
              
              {/* Upload Section */}
              {scrapeMode === 'full' && selectedSourceForTrigger && runMode === 'upload' && currentModuleSupportsUpload && (
                <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
                  <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-orange-600" />
                {selectedSource && selectedSource.moduleKey === 'ai_poster_import' ? 'JSON Upload' : 'CSV File Upload'}
                <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100 border-orange-200 dark:border-orange-700">
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
                        {getUploadInstructions(selectedSourceForTrigger)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="csv-upload">{selectedSource && selectedSource.moduleKey === 'ai_poster_import' ? 'Upload JSON File' : 'Upload CSV File'}</Label>
                      <Input
                        id="csv-upload"
                        type="file"
                        accept={selectedSource && selectedSource.moduleKey === 'ai_poster_import' ? '.json' : '.csv,.xlsx,.xls'}
                        onChange={handleFileUpload}
                        className="file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/80"
                      />
                      {uploadFile && (
                        <p className="text-xs text-green-600">
                          ✓ File loaded: {uploadFile.name}
                        </p>
                      )}
                    </div>
                    
                    <div className="space-y-2">
                      <Label htmlFor="csv-content">{selectedSource && selectedSource.moduleKey === 'ai_poster_import' ? 'Or Paste JSON Content' : 'Or Paste CSV Content'}</Label>
                      <Textarea
                        id="csv-content"
                        placeholder={selectedSource && selectedSource.moduleKey === 'ai_poster_import' ? 'Paste your JSON content here...' : 'Paste your CSV content here...'}
                        value={csvContent}
                        onChange={(e) => setCsvContent(e.target.value)}
                        rows={6}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        {selectedSource && selectedSource.moduleKey === 'ai_poster_import'
                          ? 'You can either upload a .json file above or paste the JSON content directly here.'
                          : 'You can either upload a file above or paste the CSV content directly here.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex justify-start">
                <Button
                  onClick={handleTriggerRun}
                  disabled={!selectedSourceForTrigger || triggerScrapeMutation.isPending || triggerTestMutation.isPending}
                  className="flex items-center gap-2"
                  size="lg"
                >
                  {scrapeMode === 'incremental' ? <Eye className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                  {triggerScrapeMutation.isPending || triggerTestMutation.isPending 
                    ? 'Starting...' 
                    : `Start ${scrapeMode === 'incremental' ? 'Test' : 'Full'} Scrape`
                  }
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div>
              <label className="text-sm font-medium">Filter by Source</label>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sources</SelectItem>
                  {sources?.sources.map((source) => (
                    <SelectItem key={source.id} value={source.id}>
                      {source?.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <label className="text-sm font-medium">Filter by Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
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

      {/* Runs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
          <CardDescription>
            {runs?.runs.length
              ? `${filteredRuns.length} of ${runs.runs.length} runs`
              : 'Loading run history...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runsLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading runs...</p>
            </div>
          ) : !filteredRuns.length ? (
            <div className="text-center py-8">
              <Activity className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No runs found</p>
              <p className="text-sm text-muted-foreground mt-2">
                {statusFilter !== 'all' || sourceFilter !== 'all' 
                  ? 'Try adjusting your filters'
                  : 'Trigger your first scrape run above'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Results</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRuns.map(({ run, source }) => {
                  const startDate = new Date(run.startedAt)
                  const finishDate = run.finishedAt ? new Date(run.finishedAt) : null
                  
                  const duration = finishDate && !isNaN(finishDate.getTime()) && !isNaN(startDate.getTime())
                    ? finishDate.getTime() - startDate.getTime()
                    : !isNaN(startDate.getTime())
                    ? Date.now() - startDate.getTime()
                    : 0
                  
                  const durationFormatted = `${Math.floor(duration / 1000)}s`
                  
                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          {getStatusBadge(run.status)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-sm">{source?.name}</p>
                          <Badge variant="outline" className="text-xs font-mono">
                            {source?.moduleKey}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm">{formatRelativeTime(run.startedAt)}</p>
                          <p className="text-xs text-muted-foreground">
                            {!isNaN(startDate.getTime()) ? startDate.toLocaleString() : 'Invalid date'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-sm">{durationFormatted}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <span className="text-sm font-medium">{run.eventsFound}</span>
                            <span className="text-xs text-muted-foreground">events</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-muted-foreground">{run.pagesCrawled} pages</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedRunId(run.id)}
                                className="flex items-center gap-1"
                              >
                                <Eye className="h-3 w-3" />
                                Details
                              </Button>
                            </DialogTrigger>
                            {selectedRunId && (
                              <RunDetailDialog
                                runId={selectedRunId}
                                onClose={() => setSelectedRunId(null)}
                              />
                            )}
                          </Dialog>
                          
                          {(run.status === 'running' || run.status === 'queued') && (
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => handleCancelRun(run.id)}
                              disabled={cancelRunMutation.isPending}
                              className="flex items-center gap-1"
                            >
                              <XCircle className="h-3 w-3" />
                              Cancel
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Stats Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">
                  {runs?.runs.filter(r => r.run.status === 'success').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Successful</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <XCircle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-2xl font-bold">
                  {runs?.runs.filter(r => r.run.status === 'error').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <RotateCcw className="h-8 w-8 text-blue-600" />
              <div>
                <p className="text-2xl font-bold">
                  {runs?.runs.filter(r => r.run.status === 'running').length || 0}
                </p>
                <p className="text-sm text-muted-foreground">Running</p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Activity className="h-8 w-8 text-purple-600" />
              <div>
                <p className="text-2xl font-bold">
                  {runs?.runs.reduce((sum, r) => sum + r.run.eventsFound, 0) || 0}
                </p>
                <p className="text-sm text-muted-foreground">Total Events</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
