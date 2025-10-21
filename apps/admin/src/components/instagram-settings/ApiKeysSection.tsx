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
  handleSaveApifyToken: () => void
  handleSaveGeminiKey: () => void
  updateSettingsPending: boolean
  removeApifyToken: () => void
  removeApifyTokenPending: boolean
  removeGeminiKey: () => void
  removeGeminiKeyPending: boolean
}

export function ApiKeysSection({
  settings,
  apifyToken,
  setApifyToken,
  geminiKey,
  setGeminiKey,
  handleSaveApifyToken,
  handleSaveGeminiKey,
  updateSettingsPending,
  removeApifyToken,
  removeApifyTokenPending,
  removeGeminiKey,
  removeGeminiKeyPending,
}: ApiKeysSectionProps) {
  return (
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
      </CardContent>
    </Card>
  )
}
