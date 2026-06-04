import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { HardDrive, Sliders, Eraser, Instagram } from 'lucide-react'
import { systemSettingsApi } from '@/lib/api'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { InstagramSettingsTab } from '@/components/settings/InstagramSettingsTab'

export function Settings() {
  const queryClient = useQueryClient()

  const [aiProvider, setAiProvider] = useState<'gemini' | 'claude' | 'openrouter'>('gemini')
  const [geminiKey, setGeminiKey] = useState('')
  const [claudeKey, setClaudeKey] = useState('')
  const [openrouterKey, setOpenrouterKey] = useState('')
  const [openrouterModel, setOpenrouterModel] = useState('google/gemini-2.0-flash-exp')

  const { data: systemSettings, isLoading: isLoadingSystemSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.get(),
  })

  const { data: openrouterModels, isLoading: isLoadingOpenrouterModels } = useQuery({
    queryKey: ['openrouter-models'],
    queryFn: () => systemSettingsApi.getOpenRouterModels(),
    staleTime: 5 * 60 * 1000, // 5 minutes
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
    mutationFn: (payload: { aiProvider?: 'gemini' | 'claude' | 'openrouter'; geminiApiKey?: string; claudeApiKey?: string; openrouterApiKey?: string; openrouterModel?: string }) =>
      systemSettingsApi.update(payload),
    onSuccess: (updatedSettings) => {
      queryClient.setQueryData(['system-settings'], updatedSettings)
      toast.success('AI settings updated')
      setGeminiKey('')
      setClaudeKey('')
      setOpenrouterKey('')
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
      setOpenrouterModel(systemSettings.openrouterModel || 'google/gemini-2.0-flash-exp')
    }
  }, [systemSettings])


  const handleTogglePosterImport = (checked: boolean) => {
    if (systemSettings?.posterImportEnabled === checked || featureTogglesMutation.isPending) {
      return
    }
    featureTogglesMutation.mutate({ posterImportEnabled: checked })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage system configuration, Instagram settings, and backups
        </p>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="instagram" className="flex items-center gap-1.5">
            <Instagram className="h-3.5 w-3.5" />
            Instagram
          </TabsTrigger>
          <TabsTrigger value="backup">Backup & Restore</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
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
                <div className="flex gap-4 flex-wrap">
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
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="aiProvider"
                      value="openrouter"
                      checked={aiProvider === 'openrouter'}
                      onChange={() => aiSettingsMutation.mutate({ aiProvider: 'openrouter' })}
                      className="h-4 w-4"
                    />
                    <span>OpenRouter</span>
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

              <Separator />

              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="openrouter-key-global">OpenRouter API Key</Label>
                    {systemSettings?.hasOpenrouterKey && <Badge variant="secondary">Key saved</Badge>}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      id="openrouter-key-global"
                      type="password"
                      placeholder="sk-or-..."
                      value={openrouterKey}
                      onChange={(e) => setOpenrouterKey(e.target.value)}
                    />
                    <Button
                      onClick={() => {
                        if (!openrouterKey) {
                          toast.error('Please enter an OpenRouter API key')
                          return
                        }
                        aiSettingsMutation.mutate({ openrouterApiKey: openrouterKey })
                      }}
                      disabled={aiSettingsMutation.isPending}
                    >
                      Save
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Get your key from{' '}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      OpenRouter → API Keys
                    </a>
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="openrouter-model">OpenRouter Model</Label>
                  <div className="flex gap-2">
                    <select
                      id="openrouter-model"
                      value={openrouterModels?.find((m) => m.id === openrouterModel) ? openrouterModel : '__custom__'}
                      onChange={(e) => {
                        if (e.target.value !== '__custom__') {
                          setOpenrouterModel(e.target.value)
                        }
                      }}
                      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      disabled={isLoadingOpenrouterModels}
                    >
                      {isLoadingOpenrouterModels ? (
                        <option>Loading models...</option>
                      ) : (
                        <>
                          {openrouterModels?.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name}
                            </option>
                          ))}
                          <option value="__custom__">Custom model ID...</option>
                        </>
                      )}
                    </select>
                    <Button
                      onClick={() => {
                        aiSettingsMutation.mutate({ openrouterModel })
                      }}
                      disabled={aiSettingsMutation.isPending}
                    >
                      Save
                    </Button>
                  </div>
                  {/* Show custom input if model not in list */}
                  {(!openrouterModels?.find((m) => m.id === openrouterModel) || openrouterModel === '__custom__') && (
                    <div className="flex gap-2 mt-2">
                      <Input
                        placeholder="e.g., openai/gpt-4o-2024-11-20"
                        value={openrouterModel === '__custom__' ? '' : openrouterModel}
                        onChange={(e) => setOpenrouterModel(e.target.value)}
                      />
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Select a vision-capable model for image extraction.{' '}
                    {openrouterModels && (
                      <span className="text-muted-foreground/70">
                        ({openrouterModels.length} vision models available)
                      </span>
                    )}{' '}
                    <a
                      href="https://openrouter.ai/models?modality=image-%3Etext"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      Browse all models
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
        </TabsContent>

        <TabsContent value="instagram" className="space-y-6">
          <InstagramSettingsTab />
        </TabsContent>

        <TabsContent value="backup" className="space-y-6">
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <HardDrive className="h-6 w-6 text-primary" />
              <div>
                <h2 className="text-xl font-semibold">Backup & Restore</h2>
                <p className="text-sm text-muted-foreground">
                  Database backups are managed by Convex.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground space-y-3">
              <p>
                This deployment runs on Convex. Backups are native Convex snapshots —
                a single ZIP containing <span className="font-medium text-foreground">every table plus all stored files</span>{' '}
                (Instagram poster images included). Run these from the project root:
              </p>
              <div className="space-y-2 font-mono text-xs text-foreground">
                <div>
                  <span className="text-muted-foreground"># export a full backup → ./backups/snapshot_*.zip</span>
                  <div className="rounded bg-muted px-2 py-1">pnpm backup:export</div>
                </div>
                <div>
                  <span className="text-muted-foreground"># restore from a backup (replaces existing data)</span>
                  <div className="rounded bg-muted px-2 py-1">pnpm backup:import backups/snapshot_&lt;id&gt;.zip</div>
                </div>
              </div>
              <p>
                You can also create / browse / restore snapshots from the{' '}
                <span className="font-medium text-foreground">Convex dashboard</span>{' '}
                (Settings → Snapshot Export) at{' '}
                <span className="font-mono text-xs">http://localhost:6791</span>.
              </p>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
