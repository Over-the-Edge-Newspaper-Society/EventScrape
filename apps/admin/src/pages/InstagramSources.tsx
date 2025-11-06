import { useMemo, useRef, useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  instagramApi,
  instagramApifyApi,
  type InstagramSource,
  type CreateInstagramSourceData,
  API_BASE_URL,
} from '@/lib/api'
import { toast } from 'sonner'
import { useInstagramScrapeProgress } from '@/hooks/useInstagramScrapeProgress'
import { InstagramSourcesStatsCard } from '@/components/instagram/InstagramSourcesStatsCard'
import { InstagramApifyRunCard } from '@/components/instagram/InstagramApifyRunCard'
import { InstagramAccountsActionsCard } from '@/components/instagram/InstagramAccountsActionsCard'
import { InstagramScrapeAllDialog } from '@/components/instagram/InstagramScrapeAllDialog'
import { InstagramSourcesTableCard } from '@/components/instagram/InstagramSourcesTableCard'
import { InstagramInfoCard } from '@/components/instagram/InstagramInfoCard'
import { InstagramSourceFormDialog } from '@/components/instagram/InstagramSourceFormDialog'
import { InstagramSessionUploadDialog } from '@/components/instagram/InstagramSessionUploadDialog'
import { InstagramAccountPreview, InstagramScrapeOptions, InstagramSettings } from '@/components/instagram/types'

type TriggerAllVariables = {
  postLimit?: number
  accountLimit?: number
  batchSize?: number
}

type TriggerAllResponse = Awaited<ReturnType<typeof instagramApi.triggerAllActive>>

