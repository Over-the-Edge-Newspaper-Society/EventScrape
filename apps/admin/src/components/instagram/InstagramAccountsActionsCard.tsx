import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { InstagramScrapeProgressCard } from '@/components/instagram/InstagramScrapeProgressCard'
import { ScrapeProgressSummary } from '@/hooks/useInstagramScrapeProgress'
import { Settings, Key, Zap, Plus, Loader2 } from 'lucide-react'

interface InstagramAccountsActionsCardProps {
  activeSources: number
  settingsHref: string
  onUploadSession: () => void
  onTriggerAll: () => void
  onAddSource: () => void
  triggerAllPending: boolean
  showScrapeProgress: boolean
  scrapeProgress?: ScrapeProgressSummary
  onCancelScrape?: () => void
  isCancelling?: boolean
}

export function InstagramAccountsActionsCard({
  activeSources,
  settingsHref,
  onUploadSession,
  onTriggerAll,
  onAddSource,
  triggerAllPending,
  showScrapeProgress,
  scrapeProgress,
  onCancelScrape,
  isCancelling,
}: InstagramAccountsActionsCardProps) {
  return (
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
            <Link to={settingsHref}>
              <Button variant="outline" className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Settings
              </Button>
            </Link>
            <Button
              onClick={onUploadSession}
              variant="outline"
              className="flex items-center gap-2"
            >
              <Key className="h-4 w-4" />
              Upload Session
            </Button>
            <Button
              onClick={onTriggerAll}
              variant="outline"
              disabled={activeSources === 0 || triggerAllPending}
              className="flex items-center gap-2"
            >
              {triggerAllPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Zap className="h-4 w-4" />
              )}
              {triggerAllPending ? 'Starting...' : `Scrape All Active (${activeSources})`}
            </Button>
            <Button onClick={onAddSource} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              Add Instagram Source
            </Button>
          </div>
        </div>
        {showScrapeProgress && scrapeProgress && (
          <InstagramScrapeProgressCard
            progress={scrapeProgress}
            onCancel={onCancelScrape}
            isCancelling={isCancelling}
          />
        )}
      </CardContent>
    </Card>
  )
}
