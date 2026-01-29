import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, Upload, Trash2, HardDrive, Database, Image, Sliders, Eraser } from 'lucide-react'
import { API_BASE_URL, systemSettingsApi } from '@/lib/api'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

interface BackupBundleManifest {
  createdAt: string
  includeDatabase: boolean
  includeInstagramData: boolean
  includeImages: boolean
  counts?: {
    instagramSources?: number
    instagramAccounts?: number
    instagramSessions?: number
    instagramEvents?: number
    instagramImages?: number
  }
}

interface BackupBundle {
  filename: string
  size: number
  createdAt: string
  manifest?: BackupBundleManifest | null
}

export function Settings() {
  const queryClient = useQueryClient()

  const [exportIncludeDatabase, setExportIncludeDatabase] = useState(true)
  const [exportIncludeInstagramData, setExportIncludeInstagramData] = useState(false)
  const [exportIncludeImages, setExportIncludeImages] = useState(false)

  const [importFile, setImportFile] = useState<File | null>(null)
  const [applyDatabase, setApplyDatabase] = useState(false)
  const [applyInstagramData, setApplyInstagramData] = useState(false)
  const [applyImages, setApplyImages] = useState(false)

  const [aiProvider, setAiProvider] = useState<'gemini' | 'claude'>('gemini')
  const [geminiKey, setGeminiKey] = useState('')
  const [claudeKey, setClaudeKey] = useState('')

  const { data: systemSettings, isLoading: isLoadingSystemSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.get(),
  })

  const { data: backupsData, isLoading: isLoadingBackups } = useQuery({
    queryKey: ['backupBundles'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/backups/list`)
      if (!res.ok) {
        throw new Error('Failed to fetch backup bundles')
      }
      const payload = await res.json() as { backups: BackupBundle[] }
      return payload.backups ?? []
    },
  })

  const exportMutation = useMutation({
    mutationFn: async (options: {
      includeDatabase: boolean
      includeInstagramData: boolean
      includeImages: boolean
    }) => {
      const res = await fetch(`${API_BASE_URL}/backups/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(options),
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to create backup bundle')
      }

      return res.json() as Promise<{ filename: string }>
    },
    onSuccess: (data) => {
      toast.success('Backup bundle created successfully')
      queryClient.invalidateQueries({ queryKey: ['backupBundles'] })
      if (data.filename) {
        window.open(`${API_BASE_URL}/backups/download/${data.filename}`, '_blank')
      }
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const importMutation = useMutation({
    mutationFn: async (payload: {
      file: File
      applyDatabase: boolean
      applyInstagramData: boolean
      applyImages: boolean
    }) => {
      const formData = new FormData()
      // Fields must come before file for @fastify/multipart to parse them correctly
      formData.append('applyDatabase', String(payload.applyDatabase))
      formData.append('applyInstagramData', String(payload.applyInstagramData))
      formData.append('applyImages', String(payload.applyImages))
      formData.append('file', payload.file)

      const res = await fetch(`${API_BASE_URL}/backups/import`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to import backup bundle')
      }

      return res.json()
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['backupBundles'] })

      const restoredParts = []
      if (data?.restored?.database) restoredParts.push('database')
      if (data?.restored?.instagramData) restoredParts.push('Instagram data')
      if (data?.restored?.images) restoredParts.push('Instagram images')

      const message = restoredParts.length > 0
        ? `Restored ${restoredParts.join(', ')} successfully`
        : 'Backup processed'

      toast.success(data?.restarting
        ? `${message}. Server will restart shortly to refresh connections.`
        : message)

      if (data?.instagramRestore) {
        toast.message('Instagram restore details', {
          description: `Accounts: ${data.instagramRestore.accountsCreated ?? 0}, Sessions: ${data.instagramRestore.sessionsCreated ?? 0}, Events: ${data.instagramRestore.eventsCreated ?? 0}`,
        })
      }

      if (data?.instagramImagesRestored) {
        toast.message('Instagram images', {
          description: `Restored ${data.instagramImagesRestored} images`,
        })
      }

      if (data?.restarting) {
        setTimeout(() => {
          window.location.reload()
        }, 5000)
      }

      setImportFile(null)
      setApplyDatabase(false)
      setApplyInstagramData(false)
      setApplyImages(false)
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      const res = await fetch(`${API_BASE_URL}/backups/${filename}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const error = await res.json().catch(() => ({}))
        throw new Error(error.message || 'Failed to delete backup bundle')
      }
      return res.json()
    },
    onSuccess: () => {
      toast.success('Backup bundle deleted')
      queryClient.invalidateQueries({ queryKey: ['backupBundles'] })
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const featureTogglesMutation = useMutation({
    mutationFn: (payload: { posterImportEnabled: boolean }) => systemSettingsApi.update(payload),
    onSuccess: (updatedSettings) => {
      queryClient.setQueryData(['system-settings'], updatedSettings)
      toast.success(
        updatedSettings.posterImportEnabled
          ? 'Poster Import tab enabled'
          : 'Poster Import tab hidden'
      )
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update system settings')
    },
  })

  const aiSettingsMutation = useMutation({
    mutationFn: (payload: { aiProvider?: 'gemini' | 'claude'; geminiApiKey?: string; claudeApiKey?: string }) =>
      systemSettingsApi.update(payload),
    onSuccess: (updatedSettings) => {
      queryClient.setQueryData(['system-settings'], updatedSettings)
      toast.success('AI settings updated')
      setGeminiKey('')
      setClaudeKey('')
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update AI settings')
    },
  })

  const cleanupDuplicatesMutation = useMutation({
    mutationFn: (sourceKey?: string) => systemSettingsApi.cleanupDuplicates(sourceKey),
    onSuccess: (result) => {
      toast.success(result.message)
      if (result.duplicatesFound.length > 0) {
        toast.message('Duplicates cleaned', {
          description: `Found ${result.duplicatesFound.length} duplicate groups. Deleted ${result.eventsRawDeleted} raw events and ${result.eventSeriesDeleted} series.`,
        })
      }
      queryClient.invalidateQueries({ queryKey: ['events'] })
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to cleanup duplicates')
    },
  })

  const isSystemSettingsBusy =
    isLoadingSystemSettings || featureTogglesMutation.isPending || aiSettingsMutation.isPending

  useEffect(() => {
    if (systemSettings) {
      setAiProvider(systemSettings.aiProvider || 'gemini')
    }
  }, [systemSettings])


  const handleExport = () => {
    if (!exportIncludeDatabase && !exportIncludeInstagramData && !exportIncludeImages) {
      toast.error('Select at least one component to include in the backup')
      return
    }

    exportMutation.mutate({
      includeDatabase: exportIncludeDatabase,
      includeInstagramData: exportIncludeInstagramData,
      includeImages: exportIncludeImages,
    })
  }

  const handleImport = () => {
    if (!importFile) {
      toast.error('Please choose a backup bundle to import')
      return
    }
    if (!applyDatabase && !applyInstagramData && !applyImages) {
      toast.error('Select at least one component to restore')
      return
    }

    const confirmMessage = applyDatabase
      ? '⚠️ Importing the database will replace all current data. Continue?'
      : 'Restore selected components from this backup?'

    if (confirm(confirmMessage)) {
      importMutation.mutate({
        file: importFile,
        applyDatabase,
        applyInstagramData,
        applyImages,
      })
    }
  }

  const handleDownload = (filename: string) => {
    window.open(`${API_BASE_URL}/backups/download/${filename}`, '_blank')
  }

  const handleDelete = (filename: string) => {
    if (confirm(`Delete backup ${filename}?`)) {
      deleteMutation.mutate(filename)
    }
  }

  const handleTogglePosterImport = (checked: boolean) => {
    if (systemSettings?.posterImportEnabled === checked || featureTogglesMutation.isPending) {
      return
    }
    featureTogglesMutation.mutate({ posterImportEnabled: checked })
  }

  const formatBytes = (bytes: number) => {
    if (!bytes) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString()
  }

  const backups = backupsData ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage unified backups and system configuration
        </p>
      </div>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Sliders className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">Feature Toggles</h2>
            <p className="text-sm text-muted-foreground">
              Hide modules you do not need in the admin sidebar.
            </p>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <Label className="text-sm">Poster Import tab</Label>
            <p className="text-xs text-muted-foreground">
              Remove the Poster Import navigation item when your team is not using AI uploads.
            </p>
          </div>
          <Switch
            checked={systemSettings?.posterImportEnabled ?? true}
            disabled={isSystemSettingsBusy}
            onCheckedChange={handleTogglePosterImport}
          />
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Sliders className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">AI Settings</h2>
            <p className="text-sm text-muted-foreground">
              Choose the global AI provider and manage API keys used for Instagram extraction and Poster Import.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>AI Extraction Provider</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="aiProvider"
                  value="gemini"
                  checked={aiProvider === 'gemini'}
                  onChange={() => aiSettingsMutation.mutate({ aiProvider: 'gemini' })}
                  className="h-4 w-4"
                />
                <span>Gemini</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="aiProvider"
                  value="claude"
                  checked={aiProvider === 'claude'}
                  onChange={() => aiSettingsMutation.mutate({ aiProvider: 'claude' })}
                  className="h-4 w-4"
                />
                <span>Claude (Anthropic)</span>
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              This provider will be used for both Instagram image extraction and manual poster imports.
            </p>
          </div>

          <Separator />

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="gemini-key-global">Gemini API Key</Label>
                {systemSettings?.hasGeminiKey && <Badge variant="secondary">Key saved</Badge>}
              </div>
              <div className="flex gap-2">
                <Input
                  id="gemini-key-global"
                  type="password"
                  placeholder="AI..."
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                />
                <Button
                  onClick={() => {
                    if (!geminiKey) {
                      toast.error('Please enter a Gemini API key')
                      return
                    }
                    aiSettingsMutation.mutate({ geminiApiKey: geminiKey })
                  }}
                  disabled={aiSettingsMutation.isPending}
                >
                  Save
                </Button>
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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="claude-key-global">Claude API Key</Label>
                {systemSettings?.hasClaudeKey && <Badge variant="secondary">Key saved</Badge>}
              </div>
              <div className="flex gap-2">
                <Input
                  id="claude-key-global"
                  type="password"
                  placeholder="sk-ant-..."
                  value={claudeKey}
                  onChange={(e) => setClaudeKey(e.target.value)}
                />
                <Button
                  onClick={() => {
                    if (!claudeKey) {
                      toast.error('Please enter a Claude API key')
                      return
                    }
                    aiSettingsMutation.mutate({ claudeApiKey: claudeKey })
                  }}
                  disabled={aiSettingsMutation.isPending}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Get your key from{' '}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Anthropic Console → API Keys
                </a>
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Eraser className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">Data Maintenance</h2>
            <p className="text-sm text-muted-foreground">
              Clean up duplicate events and maintain data integrity.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-4">
          <div>
            <Label className="text-sm">Cleanup Duplicate Events</Label>
            <p className="text-xs text-muted-foreground mt-1">
              Find and remove duplicate events based on URL. Keeps the most recently created event and deletes older duplicates.
              This is useful after fixing scraper deduplication issues or importing data multiple times.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (confirm('This will delete duplicate events, keeping only the most recent version. Continue?')) {
                  cleanupDuplicatesMutation.mutate(undefined)
                }
              }}
              disabled={cleanupDuplicatesMutation.isPending}
              variant="outline"
            >
              {cleanupDuplicatesMutation.isPending ? 'Cleaning up…' : 'Cleanup All Sources'}
            </Button>
            <Button
              onClick={() => {
                if (confirm('This will delete duplicate UNBC events, keeping only the most recent version. Continue?')) {
                  cleanupDuplicatesMutation.mutate('unbc_ca')
                }
              }}
              disabled={cleanupDuplicatesMutation.isPending}
              variant="outline"
            >
              {cleanupDuplicatesMutation.isPending ? 'Cleaning up…' : 'Cleanup UNBC Only'}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <HardDrive className="h-6 w-6 text-primary" />
          <div>
            <h2 className="text-xl font-semibold">Backup & Restore</h2>
            <p className="text-sm text-muted-foreground">
              Create or restore backup bundles with database, Instagram data, and cached images.
            </p>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              <h3 className="font-semibold">Create Backup Bundle</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Choose what to include in the backup bundle, then download a single ZIP file you can restore later.
            </p>

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm">Full database (SQL)</Label>
                  <p className="text-xs text-muted-foreground">
                    Includes every table in Postgres. Required to fully migrate the system.
                  </p>
                </div>
                <Switch
                  checked={exportIncludeDatabase}
                  onCheckedChange={setExportIncludeDatabase}
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Instagram dataset
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Exports Instagram sources, accounts, sessions, and events as JSON.
                  </p>
                </div>
                <Switch
                  checked={exportIncludeInstagramData}
                  onCheckedChange={setExportIncludeInstagramData}
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm flex items-center gap-2">
                    <Image className="h-4 w-4" />
                    Cached Instagram images
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Copies files from the Instagram image cache directory.
                  </p>
                </div>
                <Switch
                  checked={exportIncludeImages}
                  onCheckedChange={setExportIncludeImages}
                />
              </div>
            </div>

            <Button
              onClick={handleExport}
              disabled={exportMutation.isPending}
              className="w-full"
            >
              {exportMutation.isPending ? 'Creating bundle…' : 'Create & Download Backup'}
            </Button>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              <h3 className="font-semibold">Restore Backup Bundle</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Upload a bundle and choose which components to restore. Restoring the database will restart the server.
            </p>

            <Input
              type="file"
              accept=".zip"
              onChange={(event) => setImportFile(event.target.files?.[0] ?? null)}
            />

            <div className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm">Restore database</Label>
                  <p className="text-xs text-muted-foreground">
                    Drops and recreates the entire database schema from the SQL dump.
                  </p>
                </div>
                <Switch
                  checked={applyDatabase}
                  onCheckedChange={setApplyDatabase}
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm">Restore Instagram data</Label>
                  <p className="text-xs text-muted-foreground">
                    Clears existing Instagram records and imports the JSON data set.
                  </p>
                </div>
                <Switch
                  checked={applyInstagramData}
                  onCheckedChange={setApplyInstagramData}
                />
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label className="text-sm">Restore cached images</Label>
                  <p className="text-xs text-muted-foreground">
                    Copies any missing images from the bundle into the cache directory.
                  </p>
                </div>
                <Switch
                  checked={applyImages}
                  onCheckedChange={setApplyImages}
                />
              </div>
            </div>

            <Button
              variant="secondary"
              onClick={handleImport}
              disabled={importMutation.isPending}
              className="w-full"
            >
              {importMutation.isPending ? 'Restoring…' : 'Restore Selected Components'}
            </Button>
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Available Backups</h3>
          {isLoadingBackups ? (
            <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground">
              Loading backups…
            </div>
          ) : backups.length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-muted-foreground">
              No backup bundles yet. Create one to get started.
            </div>
          ) : (
            <div className="space-y-3">
              {backups.map((backup) => (
                <div
                  key={backup.filename}
                  className="flex flex-col gap-3 rounded-lg border border-border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="flex-1 space-y-1">
                    <div className="font-medium break-words">{backup.filename}</div>
                    <div className="text-sm text-muted-foreground">
                      Created {formatDate(backup.createdAt)} • {formatBytes(backup.size)}
                    </div>
                    {backup.manifest ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {backup.manifest.includeDatabase && <Badge variant="secondary">Database</Badge>}
                        {backup.manifest.includeInstagramData && <Badge variant="secondary">Instagram data</Badge>}
                        {backup.manifest.includeImages && <Badge variant="secondary">Images</Badge>}
                      </div>
                    ) : (
                      <div className="text-xs text-muted-foreground">
                        Manifest not available for this bundle.
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleDownload(backup.filename)}
                      variant="outline"
                      size="sm"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={() => handleDelete(backup.filename)}
                      variant="outline"
                      size="sm"
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
