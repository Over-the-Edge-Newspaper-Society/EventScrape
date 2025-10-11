import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
  Info
} from 'lucide-react'

interface InstagramSettings {
  id: string
  apifyActorId: string
  apifyResultsLimit: number
  fetchDelayMinutes: number
  autoExtractNewPosts: boolean
  hasApifyToken: boolean
  hasGeminiKey: boolean
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

  // Settings states
  const [apifyActorId, setApifyActorId] = useState('apify/instagram-profile-scraper')
  const [apifyResultsLimit, setApifyResultsLimit] = useState(10)
  const [fetchDelayMinutes, setFetchDelayMinutes] = useState(5)
  const [autoExtractNewPosts, setAutoExtractNewPosts] = useState(false)

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
      setApifyActorId(settings.apifyActorId)
      setApifyResultsLimit(settings.apifyResultsLimit)
      setFetchDelayMinutes(settings.fetchDelayMinutes)
      setAutoExtractNewPosts(settings.autoExtractNewPosts)
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
      toast.success(`Restored ${data.sourcesCreated} sources, ${data.eventsCreated} events`)
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
          {/* Create Backup */}
          <div className="space-y-2">
            <Label>Create New Backup</Label>
            <Button
              onClick={() => createBackup.mutate()}
              disabled={createBackup.isPending}
            >
              <Download className="h-4 w-4 mr-2" />
              {createBackup.isPending ? 'Creating...' : 'Download Backup ZIP'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Includes database data and cached Instagram images
            </p>
          </div>

          <Separator />

          {/* Restore from Backup */}
          <div className="space-y-2">
            <Label htmlFor="backup-file">Restore from Backup ZIP</Label>
            <Input
              id="backup-file"
              type="file"
              accept=".zip"
              onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
            />
            <Button
              onClick={handleRestoreBackup}
              disabled={!backupFile || restoreBackup.isPending}
              variant="outline"
            >
              <Upload className="h-4 w-4 mr-2" />
              {restoreBackup.isPending ? 'Restoring...' : 'Restore Backup'}
            </Button>
          </div>

          <Separator />

          {/* Import Old SQLite */}
          <div className="space-y-2">
            <Label htmlFor="sqlite-file">Import from Old Event-Monitor</Label>
            <Input
              id="sqlite-file"
              type="file"
              accept=".db,.sqlite,.sqlite3,.zip"
              onChange={(e) => setSqliteFile(e.target.files?.[0] || null)}
            />
            <Button
              onClick={handleImportSqlite}
              disabled={!sqliteFile || importSqlite.isPending}
              variant="outline"
            >
              <Database className="h-4 w-4 mr-2" />
              {importSqlite.isPending ? 'Importing...' : 'Import from Event-Monitor'}
            </Button>
            <p className="text-xs text-muted-foreground">
              Import clubs and images from old Event-Monitor backup (ZIP) or SQLite database file
            </p>
          </div>

          <Separator />

          {/* Available Backups */}
          <div className="space-y-2">
            <Label>Available Backups</Label>
            {backups && backups.length > 0 ? (
              <div className="space-y-2">
                {backups.map((backup) => (
                  <div
                    key={backup.filename}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div>
                      <p className="text-sm font-medium">{backup.filename}</p>
                      <p className="text-xs text-muted-foreground">
                        {(backup.size / 1024 / 1024).toFixed(2)} MB •{' '}
                        {new Date(backup.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadBackup(backup.filename)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No backups available</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
