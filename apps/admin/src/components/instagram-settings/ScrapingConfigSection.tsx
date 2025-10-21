import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Settings as SettingsIcon, Save, Info } from 'lucide-react'

interface ScrapingConfigSectionProps {
  apifyActorId: string
  setApifyActorId: (value: string) => void
  apifyResultsLimit: number | undefined
  setApifyResultsLimit: (value: number) => void
  fetchDelayMinutes: number | undefined
  setFetchDelayMinutes: (value: number) => void
  autoExtractNewPosts: boolean
  setAutoExtractNewPosts: (value: boolean) => void
  handleSaveSettings: () => void
  updateSettingsPending: boolean
}

export function ScrapingConfigSection({
  apifyActorId,
  setApifyActorId,
  apifyResultsLimit,
  setApifyResultsLimit,
  fetchDelayMinutes,
  setFetchDelayMinutes,
  autoExtractNewPosts,
  setAutoExtractNewPosts,
  handleSaveSettings,
  updateSettingsPending,
}: ScrapingConfigSectionProps) {
  return (
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

        <Button onClick={handleSaveSettings} disabled={updateSettingsPending}>
          <Save className="h-4 w-4 mr-2" />
          Save Configuration
        </Button>
      </CardContent>
    </Card>
  )
}
