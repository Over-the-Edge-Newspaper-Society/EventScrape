import { type ChangeEvent, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { runsApi, sourcesApi, type RunListItem, type RunsPagination, type Source } from '@/lib/api'
import { toast } from 'sonner'
import { RunDetailDialog } from '@/components/runs/RunDetailDialog'
import { RunTriggerCard } from '@/components/runs/RunTriggerCard'
import { RunFiltersCard } from '@/components/runs/RunFiltersCard'
import { RunHistoryTable } from '@/components/runs/RunHistoryTable'
import { RunStatsGrid } from '@/components/runs/RunStatsGrid'
import { getSourcePaginationType, moduleSupportsUpload } from '@/components/runs/runMetadata'

export function Runs() {
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [selectedSourceForTrigger, setSelectedSourceForTrigger] = useState('')
  const [scrapeMode, setScrapeMode] = useState<'full' | 'incremental'>('full')
  const [scrapeAllPages, setScrapeAllPages] = useState(true)
  const [maxPages, setMaxPages] = useState(10)
  const [startDate, setStartDate] = useState<Date | undefined>()
  const [endDate, setEndDate] = useState<Date | undefined>()
  const [runMode, setRunMode] = useState<'scrape' | 'upload'>('scrape')
  const [csvContent, setCsvContent] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)

  useEffect(() => {
    setPage(1)
  }, [sourceFilter, statusFilter])

  const { data: runsData, isLoading: runsLoading } = useQuery<{
    runs: RunListItem[]
    pagination: RunsPagination
  }>({
    queryKey: ['runs', { sourceId: sourceFilter === 'all' ? undefined : sourceFilter, page, limit: pageSize }],
    queryFn: () =>
      runsApi.getAll({
        sourceId: sourceFilter === 'all' ? undefined : sourceFilter,
        page,
        limit: pageSize,
      }),
    placeholderData: (previousData) => previousData,
    refetchInterval: 5000,
  })

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.getAll(),
  })

  const sourcesList = sources?.sources ?? []

  const selectedSource = useMemo<Source | undefined>(() => {
    return sourcesList.find((source) => source.moduleKey === selectedSourceForTrigger)
  }, [sourcesList, selectedSourceForTrigger])

  const currentPaginationType = selectedSource ? getSourcePaginationType(selectedSource.moduleKey) : 'none'
  const currentModuleSupportsUpload = selectedSource ? moduleSupportsUpload(selectedSource.moduleKey) : false

  useEffect(() => {
    if (!currentModuleSupportsUpload && runMode === 'upload') {
      setRunMode('scrape')
      setCsvContent('')
      setUploadFile(null)
    }
  }, [currentModuleSupportsUpload, runMode])

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    const reader = new FileReader()
    reader.onload = (e) => {
      const content = e.target?.result as string
      setCsvContent(content)
    }
    reader.readAsText(file)
  }

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

  const handleTriggerRun = async () => {
    if (!selectedSourceForTrigger) {
      toast.error('Please select a source to scrape')
      return
    }

    if (runMode === 'upload' && !currentModuleSupportsUpload) {
      toast.error('This source does not support file uploads')
      return
    }

    if (runMode === 'upload' && !csvContent) {
      const isJson = selectedSource?.moduleKey === 'ai_poster_import'
      toast.error(`Please upload a ${isJson ? 'JSON' : 'CSV'} file or paste content`)
      return
    }

    try {
      if (scrapeMode === 'incremental') {
        await triggerTestMutation.mutateAsync(selectedSourceForTrigger)
        toast.success('Test scrape started successfully')
        return
      }

      const options: any = {
        scrapeMode,
      }

      if (runMode === 'upload' && csvContent) {
        const isJson = selectedSource?.moduleKey === 'ai_poster_import'
        options.uploadedFile = {
          format: (isJson ? 'json' : 'csv') as 'csv' | 'json',
          content: csvContent,
          path: uploadFile?.name || (isJson ? 'uploaded.json' : 'uploaded.csv'),
        }
      } else if (runMode === 'scrape' && currentPaginationType !== 'none') {
        options.paginationOptions = {
          type: currentPaginationType,
        }

        if (currentPaginationType === 'page') {
          options.paginationOptions.scrapeAllPages = scrapeAllPages
          if (!scrapeAllPages && maxPages > 0) {
            options.paginationOptions.maxPages = maxPages
          }
        }

        if (currentPaginationType === 'calendar') {
          if (startDate) {
            const start = new Date(startDate)
            start.setHours(0, 0, 0, 0)
            options.paginationOptions.startDate = start.toISOString()
          }
          if (endDate) {
            const end = new Date(endDate)
            end.setHours(23, 59, 59, 999)
            options.paginationOptions.endDate = end.toISOString()
          }
        }
      }

      await triggerScrapeMutation.mutateAsync({ sourceKey: selectedSourceForTrigger, options })
      const modeText = runMode === 'upload' ? 'File upload processing' : 'Full scrape'
      toast.success(`${modeText} started successfully`)
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
      if (error?.message?.includes('status') || error?.status === 400) {
        toast.info('This run has already completed or been cancelled')
        queryClient.invalidateQueries({ queryKey: ['runs'] })
      } else {
        toast.error('Failed to cancel run. Please try again.')
      }
    }
  }

  const runItems = runsData?.runs ?? []
  const pagination = runsData?.pagination
  const totalRuns = pagination?.total ?? runItems.length
  const totalPages = pagination?.totalPages ?? 1

  const statusCounts = useMemo(() => {
    return runItems.reduce(
      (acc: Record<string, number>, item: RunListItem) => {
        const status = item.run.status
        acc[status] = (acc[status] ?? 0) + 1
        return acc
      },
      { success: 0, error: 0, running: 0, partial: 0, queued: 0 } as Record<string, number>,
    )
  }, [runItems])

  const filteredRuns = useMemo(() => {
    return (
      runItems.filter((runData: RunListItem) => {
        if (statusFilter === 'all') return true
        return runData.run.status === statusFilter
      }) || []
    )
  }, [runItems, statusFilter])

  const totalEvents = useMemo(() => {
    return runItems.reduce((sum: number, item: RunListItem) => sum + (item.run.eventsFound || 0), 0)
  }, [runItems])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Scraper Runs</h1>
        <p className="text-muted-foreground">View scraper execution history and trigger new runs</p>
      </div>

      <RunTriggerCard
        sources={sourcesList}
        selectedSourceKey={selectedSourceForTrigger}
        onSelectSourceKey={setSelectedSourceForTrigger}
        runMode={runMode}
        onRunModeChange={setRunMode}
        scrapeMode={scrapeMode}
        onScrapeModeChange={setScrapeMode}
        paginationType={currentPaginationType}
        supportsUpload={currentModuleSupportsUpload}
        scrapeAllPages={scrapeAllPages}
        onScrapeAllPagesChange={setScrapeAllPages}
        maxPages={maxPages}
        onMaxPagesChange={setMaxPages}
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        csvContent={csvContent}
        onCsvContentChange={setCsvContent}
        onFileUpload={handleFileUpload}
        uploadFileName={uploadFile?.name}
        onTriggerRun={handleTriggerRun}
        isTriggering={triggerScrapeMutation.isPending}
        isTestTriggering={triggerTestMutation.isPending}
        selectedSource={selectedSource}
      />

      <RunFiltersCard
        sources={sourcesList}
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
      />

      <RunHistoryTable
        runs={filteredRuns}
        isLoading={runsLoading}
        statusFilter={statusFilter}
        sourceFilter={sourceFilter}
        page={page}
        totalPages={totalPages}
        totalRuns={totalRuns}
        onPreviousPage={() => setPage((prev) => Math.max(1, prev - 1))}
        onNextPage={() => setPage((prev) => Math.min(totalPages, prev + 1))}
        onSelectRun={setSelectedRunId}
        onCancelRun={handleCancelRun}
        isCanceling={cancelRunMutation.isPending}
      />

      {selectedRunId && (
        <RunDetailDialog
          runId={selectedRunId}
          onClose={() => setSelectedRunId(null)}
        />
      )}

      <RunStatsGrid statusCounts={statusCounts} totalEvents={totalEvents} />
    </div>
  )
}
