import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { EventWithSource } from '@/lib/api'
import { SanitizedHtml } from '@/components/SanitizedHtml'

interface RawEventDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isLoading: boolean
  error: string | null
  rawEvent: EventWithSource | null
}

export function RawEventDetailsDialog({
  open,
  onOpenChange,
  isLoading,
  error,
  rawEvent,
}: RawEventDetailsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Raw Event Details</DialogTitle>
          <DialogDescription>
            View the original event record that was sent to WordPress.
          </DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
            Loading raw event...
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : rawEvent ? (
          <div className="space-y-4">
            <div>
              <p className="text-lg font-semibold">{rawEvent.event.title}</p>
              <p className="text-sm text-muted-foreground">
                Source: {rawEvent.source?.name ?? 'Unknown'}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
              <div>
                <p className="text-xs uppercase text-muted-foreground">Start</p>
                <p className="font-medium">
                  {new Date(rawEvent.event.startDatetime).toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">End</p>
                <p className="font-medium">
                  {rawEvent.event.endDatetime
                    ? new Date(rawEvent.event.endDatetime).toLocaleString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Venue</p>
                <p className="font-medium">{rawEvent.event.venueName || '—'}</p>
                {rawEvent.event.venueAddress && (
                  <p className="text-muted-foreground">{rawEvent.event.venueAddress}</p>
                )}
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">City</p>
                <p className="font-medium">{rawEvent.event.city || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Organizer</p>
                <p className="font-medium">{rawEvent.event.organizer || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">Category</p>
                <p className="font-medium">{rawEvent.event.category || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase text-muted-foreground">URL</p>
                {rawEvent.event.url ? (
                  <a
                    href={rawEvent.event.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline break-all"
                  >
                    {rawEvent.event.url}
                  </a>
                ) : (
                  <p className="font-medium">—</p>
                )}
              </div>
            </div>
            {rawEvent.event.descriptionHtml && (
              <div>
                <p className="text-xs uppercase text-muted-foreground mb-2">Description</p>
                <SanitizedHtml
                  html={rawEvent.event.descriptionHtml}
                  className="prose prose-sm max-w-none rounded-md border p-3"
                />
              </div>
            )}
            <div>
              <p className="text-xs uppercase text-muted-foreground mb-2">Raw Payload</p>
              <pre className="max-h-64 overflow-y-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(rawEvent.event.raw, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Select an event to see its raw record.</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
