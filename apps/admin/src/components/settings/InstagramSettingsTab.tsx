import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { API_BASE_URL } from '@/lib/api'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Key, Save, Trash2, CheckCircle } from 'lucide-react'
import { AiPromptSection } from '@/components/instagram-settings/AiPromptSection'
import { GlobalScraperSection } from '@/components/instagram-settings/GlobalScraperSection'
import { ScrapingConfigSection } from '@/components/instagram-settings/ScrapingConfigSection'
import { GeminiSettingsSection } from '@/components/instagram-settings/GeminiSettingsSection'
import { BulkImportSection } from '@/components/instagram-settings/BulkImportSection'

interface InstagramSettingsData {
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

export function InstagramSettingsTab() {
  const queryClient = useQueryClient()

  const [apifyToken, setApifyToken] = useState('')
  const [apifyActorId, setApifyActorId] = useState('')
  const [apifyResultsLimit, setApifyResultsLimit] = useState<number | undefined>(undefined)
  const [fetchDelayMinutes, setFetchDelayMinutes] = useState<number | undefined>(undefined)
  const [autoExtractNewPosts, setAutoExtractNewPosts] = useState(false)
  const [autoClassifyWithAi, setAutoClassifyWithAi] = useState(false)
  const [geminiPrompt, setGeminiPrompt] = useState('')
  const [defaultScraperType, setDefaultScraperType] = useState<'apify' | 'instagram-private-api' | undefined>(undefined)
  const [allowPerAccountOverride, setAllowPerAccountOverride] = useState<boolean | undefined>(undefined)
  const [csvFile, setCsvFile] = useState<File | null>(null)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['instagram-settings'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/instagram-settings`)
      const data = await res.json()
      return data.settings as InstagramSettingsData
    },
  })

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

  const updateSettings = useMutation({
    mutationFn: async (data: Partial<InstagramSettingsData> & { apifyApiToken?: string }) => {
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
    },
    onError: () => {
      toast.error('Failed to update settings')
    },
  })

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

  if (isLoading) {
    return <div className="py-6 text-muted-foreground">Loading Instagram settings...</div>
  }

  return (
    <div className="space-y-6">
      {/* Apify Token */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Apify API Token
          </CardTitle>
          <CardDescription>
            Token for the Apify Instagram scraping service
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
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
            <Button
              onClick={() => {
                if (!apifyToken) {
                  toast.error('Please enter an Apify API token')
                  return
                }
                updateSettings.mutate({ apifyApiToken: apifyToken })
              }}
              disabled={updateSettings.isPending}
            >
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
        </CardContent>
      </Card>

      <AiPromptSection
        geminiPrompt={geminiPrompt}
        setGeminiPrompt={setGeminiPrompt}
        handleSavePrompt={() => {
          if (!geminiPrompt || geminiPrompt.trim() === '') {
            toast.error('Prompt cannot be empty')
            return
          }
          updateSettings.mutate({ geminiPrompt })
        }}
        updateSettingsPending={updateSettings.isPending}
      />

      <GlobalScraperSection
        defaultScraperType={defaultScraperType}
        setDefaultScraperType={setDefaultScraperType}
        allowPerAccountOverride={allowPerAccountOverride}
        setAllowPerAccountOverride={setAllowPerAccountOverride}
        handleSaveGlobalScraperSettings={() => {
          updateSettings.mutate({ defaultScraperType, allowPerAccountOverride })
        }}
        updateSettingsPending={updateSettings.isPending}
      />

      <ScrapingConfigSection
        apifyActorId={apifyActorId}
        setApifyActorId={setApifyActorId}
        apifyResultsLimit={apifyResultsLimit}
        setApifyResultsLimit={setApifyResultsLimit}
        fetchDelayMinutes={fetchDelayMinutes}
        setFetchDelayMinutes={setFetchDelayMinutes}
        handleSaveSettings={() => {
          updateSettings.mutate({ apifyActorId, apifyResultsLimit, fetchDelayMinutes })
        }}
        updateSettingsPending={updateSettings.isPending}
      />

      <GeminiSettingsSection
        autoExtractNewPosts={autoExtractNewPosts}
        setAutoExtractNewPosts={setAutoExtractNewPosts}
        autoClassifyWithAi={autoClassifyWithAi}
        setAutoClassifyWithAi={setAutoClassifyWithAi}
        handleSaveSettings={() => {
          updateSettings.mutate({ autoExtractNewPosts, autoClassifyWithAi })
        }}
        handleClassifyBacklog={() => classifyBacklog.mutate()}
        updateSettingsPending={updateSettings.isPending}
        classifyBacklogPending={classifyBacklog.isPending}
      />

      <BulkImportSection
        csvFile={csvFile}
        setCsvFile={setCsvFile}
        handleCsvUpload={() => {
          if (!csvFile) {
            toast.error('Please select a CSV file')
            return
          }
          importCsv.mutate(csvFile)
        }}
        importCsvPending={importCsv.isPending}
      />
    </div>
  )
}
