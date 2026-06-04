import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { runQuery, runMutation } from '@/lib/convexClient'
import { toast } from 'sonner'
import { ApiKeysSection } from '@/components/instagram-settings/ApiKeysSection'
import { AiPromptSection } from '@/components/instagram-settings/AiPromptSection'
import { GlobalScraperSection } from '@/components/instagram-settings/GlobalScraperSection'
import { ScrapingConfigSection } from '@/components/instagram-settings/ScrapingConfigSection'
import { GeminiSettingsSection } from '@/components/instagram-settings/GeminiSettingsSection'
import { BulkImportSection } from '@/components/instagram-settings/BulkImportSection'

export interface InstagramSettings {
  id: string
  apifyActorId: string
  apifyResultsLimit: number
  fetchDelayMinutes: number
  autoExtractNewPosts: boolean
  autoClassifyWithAi: boolean
  aiProvider: 'gemini' | 'claude'
  geminiPrompt: string | null
  claudePrompt: string | null
  hasApifyToken: boolean
  hasGeminiKey: boolean
  hasClaudeKey: boolean
  defaultScraperType: 'apify' | 'instagram-private-api'
  allowPerAccountOverride: boolean
  createdAt: string
  updatedAt: string
}

export function InstagramSettings() {
  const queryClient = useQueryClient()

  // API Key states
  const [apifyToken, setApifyToken] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [claudeKey, setClaudeKey] = useState('')

  // Settings states - initialize with empty/undefined to avoid controlled/uncontrolled warnings
  const [aiProvider, setAiProvider] = useState<'gemini' | 'claude'>('gemini')
  const [apifyActorId, setApifyActorId] = useState('')
  const [apifyResultsLimit, setApifyResultsLimit] = useState<number | undefined>(undefined)
  const [fetchDelayMinutes, setFetchDelayMinutes] = useState<number | undefined>(undefined)
  const [autoExtractNewPosts, setAutoExtractNewPosts] = useState(false)
  const [autoClassifyWithAi, setAutoClassifyWithAi] = useState(false)
  const [geminiPrompt, setGeminiPrompt] = useState('')
  const [_claudePrompt, setClaudePrompt] = useState('')
  const [defaultScraperType, setDefaultScraperType] = useState<'apify' | 'instagram-private-api' | undefined>(undefined)
  const [allowPerAccountOverride, setAllowPerAccountOverride] = useState<boolean | undefined>(undefined)

  // File upload states
  const [csvFile, setCsvFile] = useState<File | null>(null)

  // Fetch settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['instagram-settings'],
    queryFn: async () => {
      const data = await runQuery<{ settings: InstagramSettings } | null>('instagramSettings:get', {})
      return (data?.settings ?? null) as InstagramSettings
    },
  })

  // Update form state when settings are loaded
  useEffect(() => {
    if (settings) {
      setAiProvider(settings.aiProvider || 'gemini')
      setApifyActorId(settings.apifyActorId || '')
      setApifyResultsLimit(settings.apifyResultsLimit)
      setFetchDelayMinutes(settings.fetchDelayMinutes)
      setAutoExtractNewPosts(settings.autoExtractNewPosts ?? false)
      setAutoClassifyWithAi(settings.autoClassifyWithAi ?? false)
      setGeminiPrompt(settings.geminiPrompt || '')
      setClaudePrompt(settings.claudePrompt || '')
      setDefaultScraperType(settings.defaultScraperType || 'instagram-private-api')
      setAllowPerAccountOverride(settings.allowPerAccountOverride ?? true)
    }
  }, [settings])

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (data: Partial<InstagramSettings> & { apifyApiToken?: string; geminiApiKey?: string; claudeApiKey?: string }) => {
      return runMutation('instagramSettings:update', data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-settings'] })
      toast.success('Settings updated successfully')
      setApifyToken('')
      setGeminiKey('')
      setClaudeKey('')
    },
    onError: () => {
      toast.error('Failed to update settings')
    },
  })

  // Remove token mutations
  const removeApifyToken = useMutation({
    mutationFn: async () => {
      return runMutation('instagramSettings:clearApifyToken', {})
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-settings'] })
      toast.success('Apify token removed')
    },
  })

  const removeGeminiKey = useMutation({
    mutationFn: async () => {
      return runMutation('instagramSettings:clearGeminiKey', {})
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-settings'] })
      toast.success('Gemini key removed')
    },
  })

  const removeClaudeKey = useMutation({
    mutationFn: async () => {
      return runMutation('instagramSettings:clearClaudeKey', {})
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-settings'] })
      toast.success('Claude key removed')
    },
  })

  // CSV import mutation
  const importCsv = useMutation({
    mutationFn: async (_file: File) => {
      // CSV bulk import runs in the worker (actions phase). No REST endpoint.
      throw new Error('Bulk import runs in the worker (actions phase pending)')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })


  const classifyBacklog = useMutation({
    mutationFn: async () => {
      // AI backlog classification runs in the worker (actions phase). No REST endpoint.
      throw new Error('Classification runs in the worker (actions phase pending)')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSaveApifyToken = () => {
    if (!apifyToken) {
      toast.error('Please enter an Apify API token')
      return
    }
    updateSettings.mutate({ apifyApiToken: apifyToken })
  }

  const handleSaveGeminiKey = () => {
    if (!geminiKey) {
      toast.error('Please enter a Gemini API key')
      return
    }
    updateSettings.mutate({ geminiApiKey: geminiKey })
  }

  const handleSaveClaudeKey = () => {
    if (!claudeKey) {
      toast.error('Please enter a Claude API key')
      return
    }
    updateSettings.mutate({ claudeApiKey: claudeKey })
  }

  const handleSaveAiProvider = (newProvider: 'gemini' | 'claude') => {
    updateSettings.mutate({ aiProvider: newProvider })
  }

  const handleSaveSettings = () => {
    updateSettings.mutate({
      apifyActorId,
      apifyResultsLimit,
      fetchDelayMinutes,
    })
  }

  const handleSaveGeminiSettings = () => {
    updateSettings.mutate({
      autoExtractNewPosts,
      autoClassifyWithAi,
    })
  }

  const handleClassifyBacklog = () => {
    classifyBacklog.mutate()
  }

  const handleSaveGlobalScraperSettings = () => {
    updateSettings.mutate({
      defaultScraperType,
      allowPerAccountOverride,
    })
  }

  const handleSavePrompt = () => {
    if (!geminiPrompt || geminiPrompt.trim() === '') {
      toast.error('Prompt cannot be empty')
      return
    }
    updateSettings.mutate({
      geminiPrompt,
    })
  }

  const handleCsvUpload = () => {
    if (!csvFile) {
      toast.error('Please select a CSV file')
      return
    }
    importCsv.mutate(csvFile)
  }

  if (isLoading) {
    return <div className="p-6">Loading settings...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Instagram Settings</h1>
        <p className="text-muted-foreground">
          Configure API keys, scraping settings, and Instagram automation
        </p>
      </div>

      <ApiKeysSection
        settings={settings}
        apifyToken={apifyToken}
        setApifyToken={setApifyToken}
        geminiKey={geminiKey}
        setGeminiKey={setGeminiKey}
        claudeKey={claudeKey}
        setClaudeKey={setClaudeKey}
        aiProvider={aiProvider}
        setAiProvider={setAiProvider}
        handleSaveApifyToken={handleSaveApifyToken}
        handleSaveGeminiKey={handleSaveGeminiKey}
        handleSaveClaudeKey={handleSaveClaudeKey}
        handleSaveAiProvider={handleSaveAiProvider}
        updateSettingsPending={updateSettings.isPending}
        removeApifyToken={() => removeApifyToken.mutate()}
        removeApifyTokenPending={removeApifyToken.isPending}
        removeGeminiKey={() => removeGeminiKey.mutate()}
        removeGeminiKeyPending={removeGeminiKey.isPending}
        removeClaudeKey={() => removeClaudeKey.mutate()}
        removeClaudeKeyPending={removeClaudeKey.isPending}
      />

      <AiPromptSection
        geminiPrompt={geminiPrompt}
        setGeminiPrompt={setGeminiPrompt}
        handleSavePrompt={handleSavePrompt}
        updateSettingsPending={updateSettings.isPending}
      />

      <GlobalScraperSection
        defaultScraperType={defaultScraperType}
        setDefaultScraperType={setDefaultScraperType}
        allowPerAccountOverride={allowPerAccountOverride}
        setAllowPerAccountOverride={setAllowPerAccountOverride}
        handleSaveGlobalScraperSettings={handleSaveGlobalScraperSettings}
        updateSettingsPending={updateSettings.isPending}
      />

      <ScrapingConfigSection
        apifyActorId={apifyActorId}
        setApifyActorId={setApifyActorId}
        apifyResultsLimit={apifyResultsLimit}
        setApifyResultsLimit={setApifyResultsLimit}
        fetchDelayMinutes={fetchDelayMinutes}
        setFetchDelayMinutes={setFetchDelayMinutes}
        handleSaveSettings={handleSaveSettings}
        updateSettingsPending={updateSettings.isPending}
      />

      <GeminiSettingsSection
        autoExtractNewPosts={autoExtractNewPosts}
        setAutoExtractNewPosts={setAutoExtractNewPosts}
        autoClassifyWithAi={autoClassifyWithAi}
        setAutoClassifyWithAi={setAutoClassifyWithAi}
        handleSaveSettings={handleSaveGeminiSettings}
        handleClassifyBacklog={handleClassifyBacklog}
        updateSettingsPending={updateSettings.isPending}
        classifyBacklogPending={classifyBacklog.isPending}
      />

      <BulkImportSection
        csvFile={csvFile}
        setCsvFile={setCsvFile}
        handleCsvUpload={handleCsvUpload}
        importCsvPending={importCsv.isPending}
      />
    </div>
  )
}
