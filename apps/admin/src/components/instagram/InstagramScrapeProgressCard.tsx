import { AlertCircle, CheckCircle, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrapeProgressSummary } from '@/hooks/useInstagramScrapeProgress'

interface InstagramScrapeProgressCardProps {
  progress: ScrapeProgressSummary
  onCancel?: () => void
  isCancelling?: boolean
}

const formatHandle = (name: string) => (name.startsWith('@') ? name : `@${name}`)

const summarizeUserList = (usernames: string[]) => {
  if (!usernames.length) return ''
  const visible = usernames.slice(0, 3).map(formatHandle).join(', ')
  const remaining = usernames.length - 3
  return remaining > 0 ? `${visible} +${remaining} more` : visible
}

export function InstagramScrapeProgressCard({ progress, onCancel, isCancelling }: InstagramScrapeProgressCardProps) {
  return (
    <div className="mt-4 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            {progress.finished ? (
              <CheckCircle className="h-4 w-4" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            <span>
              {progress.finished ? 'Instagram scrape queue finished' : 'Scraping Instagram accounts...'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {progress.finishedCount}/{progress.total} done
            </span>
            {!progress.finished && onCancel && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onCancel}
                disabled={isCancelling}
                className="text-destructive hover:text-destructive"
              >
                {isCancelling ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <XCircle className="mr-2 h-3.5 w-3.5" />
                )}
                Stop remaining
              </Button>
            )}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>{progress.percentage}%</span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary transition-[width]"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>
        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-4">
          <span>Queued: {progress.counts.queued}</span>
          <span>Running: {progress.counts.running}</span>
          <span className="text-foreground">Completed: {progress.counts.completed}</span>
          <span className={progress.counts.failed > 0 ? 'text-destructive' : undefined}>
            Failed: {progress.counts.failed}
          </span>
        </div>
        {(progress.runningUsernames.length > 0 || progress.queuedUsernames.length > 0) && (
          <div className="flex flex-wrap gap-3 text-xs">
            {progress.runningUsernames.length > 0 && (
              <span className="text-foreground">
                Running: {summarizeUserList(progress.runningUsernames)}
              </span>
            )}
            {progress.queuedUsernames.length > 0 && (
              <span className="text-muted-foreground">
                Queued: {summarizeUserList(progress.queuedUsernames)}
              </span>
            )}
          </div>
        )}
        {progress.cancelRequestedUsernames.length > 0 && (
          <div className="text-xs text-muted-foreground">
            Cancellation in progress for {summarizeUserList(progress.cancelRequestedUsernames)}. The current account will finish before stopping.
          </div>
        )}
        {progress.failedJobs.length > 0 && (
          <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="flex items-start gap-2">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
              <div>
                <p className="font-medium">Some accounts failed</p>
                <ul className="mt-1 space-y-1">
                  {progress.failedJobs.slice(0, 3).map((job, index) => (
                    <li key={`${job.username}-${index}`}>
                      {formatHandle(job.username)}
                      {job.reason ? ` — ${job.reason}` : ''}
                    </li>
                  ))}
                </ul>
                {progress.failedJobs.length > 3 && (
                  <p className="mt-1 text-[11px]">
                    +{progress.failedJobs.length - 3} more
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
