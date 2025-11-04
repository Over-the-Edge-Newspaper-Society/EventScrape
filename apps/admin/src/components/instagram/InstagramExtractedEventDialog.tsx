import { StructuredFieldList, type StructuredField } from '@/components/events/StructuredFieldList'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { ExtractedEventDetails } from './InstagramReviewUtils'
import { ExternalLink, Loader2, Sparkles } from 'lucide-react'

type InstagramExtractedEventDialogProps = {
  eventId: string
  dialogSubject?: string
  extractedEvents: ExtractedEventDetails[]
  isExtractPending: boolean
  onReextract: () => void
}

export function InstagramExtractedEventDialog({
  eventId,
  dialogSubject,
  extractedEvents,
  isExtractPending,
  onReextract,
}: InstagramExtractedEventDialogProps) {
  return (
    <>
      <Badge variant="secondary" className="flex items-center gap-1 text-xs">
        <Sparkles className="h-3 w-3" />
        Event data extracted
      </Badge>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            View extracted data
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Extracted event details</DialogTitle>
            <DialogDescription>
              {dialogSubject
                ? `Results generated for ${dialogSubject}`
                : 'Structured event data generated from this post'}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
            {extractedEvents.map((extracted, index) => {
              const fields = buildFieldList(extracted)

              return (
                <div key={`${eventId}-extracted-${index}`} className="space-y-4 rounded-md border p-4">
                  <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Event {index + 1}
                  </div>
                  <StructuredFieldList fields={fields} />
                  {extracted.url && (
                    <div className="flex items-center gap-2 text-xs">
                      <a
                        href={extracted.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        View original post
                        <ExternalLink className="ml-1 inline h-3 w-3" />
                      </a>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onReextract} disabled={isExtractPending} variant="outline" size="sm">
              {isExtractPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Re-extract
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const buildFieldList = (event: ExtractedEventDetails): StructuredField[] => {
  const seriesEntries =
    event.seriesDates?.map((range) => {
      const start = range?.start ?? 'Not provided'
      const end = range?.end
      return end ? `${start} → ${end}` : start
    }).filter(Boolean) ?? []

  const tagList = event.tags?.length ? event.tags.map((tag) => `#${tag}`) : undefined

  return [
    { key: 'title', label: 'Title', value: event.title },
    { key: 'description', label: 'Description', value: event.description, type: 'multiline' },
    { key: 'startDate', label: 'Start Date', value: event.startDate },
    { key: 'startTime', label: 'Start Time', value: event.startTime },
    { key: 'endDate', label: 'End Date', value: event.endDate },
    { key: 'endTime', label: 'End Time', value: event.endTime },
    { key: 'timezone', label: 'Timezone', value: event.timezone },
    { key: 'occurrenceType', label: 'Occurrence Type', value: event.occurrenceType },
    { key: 'recurrenceType', label: 'Recurrence Type', value: event.recurrenceType },
    { key: 'seriesDates', label: 'Series Dates', value: seriesEntries, type: 'list' },
    { key: 'venueName', label: 'Venue Name', value: event.venue?.name },
    { key: 'venueAddress', label: 'Venue Address', value: event.venue?.address },
    { key: 'venueCity', label: 'City', value: event.venue?.city },
    { key: 'venueRegion', label: 'Region', value: event.venue?.region },
    { key: 'venueCountry', label: 'Country', value: event.venue?.country },
    { key: 'organizer', label: 'Organizer', value: event.organizer },
    { key: 'category', label: 'Category', value: event.category },
    { key: 'price', label: 'Price', value: event.price },
    { key: 'tags', label: 'Tags', value: tagList, type: 'list' },
    { key: 'registrationUrl', label: 'Registration URL', value: event.registrationUrl, type: 'link' },
    { key: 'contactEmail', label: 'Contact Email', value: event.contactInfo?.email },
    { key: 'contactPhone', label: 'Contact Phone', value: event.contactInfo?.phone },
    { key: 'contactWebsite', label: 'Website', value: event.contactInfo?.website, type: 'link' },
    { key: 'additionalInfo', label: 'Additional Info', value: event.additionalInfo, type: 'multiline' },
  ]
}
