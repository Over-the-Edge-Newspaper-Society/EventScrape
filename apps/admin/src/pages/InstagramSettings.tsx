import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL } from '@/lib/api'
import { toast } from 'sonner'
import { ApiKeysSection } from '@/components/instagram-settings/ApiKeysSection'
import { AiPromptSection } from '@/components/instagram-settings/AiPromptSection'
import { GlobalScraperSection } from '@/components/instagram-settings/GlobalScraperSection'
import { ScrapingConfigSection } from '@/components/instagram-settings/ScrapingConfigSection'
import { GeminiSettingsSection } from '@/components/instagram-settings/GeminiSettingsSection'
import { BulkImportSection } from '@/components/instagram-settings/BulkImportSection'
import { BackupTransferSection } from '@/components/instagram-settings/BackupTransferSection'

export interface InstagramSettings {
  id: string
  apifyActorId: string
  apifyResultsLimit: number
  fetchDelayMinutes: number
  autoExtractNewPosts: boolean
  autoClassifyWithAi: boolean
  geminiPrompt: string | null
  hasApifyToken: boolean
  hasGeminiKey: boolean
  defaultScraperType: 'apify' | 'instagram-private-api'
  allowPerAccountOverride: boolean
  createdAt: string
  updatedAt: string
}

interface BackupFile {
  filename: string
  size: number
  createdAt: string
}