export function InstagramSources() {
  const queryClient = useQueryClient()
  const [selectedSource, setSelectedSource] = useState<InstagramSource | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showSessionForm, setShowSessionForm] = useState(false)
  const [sessionUsername, setSessionUsername] = useState('')
  const [sessionData, setSessionData] = useState('')
  const [activeTab, setActiveTab] = useState<'active' | 'inactive' | 'all'>('active')
  const [confirmScrapeAllOpen, setConfirmScrapeAllOpen] = useState(false)
  const [scrapeOptions, setScrapeOptions] = useState<InstagramScrapeOptions>({
    accountLimit: 0,
    postsPerAccount: 10,
    batchSize: 8,
  })
  const lastScrapeOptionsRef = useRef<InstagramScrapeOptions | null>(null)

  const [apifyRunId, setApifyRunId] = useState('')
  const [apifyRunLimit, setApifyRunLimit] = useState<number>(10)
  const [apifyRunResult, setApifyRunResult] = useState<string | null>(null)
  const [apifyRunError, setApifyRunError] = useState<string | null>(null)

  const [formData, setFormData] = useState<CreateInstagramSourceData>({
    name: '',
    instagramUsername: '',
    classificationMode: 'manual',
    instagramScraperType: 'instagram-private-api',
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: '',
  })

  const { data: sources, isLoading } = useQuery({
    queryKey: ['instagram-sources'],
    queryFn: () => instagramApi.getAll(),
  })

  const sourcesList = sources?.sources ?? []

  const activeAccountPreview = useMemo<InstagramAccountPreview[]>(() => {
    return sourcesList
      .filter((source) => source.active)
      .map((source) => ({
        id: source.id,
        username: source.instagramUsername,
        name: source.name,
      }))
  }, [sourcesList])

  const { data: settingsData } = useQuery({
    queryKey: ['instagram-settings'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-settings`)
      const data = await res.json()
      return data.settings as InstagramSettings
    },
  })

  // Update apifyRunLimit when settings are loaded
  useEffect(() => {
    if (settingsData?.apifyResultsLimit) {
      setApifyRunLimit(settingsData.apifyResultsLimit)
    }
  }, [settingsData])

  const {
    isVisible: showScrapeProgress,
    progress: scrapeProgress,
    startTracking: startScrapeProgressTracking,
    jobIds: trackedScrapeJobIds,
  } = useInstagramScrapeProgress()

  const createMutation = useMutation({
    mutationFn: (data: CreateInstagramSourceData) => instagramApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
      toast.success('Instagram source created successfully')
      setShowForm(false)
      resetForm()
    },
    onError: (error) => {
      toast.error(`Failed to create source: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const cancelJobsMutation = useMutation({
    mutationFn: (jobIds: string[]) => instagramApi.cancelJobs(jobIds),
    onSuccess: (data) => {
      const removed = data.results.filter((result) => result.action === 'removed').length
      const cancelRequested = data.results.filter((result) => result.action === 'cancel_requested').length

      if (removed > 0 || cancelRequested > 0) {
        const parts = []
        if (removed > 0) parts.push(`${removed} queued`)
        if (cancelRequested > 0) parts.push(`${cancelRequested} in-progress`)
        toast.success(`Cancellation requested for ${parts.join(' & ')} Instagram jobs`)
      } else {
        toast.info('Instagram scrapes already finished')
      }
    },
    onError: (error) => {
      toast.error(`Failed to cancel Instagram scrapes: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateInstagramSourceData> }) =>
      instagramApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
      toast.success('Instagram source updated successfully')
      setShowForm(false)
      resetForm()
    },
    onError: (error) => {
      toast.error(`Failed to update source: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => instagramApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
      toast.success('Instagram source deleted successfully')
    },
    onError: (error) => {
      toast.error(`Failed to delete source: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const triggerMutation = useMutation({
    mutationFn: (id: string) => instagramApi.trigger(id),
    onSuccess: (data) => {
      const statsSummary = data.stats
        ? [
            data.stats.created ? `${data.stats.created} new` : null,
            data.stats.updated ? `${data.stats.updated} updated` : null,
            data.stats.skippedExisting ? `${data.stats.skippedExisting} skipped` : null,
          ]
            .filter(Boolean)
            .join(', ')
        : ''
      const suffix = statsSummary ? ` (${statsSummary})` : ''
      toast.success(`${data.message || 'Scrape completed'} for @${data.username}${suffix}`)
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
    },
    onError: (error) => {
      toast.error(`Failed to trigger scrape: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const triggerAllActiveMutation = useMutation<TriggerAllResponse, Error, TriggerAllVariables>({
    mutationFn: (options) => instagramApi.triggerAllActive(options),
    onSuccess: (data, variables) => {
      toast.success(`Queued scrape jobs for ${data.accountsQueued} active accounts`)
      if (data.jobs?.length) {
        startScrapeProgressTracking(data.jobs)
      }
      const { accountLimit, postLimit, batchSize } = variables || {}
      lastScrapeOptionsRef.current = {
        accountLimit,
        postsPerAccount: postLimit ?? scrapeOptions.postsPerAccount,
        batchSize: batchSize ?? scrapeOptions.batchSize,
      }
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
    },
    onError: (error) => {
      toast.error(`Failed to trigger scrape: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const uploadSessionMutation = useMutation({
    mutationFn: (data: { username: string; sessionData: { cookies: string; state?: any } }) =>
      instagramApi.uploadSession(data),
    onSuccess: () => {
      toast.success('Instagram session uploaded successfully')
      setShowSessionForm(false)
      setSessionUsername('')
      setSessionData('')
    },
    onError: (error) => {
      toast.error(`Failed to upload session: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const importApifyRunMutation = useMutation({
    mutationFn: ({ runId, limit }: { runId: string; limit: number }) =>
      instagramApifyApi.importRun(runId, limit),
    onSuccess: (data) => {
      toast.success(data.message)
      setApifyRunResult(data.message)
      setApifyRunError(null)
      setApifyRunId('')
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
    },
    onError: (error) => {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      toast.error(`Failed to import Apify run: ${errorMessage}`)
      setApifyRunError(errorMessage)
      setApifyRunResult(null)
    },
  })

  const resetForm = () => {
    setFormData({
      name: '',
      instagramUsername: '',
      classificationMode: 'manual',
      instagramScraperType: 'instagram-private-api',
      active: true,
      defaultTimezone: 'America/Vancouver',
      notes: '',
    })
    setSelectedSource(null)
  }

  const handleAdd = () => {
    resetForm()
    setShowForm(true)
  }

  const handleEdit = (source: InstagramSource) => {
    setSelectedSource(source)
    setFormData({
      name: source.name,
      instagramUsername: source.instagramUsername,
      classificationMode: source.classificationMode,
      instagramScraperType: source.instagramScraperType,
      active: source.active,
      defaultTimezone: source.defaultTimezone,
      notes: source.notes || '',
    })
    setShowForm(true)
  }

  const handleSave = async () => {
    try {
      if (selectedSource) {
        await updateMutation.mutateAsync({ id: selectedSource.id, data: formData })
      } else {
        await createMutation.mutateAsync(formData)
      }
    } catch (error) {
      console.error('Save failed:', error)
    }
  }

  const handleDelete = async (source: InstagramSource) => {
    if (confirm(`Are you sure you want to delete "${source.name}"?`)) {
      await deleteMutation.mutateAsync(source.id)
    }
  }

  const handleTrigger = async (source: InstagramSource) => {
    try {
      await triggerMutation.mutateAsync(source.id)
    } catch (error) {
      console.error('Trigger failed:', error)
    }
  }

  const handleTriggerAllActive = () => {
    if (activeSources === 0) {
      toast.error('No active Instagram accounts to scrape')
      return
    }
    const previous = lastScrapeOptionsRef.current
    // Use settings default if available, otherwise fall back to hardcoded default
    const settingsDefaultPostLimit = settingsData?.apifyResultsLimit ?? 10

    const initialAccountLimit =
      previous?.accountLimit && previous.accountLimit > 0
        ? Math.min(previous.accountLimit, activeSources)
        : activeSources
    setScrapeOptions({
      accountLimit: initialAccountLimit,
      postsPerAccount:
        previous?.postsPerAccount && previous.postsPerAccount > 0
          ? previous.postsPerAccount
          : settingsDefaultPostLimit,
      batchSize: previous?.batchSize && previous.batchSize > 0 ? previous.batchSize : 8,
    })
    setConfirmScrapeAllOpen(true)
  }

  const handleCancelScrapeJobs = () => {
    if (!trackedScrapeJobIds.length || cancelJobsMutation.isPending) {
      return
    }
    cancelJobsMutation.mutate(trackedScrapeJobIds)
  }

  const handleConfirmScrapeAll = async () => {
    const normalizedPostLimit = Math.min(Math.max(Math.round(scrapeOptions.postsPerAccount || 10), 1), 100)
    const normalizedBatchSize = Math.min(Math.max(Math.round(scrapeOptions.batchSize || 8), 1), 25)
    const accountLimitValue = Math.round(scrapeOptions.accountLimit || 0)
    const normalizedAccountLimit =
      accountLimitValue > 0 ? Math.min(accountLimitValue, activeSources) : undefined

    try {
      await triggerAllActiveMutation.mutateAsync({
        postLimit: normalizedPostLimit,
        accountLimit: normalizedAccountLimit,
        batchSize: normalizedBatchSize,
      })
      setConfirmScrapeAllOpen(false)
    } catch (error) {
      console.error('Trigger all failed:', error)
    }
  }

  const handleUploadSession = async () => {
    try {
      const parsedSession = JSON.parse(sessionData)
      await uploadSessionMutation.mutateAsync({
        username: sessionUsername,
        sessionData: parsedSession,
      })
    } catch (error) {
      toast.error('Invalid session JSON format')
    }
  }

  const handleImportApifyRun = async () => {
    const runId = apifyRunId.trim()
    if (!runId) {
      setApifyRunError('Please enter an Apify run ID')
      return
    }

    const normalizedLimit = Math.min(Math.max(Math.round(apifyRunLimit), 1), 100)
    setApifyRunLimit(normalizedLimit)
    setApifyRunError(null)
    setApifyRunResult(null)

    try {
      await importApifyRunMutation.mutateAsync({ runId, limit: normalizedLimit })
    } catch (error) {
      console.error('Import Apify run failed:', error)
    }
  }

  const totalSources = sourcesList.length
  const activeSources = sourcesList.filter((s) => s.active).length
  const inactiveSources = totalSources - activeSources

  const filteredSources = useMemo(() => {
    return (
      sourcesList.filter((source) => {
        if (activeTab === 'active') return source.active
        if (activeTab === 'inactive') return !source.active
        return true
      }) || []
    )
  }, [sourcesList, activeTab])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Instagram Sources</h1>
        <p className="text-muted-foreground">Manage Instagram accounts for event scraping</p>
      </div>

      {totalSources > 0 && (
        <InstagramSourcesStatsCard
          totalSources={totalSources}
          activeSources={activeSources}
          inactiveSources={inactiveSources}
        />
      )}

      <InstagramApifyRunCard
        runId={apifyRunId}
        onRunIdChange={setApifyRunId}
        postLimit={apifyRunLimit}
        onPostLimitChange={setApifyRunLimit}
        onImport={handleImportApifyRun}
        isImporting={importApifyRunMutation.isPending}
        successMessage={apifyRunResult}
        errorMessage={apifyRunError}
      />

      <InstagramAccountsActionsCard
        activeSources={activeSources}
        settingsHref="/instagram/settings"
        onUploadSession={() => setShowSessionForm(true)}
        onTriggerAll={handleTriggerAllActive}
        onAddSource={handleAdd}
        triggerAllPending={triggerAllActiveMutation.isPending}
        showScrapeProgress={showScrapeProgress}
        scrapeProgress={showScrapeProgress ? scrapeProgress : undefined}
        onCancelScrape={trackedScrapeJobIds.length > 0 ? handleCancelScrapeJobs : undefined}
        isCancelling={cancelJobsMutation.isPending}
      />

      <InstagramSourcesTableCard
        isLoading={isLoading}
        sources={sourcesList}
        filteredSources={filteredSources}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        activeSources={activeSources}
        inactiveSources={inactiveSources}
        totalSources={totalSources}
        onEdit={handleEdit}
        onTrigger={handleTrigger}
        onDelete={handleDelete}
        triggerPending={triggerMutation.isPending}
      />

      <InstagramInfoCard />

      <InstagramSourceFormDialog
        open={showForm}
        onOpenChange={setShowForm}
        formData={formData}
        setFormData={setFormData}
        selectedSource={selectedSource}
        onSubmit={handleSave}
        isSubmitting={createMutation.isPending || updateMutation.isPending}
        settings={settingsData}
      />

      <InstagramSessionUploadDialog
        open={showSessionForm}
        onOpenChange={setShowSessionForm}
        sessionUsername={sessionUsername}
        sessionData={sessionData}
        onSessionUsernameChange={setSessionUsername}
        onSessionDataChange={setSessionData}
        onUpload={handleUploadSession}
        isUploading={uploadSessionMutation.isPending}
      />

      <InstagramScrapeAllDialog
        open={confirmScrapeAllOpen}
        onOpenChange={setConfirmScrapeAllOpen}
        activeSources={activeSources}
        scrapeOptions={scrapeOptions}
        onScrapeOptionsChange={setScrapeOptions}
        activeAccountPreview={activeAccountPreview}
        onConfirm={handleConfirmScrapeAll}
        isConfirming={triggerAllActiveMutation.isPending}
      />
    </div>
  )
}
