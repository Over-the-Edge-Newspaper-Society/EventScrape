import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Globe, Save } from 'lucide-react'

interface GlobalScraperSectionProps {
  defaultScraperType: 'apify' | 'instagram-private-api' | undefined
  setDefaultScraperType: (value: 'apify' | 'instagram-private-api') => void
  allowPerAccountOverride: boolean | undefined
  setAllowPerAccountOverride: (value: boolean) => void
  handleSaveGlobalScraperSettings: () => void
  updateSettingsPending: boolean
}

export function GlobalScraperSection({
  defaultScraperType,
  setDefaultScraperType,
  allowPerAccountOverride,
  setAllowPerAccountOverride,
  handleSaveGlobalScraperSettings,
  updateSettingsPending,
}: GlobalScraperSectionProps) {
  return (
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

        <Button onClick={handleSaveGlobalScraperSettings} disabled={updateSettingsPending}>
          <Save className="h-4 w-4 mr-2" />
          Save Global Scraper Settings
        </Button>
      </CardContent>
    </Card>
  )
}