export function InstagramSettings() {
  const queryClient = useQueryClient()

  // API Key states
  const [apifyToken, setApifyToken] = useState('')
  const [geminiKey, setGeminiKey] = useState('')

  // Settings states - initialize with empty/undefined to avoid controlled/uncontrolled warnings
  const [apifyActorId, setApifyActorId] = useState('')
  const [apifyResultsLimit, setApifyResultsLimit] = useState<number | undefined>(undefined)
  const [fetchDelayMinutes, setFetchDelayMinutes] = useState<number | undefined>(undefined)
  const [autoExtractNewPosts, setAutoExtractNewPosts] = useState(false)
  const [autoClassifyWithAi, setAutoClassifyWithAi] = useState(false)
  const [geminiPrompt, setGeminiPrompt] = useState('')
  const [defaultScraperType, setDefaultScraperType] = useState<'apify' | 'instagram-private-api' | undefined>(undefined)
  const [allowPerAccountOverride, setAllowPerAccountOverride] = useState<boolean | undefined>(undefined)

  // File upload states
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [backupFile, setBackupFile] = useState<File | null>(null)
  const [sqliteFile, setSqliteFile] = useState<File | null>(null)

  // Fetch settings
  const { data: settings, isLoading } = useQuery({
    queryKey: ['instagram-settings'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-settings`)
      const data = await res.json()
      return data.settings as InstagramSettings
    },
  })

  // Update form state when settings are loaded
  useEffect(() => {
    if (settings) {
      setApifyActorId(settings.apifyActorId || '')
      setApifyResultsLimit(settings.apifyResultsLimit)
      setFetchDelayMinutes(settings.fetchDelayMinutes)
      setAutoExtractNewPosts(settings.autoExtractNewPosts ?? false)
      setAutoClassifyWithAi(settings.autoClassifyWithAi ?? false)
      setGeminiPrompt(settings.geminiPrompt || '')
      setDefaultScraperType(settings.defaultScraperType || 'instagram-private-api')
      setAllowPerAccountOverride(settings.allowPerAccountOverride ?? true)
    }
  }, [settings])

  // Fetch backups list
  const { data: backups } = useQuery({
    queryKey: ['backups'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-backup/list`)
      const data = await res.json()
      return data.backups as BackupFile[]
    },
  })

  // Update settings mutation
  const updateSettings = useMutation({
    mutationFn: async (data: Partial<InstagramSettings> & { apifyApiToken?: string; geminiApiKey?: string }) => {
      const res = await fetch(`${API_BASE_URL}/instagram-settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-settings'] })
      toast.success('Settings updated successfully')
      setApifyToken('')
      setGeminiKey('')
    },
    onError: () => {
      toast.error('Failed to update settings')
    },
  })

  // Remove token mutations
  const removeApifyToken = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-settings/apify-token`, {
        method: 'DELETE',
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-settings'] })
      toast.success('Apify token removed')
    },
  })

  const removeGeminiKey = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-settings/gemini-key`, {
        method: 'DELETE',
      })
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instagram-settings'] })
      toast.success('Gemini key removed')
    },
  })

  // CSV import mutation
  const importCsv = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${API_BASE_URL}/instagram-sources/bulk-import`, {
        method: 'POST',
        body: formData,
      })
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
      toast.success(`Imported ${data.created} sources, skipped ${data.skipped}`)
      setCsvFile(null)
    },
    onError: () => {
      toast.error('Failed to import CSV')
    },
  })

  // Backup mutations
  const createBackup = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-backup/create`, {
        method: 'POST',
      })
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      toast.success(`Backup created: ${data.filename}`)
      // Automatically download the created backup
      handleDownloadBackup(data.filename)
    },
    onError: () => {
      toast.error('Failed to create backup')
    },
  })

  const restoreBackup = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${API_BASE_URL}/instagram-backup/restore`, {
        method: 'POST',
        body: formData,
      })
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      const updated = (data.accountsUpdated || 0) + (data.sourcesUpdated || 0) + (data.eventsUpdated || 0)
      toast.success(`Restored ${data.accountsCreated || 0} accounts, ${data.eventsCreated} events${updated > 0 ? ` (${updated} updated)` : ''}`)
      setBackupFile(null)
    },
    onError: () => {
      toast.error('Failed to restore backup')
    },
  })

  const importSqlite = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${API_BASE_URL}/instagram-backup/import-sqlite`, {
        method: 'POST',
        body: formData,
      })
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
      toast.success(`Imported ${data.clubsImported} clubs from SQLite`)
      setSqliteFile(null)
    },
    onError: () => {
      toast.error('Failed to import SQLite database')
    },
  })

  const deleteBackup = useMutation({
    mutationFn: async (filename: string) => {
      const res = await fetch(`${API_BASE_URL}/instagram-backup/delete/${filename}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete backup')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      toast.success('Backup deleted successfully')
    },
    onError: () => {
      toast.error('Failed to delete backup')
    },
  })

  const classifyBacklog = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-classify/backlog`, {
        method: 'POST',
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to classify backlog')
      }
      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['events-raw'] })
      toast.success(`Classified ${data.processed} posts from backlog`)
    },
    onError: (error: Error) => {
      toast.error(`Classification failed: ${error.message}`)
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
    if (confirm('This will classify all unclassified posts in the backlog. Continue?')) {
      classifyBacklog.mutate()
    }
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

  const handleRestoreBackup = () => {
    if (!backupFile) {
      toast.error('Please select a backup file')
      return
    }
    restoreBackup.mutate(backupFile)
  }

  const handleImportSqlite = () => {
    if (!sqliteFile) {
      toast.error('Please select a SQLite database file')
      return
    }
    importSqlite.mutate(sqliteFile)
  }

  const handleDownloadBackup = (filename: string) => {
    window.open(`${API_BASE_URL}/instagram-backup/download/${filename}`, '_blank')
  }

  const handleDeleteBackup = (filename: string) => {
    if (confirm(`Are you sure you want to delete ${filename}?`)) {
      deleteBackup.mutate(filename)
    }
  }

  if (isLoading) {
    return <div className="p-6">Loading settings...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Instagram Settings</h1>
        <p className="text-muted-foreground">
          Configure API keys, scraping settings, and manage backups
        </p>
      </div>

      <ApiKeysSection
        settings={settings}
        apifyToken={apifyToken}
        setApifyToken={setApifyToken}
        geminiKey={geminiKey}
        setGeminiKey={setGeminiKey}
        handleSaveApifyToken={handleSaveApifyToken}
        handleSaveGeminiKey={handleSaveGeminiKey}
        updateSettingsPending={updateSettings.isPending}
        removeApifyToken={() => removeApifyToken.mutate()}
        removeApifyTokenPending={removeApifyToken.isPending}
        removeGeminiKey={() => removeGeminiKey.mutate()}
        removeGeminiKeyPending={removeGeminiKey.isPending}
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

      <BackupTransferSection
        backups={backups}
        backupFile={backupFile}
        setBackupFile={setBackupFile}
        sqliteFile={sqliteFile}
        setSqliteFile={setSqliteFile}
        createBackupPending={createBackup.isPending}
        createBackup={() => createBackup.mutate()}
        handleRestoreBackup={handleRestoreBackup}
        restoreBackupPending={restoreBackup.isPending}
        handleImportSqlite={handleImportSqlite}
        importSqlitePending={importSqlite.isPending}
        handleDownloadBackup={handleDownloadBackup}
        handleDeleteBackup={handleDeleteBackup}
        deleteBackupPending={deleteBackup.isPending}
      />
    </div>
  )
}
