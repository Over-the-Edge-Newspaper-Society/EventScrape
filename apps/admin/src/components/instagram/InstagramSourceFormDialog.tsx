import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { CreateInstagramSourceData, InstagramSource } from '@/lib/api'
import { InstagramSettings } from '@/components/instagram/types'

interface InstagramSourceFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  formData: CreateInstagramSourceData
  setFormData: (
    updater:
      | CreateInstagramSourceData
      | ((prev: CreateInstagramSourceData) => CreateInstagramSourceData)
  ) => void
  selectedSource: InstagramSource | null
  onSubmit: () => void
  isSubmitting: boolean
  settings?: InstagramSettings
}

export function InstagramSourceFormDialog({
  open,
  onOpenChange,
  formData,
  setFormData,
  selectedSource,
  onSubmit,
  isSubmitting,
  settings,
}: InstagramSourceFormDialogProps) {
  const allowOverride = settings?.allowPerAccountOverride
  const defaultScraperType = settings?.defaultScraperType

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{selectedSource ? 'Edit Instagram Source' : 'Add Instagram Source'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="name">Source Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="e.g., UBC Events"
            />
          </div>

          <div>
            <Label htmlFor="username">Instagram Username</Label>
            <Input
              id="username"
              value={formData.instagramUsername}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, instagramUsername: event.target.value }))
              }
              placeholder="e.g., ubcevents"
            />
          </div>

          <div>
            <Label htmlFor="classificationMode">Classification Mode</Label>
            <Select
              value={formData.classificationMode}
              onValueChange={(value: 'manual' | 'auto') =>
                setFormData((prev) => ({ ...prev, classificationMode: value }))
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

          {allowOverride ? (
            <div>
              <Label htmlFor="scraperType">Scraper Backend</Label>
              <Select
                value={formData.instagramScraperType}
                onValueChange={(value: 'apify' | 'instagram-private-api') =>
                  setFormData((prev) => ({ ...prev, instagramScraperType: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="instagram-private-api">
                    instagram-private-api (Free, requires session)
                  </SelectItem>
                  <SelectItem value="apify">Apify (Paid, official API)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Choose between free session-based scraping or reliable paid Apify API
              </p>
            </div>
          ) : (
            defaultScraperType && (
              <div>
                <Label>Scraper Backend</Label>
                <div className="text-sm text-muted-foreground p-3 bg-muted rounded-md">
                  Using global default:{' '}
                  <strong>
                    {defaultScraperType === 'apify' ? 'Apify (Paid)' : 'instagram-private-api (Free)'}
                  </strong>
                  <br />
                  <span className="text-xs">Per-account override is disabled. Go to Settings to enable.</span>
                </div>
              </div>
            )
          )}

          <div>
            <Label htmlFor="timezone">Default Timezone</Label>
            <Input
              id="timezone"
              value={formData.defaultTimezone}
              onChange={(event) =>
                setFormData((prev) => ({ ...prev, defaultTimezone: event.target.value }))
              }
              placeholder="e.g., America/Vancouver"
            />
          </div>

          <div>
            <Label htmlFor="notes">Notes (Optional)</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(event) => setFormData((prev) => ({ ...prev, notes: event.target.value }))}
              placeholder="Add any notes about this source..."
              rows={3}
            />
          </div>

          <div className="flex items-center space-x-2">
            <Switch
              id="active"
              checked={formData.active}
              onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, active: checked }))}
            />
            <Label htmlFor="active">Active</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isSubmitting}>
            {selectedSource ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
