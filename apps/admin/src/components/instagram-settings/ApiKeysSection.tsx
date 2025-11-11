import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Key, Save, Trash2, CheckCircle } from 'lucide-react'
import type { InstagramSettings } from '@/pages/InstagramSettings'

interface ApiKeysSectionProps {
  settings: InstagramSettings | undefined
  apifyToken: string
  setApifyToken: (value: string) => void
  geminiKey: string
  setGeminiKey: (value: string) => void
  claudeKey: string
  setClaudeKey: (value: string) => void
  aiProvider: 'gemini' | 'claude'
  setAiProvider: (value: 'gemini' | 'claude') => void
  handleSaveApifyToken: () => void
  handleSaveGeminiKey: () => void
  handleSaveClaudeKey: () => void
  handleSaveAiProvider: (provider: 'gemini' | 'claude') => void
  updateSettingsPending: boolean
  removeApifyToken: () => void
  removeApifyTokenPending: boolean
  removeGeminiKey: () => void
  removeGeminiKeyPending: boolean
  removeClaudeKey: () => void
  removeClaudeKeyPending: boolean
}

export function ApiKeysSection({
  settings,
  apifyToken,
  setApifyToken,
  geminiKey,
  setGeminiKey,
  claudeKey,
  setClaudeKey,
  aiProvider,
  setAiProvider,
  handleSaveApifyToken,
  handleSaveGeminiKey,
  handleSaveClaudeKey,
  handleSaveAiProvider,
  updateSettingsPending,
  removeApifyToken,
  removeApifyTokenPending,
  removeGeminiKey,
  removeGeminiKeyPending,
  removeClaudeKey,
  removeClaudeKeyPending,
}: ApiKeysSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          API Keys
        </CardTitle>
        <CardDescription>
          Store API keys for Apify, Gemini, and Claude services
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* AI Provider Selection */}
        <div className="space-y-2">
          <Label>AI Extraction Provider</Label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="aiProvider"
                value="gemini"
                checked={aiProvider === 'gemini'}
                onChange={(e) => {
                  const newValue = e.target.value as 'gemini' | 'claude'
                  setAiProvider(newValue)
                  handleSaveAiProvider(newValue)
                }}
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
                onChange={(e) => {
                  const newValue = e.target.value as 'gemini' | 'claude'
                  setAiProvider(newValue)
                  handleSaveAiProvider(newValue)
                }}
                className="h-4 w-4"
              />
              <span>Claude (Anthropic)</span>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Select which AI provider to use for event extraction and classification
          </p>
        </div>

        <Separator />

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
            <Button onClick={handleSaveApifyToken} disabled={updateSettingsPending}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            {settings?.hasApifyToken && (
              <Button
                variant="outline"
                onClick={removeApifyToken}
                disabled={removeApifyTokenPending}
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
            <Button onClick={handleSaveGeminiKey} disabled={updateSettingsPending}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            {settings?.hasGeminiKey && (
              <Button
                variant="outline"
                onClick={removeGeminiKey}
                disabled={removeGeminiKeyPending}
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

        <Separator />

        {/* Claude Key */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="claude-key">Claude API Key</Label>
            {settings?.hasClaudeKey && (
              <Badge variant="default" className="flex items-center gap-1">
                <CheckCircle className="h-3 w-3" />
                Key saved
              </Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Input
              id="claude-key"
              type="password"
              placeholder="sk-ant-..."
              value={claudeKey}
              onChange={(e) => setClaudeKey(e.target.value)}
            />
            <Button onClick={handleSaveClaudeKey} disabled={updateSettingsPending}>
              <Save className="h-4 w-4 mr-2" />
              Save
            </Button>
            {settings?.hasClaudeKey && (
              <Button
                variant="outline"
                onClick={removeClaudeKey}
                disabled={removeClaudeKeyPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
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
      </CardContent>
    </Card>
  )
}
