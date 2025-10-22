import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { instagramApi, instagramApifyApi, InstagramSource, CreateInstagramSourceData, API_BASE_URL } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Plus, CheckCircle, Pause, Instagram, Upload, Zap, Settings, Trash2, Key, Download, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'

interface InstagramSettings {
  defaultScraperType: 'apify' | 'instagram-private-api'
  allowPerAccountOverride: boolean
}

export function InstagramSources() {
  const queryClient = useQueryClient()
  const [selectedSource, setSelectedSource] = useState<InstagramSource | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showSessionForm, setShowSessionForm] = useState(false)
  const [sessionUsername, setSessionUsername] = useState('')
  const [sessionData, setSessionData] = useState('')
  const [activeTab, setActiveTab] = useState<'active' | 'inactive' | 'all'>('active')

  // Apify run import state
  const [apifyRunId, setApifyRunId] = useState('')
  const [apifyRunLimit, setApifyRunLimit] = useState<number>(10)
  const [apifyRunResult, setApifyRunResult] = useState<string | null>(null)
  const [apifyRunError, setApifyRunError] = useState<string | null>(null)

  // Form state
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

  // Fetch Instagram settings to check if per-account override is allowed
  const { data: settingsData } = useQuery({
    queryKey: ['instagram-settings'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-settings`)
      const data = await res.json()
      return data.settings as InstagramSettings
    },
  })

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
      toast.success(`Scrape job queued for @${data.username}`)
      queryClient.invalidateQueries({ queryKey: ['instagram-sources'] })
    },
    onError: (error) => {
      toast.error(`Failed to trigger scrape: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const triggerAllActiveMutation = useMutation({
    mutationFn: () => instagramApi.triggerAllActive(),
    onSuccess: (data) => {
      toast.success(`Queued scrape jobs for ${data.accountsQueued} active accounts`)
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

  const handleTriggerAllActive = async () => {
    if (activeSources === 0) {
      toast.error('No active Instagram accounts to scrape')
      return
    }

    if (confirm(`Are you sure you want to scrape all ${activeSources} active Instagram accounts?`)) {
      try {
        await triggerAllActiveMutation.mutateAsync()
      } catch (error) {
        console.error('Trigger all failed:', error)
      }
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

  const getStatusBadge = (active: boolean) => {
    return (
      <Badge variant={active ? 'success' : 'secondary'}>
        {active ? (
          <>
            <CheckCircle className="h-3 w-3 mr-1" />
            Active
          </>
        ) : (
          <>
            <Pause className="h-3 w-3 mr-1" />
            Inactive
          </>
        )}
      </Badge>
    )
  }

  // Calculate statistics
  const totalSources = sources?.sources.length || 0
  const activeSources = sources?.sources.filter(s => s.active).length || 0
  const inactiveSources = totalSources - activeSources

  // Filter sources based on active tab
  const filteredSources = sources?.sources.filter(source => {
    if (activeTab === 'active') return source.active
    if (activeTab === 'inactive') return !source.active
    return true // 'all' tab shows everything
  }) || []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Instagram Sources</h1>
        <p className="text-muted-foreground">
          Manage Instagram accounts for event scraping
        </p>
      </div>

      {/* Statistics Summary */}
      {totalSources > 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-6">
              <div>
                <p className="text-sm text-muted-foreground">Tracked Clubs</p>
                <p className="text-2xl font-bold">
                  {activeSources}/{totalSources} active
                </p>
              </div>
              <div className="h-12 w-px bg-border" />
              <div className="flex gap-6">
                <div>
                  <p className="text-sm text-muted-foreground">Active</p>
                  <p className="text-xl font-semibold text-green-600">{activeSources}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Inactive</p>
                  <p className="text-xl font-semibold text-gray-500">{inactiveSources}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">All</p>
                  <p className="text-xl font-semibold">{totalSources}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Load Existing Apify Run */}
      <Card>
        <CardHeader>
          <CardTitle>Load Existing Apify Run</CardTitle>
          <CardDescription>
            Import posts from a previous Apify Instagram scraping run
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[2fr,auto] gap-3">
              <div>
                <Label htmlFor="apify-run-id">Apify Run ID</Label>
                <Input
                  id="apify-run-id"
                  type="text"
                  value={apifyRunId}
                  onChange={(e) => setApifyRunId(e.target.value)}
                  placeholder="e.g., H8k9J2lP1A2B3C4D"
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="apify-run-limit">Post Limit</Label>
                <Input
                  id="apify-run-limit"
                  type="number"
                  min={1}
                  max={100}
                  value={apifyRunLimit}
                  onChange={(e) => setApifyRunLimit(parseInt(e.target.value) || 10)}
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleImportApifyRun}
                disabled={importApifyRunMutation.isPending || !apifyRunId.trim()}
                className="flex items-center gap-2"
              >
                {importApifyRunMutation.isPending ? (
                  <Download className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {importApifyRunMutation.isPending ? 'Importing...' : 'Import Posts'}
              </Button>
            </div>

            {apifyRunResult && (
              <div className="flex items-start gap-2 text-sm text-green-600 bg-green-50 p-3 rounded-md">
                <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{apifyRunResult}</span>
              </div>
            )}

            {apifyRunError && (
              <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{apifyRunError}</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Add Source */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Instagram Accounts</h3>
              <p className="text-sm text-muted-foreground">
                Configure Instagram accounts to scrape event posters
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link to="/instagram/settings">
                <Button variant="outline" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Settings
                </Button>
              </Link>
              <Button
                onClick={() => setShowSessionForm(true)}
                variant="outline"
                className="flex items-center gap-2"
              >
                <Key className="h-4 w-4" />
                Upload Session
              </Button>
              <Button
                onClick={handleTriggerAllActive}
                variant="outline"
                disabled={activeSources === 0 || triggerAllActiveMutation.isPending}
                className="flex items-center gap-2"
              >
                <Zap className="h-4 w-4" />
                Scrape All Active ({activeSources})
              </Button>
              <Button onClick={handleAdd} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Instagram Source
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sources Table */}
      <Card>
        <CardHeader>
          <CardTitle>Configured Instagram Sources</CardTitle>
          <CardDescription>
            Instagram accounts configured for event scraping
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading Instagram sources...</p>
            </div>
          ) : !sources?.sources.length ? (
            <div className="text-center py-8">
              <Instagram className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No Instagram sources configured</p>
              <p className="text-sm text-muted-foreground mt-2">
                Add your first Instagram account to begin scraping event posters
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Filter Tabs */}
              <div className="border-b border-border">
                <nav className="flex gap-4">
                  <button
                    onClick={() => setActiveTab('active')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'active'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Active ({activeSources})
                  </button>
                  <button
                    onClick={() => setActiveTab('inactive')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'inactive'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Inactive ({inactiveSources})
                  </button>
                  <button
                    onClick={() => setActiveTab('all')}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === 'all'
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All ({totalSources})
                  </button>
                </nav>
              </div>

              {/* Table */}
              {filteredSources.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">
                    No {activeTab} sources found
                  </p>
                </div>
              ) : (
                <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Classification</TableHead>
                  <TableHead>Settings</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-sm">{source.name}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Instagram className="h-3 w-3" />
                          <a
                            href={`https://instagram.com/${source.instagramUsername}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            @{source.instagramUsername}
                          </a>
                        </div>
                        {source.notes && (
                          <p className="text-xs text-muted-foreground">{source.notes}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={source.classificationMode === 'auto' ? 'default' : 'outline'}>
                        {source.classificationMode === 'auto' ? 'Auto' : 'Manual'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant={source.instagramScraperType === 'apify' ? 'default' : 'secondary'} className="text-xs">
                          {source.instagramScraperType === 'apify' ? 'Apify' : 'Private API'}
                        </Badge>
                        <p className="text-xs text-muted-foreground">{source.defaultTimezone}</p>
                        <p className="text-xs text-muted-foreground">
                          Added {formatRelativeTime(source.createdAt)}
                        </p>
                        {source.lastChecked && (
                          <p className="text-xs text-muted-foreground">
                            Last checked {formatRelativeTime(source.lastChecked)}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(source.active)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(source)}
                          className="flex items-center gap-1"
                        >
                          <Settings className="h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!source.active || triggerMutation.isPending}
                          onClick={() => handleTrigger(source)}
                          className="flex items-center gap-1"
                        >
                          <Zap className="h-3 w-3" />
                          Scrape Now
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleDelete(source)}
                          className="flex items-center gap-1 text-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Information Card */}
      <Card>
        <CardHeader>
          <CardTitle>How Instagram Scraping Works</CardTitle>
          <CardDescription>
            Understanding the Instagram event extraction process
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Upload className="h-4 w-4" />
                1. Upload Instagram Session
              </h4>
              <p className="text-sm text-muted-foreground">
                Export your Instagram session cookies and upload them using the "Upload Session" button.
                This allows the scraper to access Instagram posts without logging in repeatedly.
              </p>
            </div>

            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Instagram className="h-4 w-4" />
                2. Configure Instagram Account
              </h4>
              <p className="text-sm text-muted-foreground">
                Add the Instagram username you want to scrape. Choose between manual mode (scrape all posts)
                or auto mode (AI classifies which posts contain events).
              </p>
            </div>

            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Zap className="h-4 w-4" />
                3. Trigger Scraping
              </h4>
              <p className="text-sm text-muted-foreground">
                Click "Scrape Now" to fetch recent posts. The system will download images and use Gemini AI
                to extract event details from poster images.
              </p>
            </div>
          </div>

          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-medium mb-2">Classification Modes</h4>
            <ul className="text-sm text-muted-foreground space-y-2">
              <li>
                <strong>Manual:</strong> Scrapes all posts and extracts events from each image (slower, more thorough)
              </li>
              <li>
                <strong>Auto:</strong> Uses keyword detection to identify event posts before extraction (faster, may miss some events)
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Add/Edit Source Dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedSource ? 'Edit Instagram Source' : 'Add Instagram Source'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Source Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., UBC Events"
              />
            </div>

            <div>
              <Label htmlFor="username">Instagram Username</Label>
              <Input
                id="username"
                value={formData.instagramUsername}
                onChange={(e) => setFormData({ ...formData, instagramUsername: e.target.value })}
                placeholder="e.g., ubcevents"
              />
            </div>

            <div>
              <Label htmlFor="classificationMode">Classification Mode</Label>
              <Select
                value={formData.classificationMode}
                onValueChange={(value: 'manual' | 'auto') =>
                  setFormData({ ...formData, classificationMode: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual (All Posts)</SelectItem>
                  <SelectItem value="auto">Auto (AI Classification)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {settingsData?.allowPerAccountOverride && (
              <div>
                <Label htmlFor="scraperType">Scraper Backend</Label>
                <Select
                  value={formData.instagramScraperType}
                  onValueChange={(value: 'apify' | 'instagram-private-api') =>
                    setFormData({ ...formData, instagramScraperType: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="instagram-private-api">instagram-private-api (Free, requires session)</SelectItem>
                    <SelectItem value="apify">Apify (Paid, official API)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Choose between free session-based scraping or reliable paid Apify API
                </p>
              </div>
            )}

            {!settingsData?.allowPerAccountOverride && settingsData?.defaultScraperType && (
              <div>
                <Label>Scraper Backend</Label>
                <div className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
                  Using global default: <strong>{settingsData.defaultScraperType === 'apify' ? 'Apify (Paid)' : 'instagram-private-api (Free)'}</strong>
                  <br />
                  <span className="text-xs">Per-account override is disabled. Go to Settings to enable.</span>
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="timezone">Default Timezone</Label>
              <Input
                id="timezone"
                value={formData.defaultTimezone}
                onChange={(e) => setFormData({ ...formData, defaultTimezone: e.target.value })}
                placeholder="e.g., America/Vancouver"
              />
            </div>

            <div>
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Add any notes about this source..."
                rows={3}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="active"
                checked={formData.active}
                onCheckedChange={(checked) => setFormData({ ...formData, active: checked })}
              />
              <Label htmlFor="active">Active</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {selectedSource ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Upload Session Dialog */}
      <Dialog open={showSessionForm} onOpenChange={setShowSessionForm}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload Instagram Session</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="session-username">Instagram Username</Label>
              <Input
                id="session-username"
                value={sessionUsername}
                onChange={(e) => setSessionUsername(e.target.value)}
                placeholder="e.g., ubcevents"
              />
            </div>

            <div>
              <Label htmlFor="session-data">Session Data (JSON)</Label>
              <Textarea
                id="session-data"
                value={sessionData}
                onChange={(e) => setSessionData(e.target.value)}
                placeholder='{"cookies": "...", "state": {...}}'
                rows={10}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Paste the exported Instagram session JSON data here
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSessionForm(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleUploadSession}
              disabled={uploadSessionMutation.isPending || !sessionUsername || !sessionData}
            >
              Upload
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
