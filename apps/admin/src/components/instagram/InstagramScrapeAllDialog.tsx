import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { InstagramAccountPreview, InstagramScrapeOptions } from '@/components/instagram/types'

interface InstagramScrapeAllDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeSources: number
  scrapeOptions: InstagramScrapeOptions
  onScrapeOptionsChange: (updater: (prev: InstagramScrapeOptions) => InstagramScrapeOptions) => void
  activeAccountPreview: InstagramAccountPreview[]
  onConfirm: () => void
  isConfirming: boolean
}

export function InstagramScrapeAllDialog({
  open,
  onOpenChange,
  activeSources,
  scrapeOptions,
  onScrapeOptionsChange,
  activeAccountPreview,
  onConfirm,
  isConfirming,
}: InstagramScrapeAllDialogProps) {
  const accountLimitValue = Math.min(scrapeOptions.accountLimit || activeSources, activeSources)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scrape all active Instagram accounts?</DialogTitle>
          <DialogDescription>
            This will queue scrapes for {activeSources} active account{activeSources === 1 ? '' : 's'}. Jobs run
            sequentially to respect rate limits.
          </DialogDescription>
        </DialogHeader>
        {activeSources > 0 && (
          <div className="space-y-4 text-sm text-muted-foreground">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="scrape-account-limit">Accounts to queue</Label>
                <Input
                  id="scrape-account-limit"
                  type="number"
                  min={1}
                  max={activeSources}
                  value={accountLimitValue}
                  onChange={(event) => {
                    const parsed = parseInt(event.target.value, 10)
                    onScrapeOptionsChange((prev) => ({
                      ...prev,
                      accountLimit: Number.isNaN(parsed) ? prev.accountLimit : parsed,
                    }))
                  }}
                />
                <p className="text-xs text-muted-foreground">Default: all {activeSources} active accounts</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="scrape-post-limit">Posts per account</Label>
                <Input
                  id="scrape-post-limit"
                  type="number"
                  min={1}
                  max={100}
                  value={scrapeOptions.postsPerAccount}
                  onChange={(event) => {
                    const parsed = parseInt(event.target.value, 10)
                    onScrapeOptionsChange((prev) => ({
                      ...prev,
                      postsPerAccount: Number.isNaN(parsed) ? prev.postsPerAccount : parsed,
                    }))
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Higher values take longer and consume more API quota
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="scrape-batch-size">Profiles per Apify batch</Label>
                <Input
                  id="scrape-batch-size"
                  type="number"
                  min={1}
                  max={25}
                  value={scrapeOptions.batchSize}
                  onChange={(event) => {
                    const parsed = parseInt(event.target.value, 10)
                    onScrapeOptionsChange((prev) => ({
                      ...prev,
                      batchSize: Number.isNaN(parsed) ? prev.batchSize : parsed,
                    }))
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Controls how many usernames are fetched together
                </p>
              </div>
            </div>

            <div>
              <p className="mb-1">Accounts to scrape:</p>
              <ul className="list-disc pl-4">
                {activeAccountPreview.slice(0, 5).map((account) => (
                  <li key={account.id}>
                    @{account.username}{' '}
                    <span className="text-xs text-muted-foreground">({account.name})</span>
                  </li>
                ))}
              </ul>
              {activeSources > 5 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  +{activeSources - 5} more active account{activeSources - 5 === 1 ? '' : 's'}
                </p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isConfirming}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isConfirming}
            className="flex items-center gap-2"
          >
            {isConfirming && <Loader2 className="h-4 w-4 animate-spin" />}
            Start scrapes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
