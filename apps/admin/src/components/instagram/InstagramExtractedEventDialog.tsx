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
                  <div className="space-y-3">
                    {fields.map((field) => (
                      <div key={`${eventId}-${field.key}`} className="grid grid-cols-4 gap-4 border-b border-muted-foreground/10 pb-2 last:border-b-0 last:pb-0">
                        <div className="font-medium text-foreground">{field.label}:</div>
                        <div className="col-span-3 break-words text-sm">
                          {renderFieldValue(field)}
                        </div>
                      </div>
                    ))}
                  </div>
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

type FieldType = 'text' | 'link' | 'list' | 'multiline'

type FieldConfig = {
  key: string
  label: string
  value: string | string[] | null | undefined
  type?: FieldType
}

const buildFieldList = (event: ExtractedEventDetails): FieldConfig[] => {
  const seriesEntries =
    event.seriesDates?.map((range) => {
      const start = range?.start ?? 'Not provided'
      const end = range?.end
      return end ? `${start} → ${end}` : start
    }).filter(Boolean) ?? []

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
    { key: 'tags', label: 'Tags', value: event.tags },
    { key: 'url', label: 'Linked URL', value: event.url, type: 'link' },
    { key: 'registrationUrl', label: 'Registration URL', value: event.registrationUrl, type: 'link' },
    { key: 'contactEmail', label: 'Contact Email', value: event.contactInfo?.email },
    { key: 'contactPhone', label: 'Contact Phone', value: event.contactInfo?.phone },
    { key: 'contactWebsite', label: 'Website', value: event.contactInfo?.website, type: 'link' },
    { key: 'additionalInfo', label: 'Additional Info', value: event.additionalInfo, type: 'multiline' },
  ]
}

const renderFieldValue = (field: FieldConfig) => {
  const { value, type } = field

  if (value === undefined || value === null || (Array.isArray(value) && value.length === 0) || value === '') {
    return <span className="italic text-muted-foreground">Not provided</span>
  }

  if (type === 'link' && typeof value === 'string') {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        {value}
        <ExternalLink className="ml-1 inline h-3 w-3" />
      </a>
    )
  }

  if (type === 'list' && Array.isArray(value)) {
    return (
      <ul className="space-y-1">
        {value.map((entry, index) => (
          <li key={`${field.key}-${index}`} className="font-mono text-xs text-muted-foreground">
            {entry}
          </li>
        ))}
      </ul>
    )
  }

  if (type === 'multiline' && typeof value === 'string') {
    return <p className="whitespace-pre-wrap">{value}</p>
  }

  if (Array.isArray(value)) {
    return value.join(', ')
  }

  return value
}
