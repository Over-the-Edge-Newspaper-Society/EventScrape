import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { API_BASE_URL } from '@/lib/api'
import { toast } from 'sonner'
import {
  Key,
  Save,
  Trash2,
  Upload,
  Download,
  Database,
  Settings as SettingsIcon,
  CheckCircle,
  Info,
  Globe
} from 'lucide-react'

interface InstagramSettings {
  id: string
  apifyActorId: string
  apifyResultsLimit: number
  fetchDelayMinutes: number
  autoExtractNewPosts: boolean
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
      autoExtractNewPosts,
    })
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

      {/* API Keys Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Keys
          </CardTitle>
          <CardDescription>
            Store API keys for Apify and Gemini services
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Apify Token */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="apify-token">Apify Personal API Token</Label>
              {settings?.hasApifyToken && (
                <Badge variant="default" className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Token saved
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                id="apify-token"
                type="password"
                placeholder="apify_api_..."
                value={apifyToken}
                onChange={(e) => setApifyToken(e.target.value)}
              />
              <Button onClick={handleSaveApifyToken} disabled={updateSettings.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
              {settings?.hasApifyToken && (
                <Button
                  variant="outline"
                  onClick={() => removeApifyToken.mutate()}
                  disabled={removeApifyToken.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Get your token from{' '}
              <a
                href="https://console.apify.com/account/integrations"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Apify Console → Integrations → Personal API tokens
              </a>
            </p>
          </div>

          <Separator />

          {/* Gemini Key */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="gemini-key">Gemini API Key</Label>
              {settings?.hasGeminiKey && (
                <Badge variant="default" className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3" />
                  Key saved
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Input
                id="gemini-key"
                type="password"
                placeholder="AI..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
              />
              <Button onClick={handleSaveGeminiKey} disabled={updateSettings.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
              {settings?.hasGeminiKey && (
                <Button
                  variant="outline"
                  onClick={() => removeGeminiKey.mutate()}
                  disabled={removeGeminiKey.isPending}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Get your key from{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                Google AI Studio
              </a>
            </p>
          </div>
        </CardContent>
      </Card>

      {/* AI Extraction Prompt */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            AI Extraction Prompt
          </CardTitle>
          <CardDescription>
            Customize the prompt used by Gemini to extract event data from Instagram images
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gemini-prompt">Gemini Extraction Prompt</Label>
            <Textarea
              id="gemini-prompt"
              value={geminiPrompt}
              onChange={(e) => setGeminiPrompt(e.target.value)}
              placeholder="Enter the AI prompt for event extraction..."
              className="min-h-[300px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              This prompt instructs the AI how to extract event information from poster images.
              Leave empty to use the default prompt.
            </p>
          </div>

          <Button onClick={handleSavePrompt} disabled={updateSettings.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Save Prompt
          </Button>
        </CardContent>
      </Card>

      {/* Global Scraper Backend Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Global Scraper Backend
          </CardTitle>
          <CardDescription>
            Configure the default scraper backend for all Instagram accounts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="default-scraper-type">Default Scraper Backend</Label>
            <Select
              value={defaultScraperType || 'instagram-private-api'}
              onValueChange={(value: 'apify' | 'instagram-private-api') => setDefaultScraperType(value)}
            >
              <SelectTrigger id="default-scraper-type">
                <SelectValue placeholder="Select scraper backend" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="instagram-private-api">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">instagram-private-api</span>
                    <span className="text-xs text-muted-foreground">Free, requires session</span>
                  </div>
                </SelectItem>
                <SelectItem value="apify">
                  <div className="flex flex-col items-start">
                    <span className="font-medium">Apify</span>
                    <span className="text-xs text-muted-foreground">Paid, reliable official API</span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              This setting will apply to all Instagram accounts by default
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="allow-override">Allow Per-Account Override</Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, accounts can override the global setting
                </p>
              </div>
              <Switch
                id="allow-override"
                checked={allowPerAccountOverride ?? true}
                onCheckedChange={setAllowPerAccountOverride}
              />
            </div>
          </div>

          <Button onClick={handleSaveGlobalScraperSettings} disabled={updateSettings.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Save Global Scraper Settings
          </Button>
        </CardContent>
      </Card>

      {/* Scraping Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Scraping Configuration
          </CardTitle>
          <CardDescription>
            Configure Apify scraper and automation settings
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="actor-id">Apify Actor ID</Label>
              <Input
                id="actor-id"
                value={apifyActorId}
                onChange={(e) => setApifyActorId(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Default: apify/instagram-profile-scraper
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="results-limit">Results Limit per Source</Label>
              <Input
                id="results-limit"
                type="number"
                min="1"
                max="100"
                value={apifyResultsLimit}
                onChange={(e) => setApifyResultsLimit(parseInt(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                How many posts to fetch from Apify
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="fetch-delay">Fetch Delay (minutes)</Label>
              <Input
                id="fetch-delay"
                type="number"
                min="1"
                max="60"
                value={fetchDelayMinutes}
                onChange={(e) => setFetchDelayMinutes(parseInt(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Delay between scraping each source
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="auto-extract" className="flex items-center gap-2">
                Auto-Extract New Posts
                <Info className="h-4 w-4 text-muted-foreground" />
              </Label>
              <Switch
                id="auto-extract"
                checked={autoExtractNewPosts}
                onCheckedChange={setAutoExtractNewPosts}
              />
              <p className="text-xs text-muted-foreground">
                Automatically extract events from new posts using Gemini
              </p>
            </div>
          </div>

          <Button onClick={handleSaveSettings} disabled={updateSettings.isPending}>
            <Save className="h-4 w-4 mr-2" />
            Save Configuration
          </Button>
        </CardContent>
      </Card>

      {/* CSV Bulk Import */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Bulk Import from CSV
          </CardTitle>
          <CardDescription>
            Upload a CSV file to import multiple Instagram sources at once
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              CSV must include columns: <strong>name</strong>, <strong>username</strong>.
              Optional: <strong>active</strong>, <strong>classification_mode</strong>
            </AlertDescription>
          </Alert>

          <div className="space-y-2">
            <Label htmlFor="csv-file">Select CSV File</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            />
          </div>

          <Button
            onClick={handleCsvUpload}
            disabled={!csvFile || importCsv.isPending}
          >
            <Upload className="h-4 w-4 mr-2" />
            {importCsv.isPending ? 'Importing...' : 'Import CSV'}
          </Button>
        </CardContent>
      </Card>

      {/* Backup & Restore */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Backup & Transfer
          </CardTitle>
          <CardDescription>
            Create backups or restore from previous backups
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Create & Download Backup Section */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Create New Backup</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Creates and downloads a ZIP file with database data and cached Instagram images
              </p>
              <Button
                onClick={() => createBackup.mutate()}
                disabled={createBackup.isPending}
                className="w-full sm:w-auto"
              >
                <Download className="h-4 w-4 mr-2" />
                {createBackup.isPending ? 'Creating Backup...' : 'Create & Download Backup'}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Restore Section */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Restore from Backup</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Upload a backup ZIP file to restore Instagram data
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="backup-file"
                type="file"
                accept=".zip"
                onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
                className="flex-1"
              />
              <Button
                onClick={handleRestoreBackup}
                disabled={!backupFile || restoreBackup.isPending}
                variant="outline"
                className="w-full sm:w-auto"
              >
                <Upload className="h-4 w-4 mr-2" />
                {restoreBackup.isPending ? 'Restoring...' : 'Restore Backup'}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Import from Old System Section */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Import from Old Event-Monitor</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Import clubs and images from old Event-Monitor backup (ZIP) or SQLite database file
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                id="sqlite-file"
                type="file"
                accept=".db,.sqlite,.sqlite3,.zip"
                onChange={(e) => setSqliteFile(e.target.files?.[0] || null)}
                className="flex-1"
              />
              <Button
                onClick={handleImportSqlite}
                disabled={!sqliteFile || importSqlite.isPending}
                variant="outline"
                className="w-full sm:w-auto"
              >
                <Database className="h-4 w-4 mr-2" />
                {importSqlite.isPending ? 'Importing...' : 'Import Data'}
              </Button>
            </div>
          </div>

          <Separator />

          {/* Available Backups Section */}
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold mb-2">Available Backups</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Download or delete previously created backups
              </p>
            </div>
            {backups && backups.length > 0 ? (
              <div className="space-y-2">
                {backups.map((backup) => (
                  <div
                    key={backup.filename}
                    className="flex items-center justify-between p-3 border rounded-lg bg-muted/50"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{backup.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {(backup.size / 1024 / 1024).toFixed(2)} MB • Created {new Date(backup.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownloadBackup(backup.filename)}
                        title="Download backup"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteBackup(backup.filename)}
                        disabled={deleteBackup.isPending}
                        className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                        title="Delete backup"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 border rounded-lg bg-muted/30">
                <Database className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No backups available</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Create your first backup to get started
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
