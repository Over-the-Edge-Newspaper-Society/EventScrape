import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { EventWithSource } from '@/lib/api'
import { Database, Eye, Code, Repeat, Calendar, Clock, ExternalLink } from 'lucide-react'

interface EventDetailDialogProps {
  event: EventWithSource
  children: React.ReactNode
}

export function EventDetailDialog({ event, children }: EventDetailDialogProps) {
  const eventData = event.event
  const sourceData = event.source

  // Helper function to extract series dates from raw data
  const getSeriesDates = (rawData: any) => {
    if (rawData?.seriesDates && Array.isArray(rawData.seriesDates)) {
      return rawData.seriesDates as Array<{ start: string, end?: string }>
    }
    return []
  }

  const seriesDates = getSeriesDates(eventData.raw)
  const isSeriesEvent = seriesDates.length > 1

  const formatFieldValue = (value: any, fieldName: string) => {
    if (value === null || value === undefined) {
      return <span className="text-muted-foreground italic">Not provided</span>
    }

    if (fieldName === 'startDatetime' || fieldName === 'endDatetime' || fieldName === 'scrapedAt') {
      // For Prince George events, display in Pacific Time instead of converting to browser's timezone
      const date = new Date(value)
      const options: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/Vancouver' // Pacific Time for Prince George, BC
      }
      return date.toLocaleString('en-US', options)
    }

    if (fieldName === 'tags' && Array.isArray(value)) {
      return value.length > 0 ? value.join(', ') : <span className="text-muted-foreground italic">None</span>
    }

    if (fieldName === 'descriptionHtml' && value) {
      return (
        <div className="max-h-40 overflow-y-auto">
          <div dangerouslySetInnerHTML={{ __html: value }} className="prose prose-sm max-w-none" />
        </div>
      )
    }

    return String(value)
  }

  const structuredFields = [
    { key: 'id', label: 'Event ID', value: eventData.id },
    { key: 'sourceEventId', label: 'Source Event ID', value: eventData.sourceEventId },
    { key: 'title', label: 'Title', value: eventData.title },
    { key: 'descriptionHtml', label: 'Description', value: eventData.descriptionHtml },
    { key: 'startDatetime', label: 'Start Date/Time', value: eventData.startDatetime },
    { key: 'endDatetime', label: 'End Date/Time', value: eventData.endDatetime },
    { key: 'timezone', label: 'Timezone', value: eventData.timezone },
    { key: 'venueName', label: 'Venue Name', value: eventData.venueName },
    { key: 'venueAddress', label: 'Venue Address', value: eventData.venueAddress },
    { key: 'city', label: 'City', value: eventData.city },
    { key: 'region', label: 'Region', value: eventData.region },
    { key: 'country', label: 'Country', value: eventData.country },
    { key: 'lat', label: 'Latitude', value: eventData.lat },
    { key: 'lon', label: 'Longitude', value: eventData.lon },
    { key: 'organizer', label: 'Organizer', value: eventData.organizer },
    { key: 'category', label: 'Category', value: eventData.category },
    { key: 'price', label: 'Price', value: eventData.price },
    { key: 'tags', label: 'Tags', value: eventData.tags },
    { key: 'url', label: 'URL', value: eventData.url },
    { key: 'imageUrl', label: 'Image URL', value: eventData.imageUrl },
    { key: 'scrapedAt', label: 'Scraped At', value: eventData.scrapedAt },
    { key: 'lastSeenAt', label: 'Last Seen At', value: (eventData as any).lastSeenAt },
    { key: 'contentHash', label: 'Content Hash', value: eventData.contentHash },
  ]

  return (
    <Dialog>
      {children}
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Raw Event Details
          </DialogTitle>
          <DialogDescription>
            Complete scraped data from {sourceData.name}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="structured" className="flex-1 overflow-hidden">
          <TabsList className={`grid w-full ${isSeriesEvent ? 'grid-cols-4' : 'grid-cols-3'}`}>
            <TabsTrigger value="structured" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Structured View
            </TabsTrigger>
            {isSeriesEvent && (
              <TabsTrigger value="series" className="flex items-center gap-2">
                <Repeat className="h-4 w-4" />
                Series ({seriesDates.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="raw" className="flex items-center gap-2">
              <Code className="h-4 w-4" />
              Raw JSON
            </TabsTrigger>
            <TabsTrigger value="source" className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              Source Info
            </TabsTrigger>
          </TabsList>

          <TabsContent value="structured" className="overflow-hidden">
            <div className="h-[60vh] overflow-y-auto">
              <div className="space-y-4 pr-4">
                {structuredFields.map(({ key, label, value }) => (
                  <div key={key} className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                    <div className="font-medium text-foreground">{label}:</div>
                    <div className="col-span-3 break-words">
                      {key === 'url' || key === 'imageUrl' ? (
                        value ? (
                          <a
                            href={String(value)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline flex items-center gap-1"
                          >
                            {String(value)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-muted-foreground italic">Not provided</span>
                        )
                      ) : (
                        formatFieldValue(value, key)
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {isSeriesEvent && (
            <TabsContent value="series" className="overflow-hidden">
              <div className="h-[60vh] overflow-y-auto">
                <div className="space-y-4 pr-4">
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-medium mb-2">
                      <Repeat className="h-4 w-4" />
                      Event Series Information
                    </div>
                    <p className="text-blue-600 dark:text-blue-400 text-sm">
                      This event occurs {seriesDates.length} times as part of a recurring series.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {seriesDates.map((dateInfo, index) => {
                      const startDate = new Date(dateInfo.start)
                      const endDate = dateInfo.end ? new Date(dateInfo.end) : null
                      const isCurrentInstance = dateInfo.start === eventData.startDatetime

                      return (
                        <div
                          key={index}
                          className={`border rounded-lg p-4 ${
                            isCurrentInstance
                              ? 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800'
                              : 'bg-gray-50 dark:bg-gray-900/50 border-gray-200 dark:border-gray-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${
                                isCurrentInstance ? 'bg-green-500 dark:bg-green-400' : 'bg-gray-400 dark:bg-gray-500'
                              }`} />
                              <div>
                                <div className="flex items-center gap-2">
                                  <Calendar className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                                  <span className="font-medium">
                                    {startDate.toLocaleDateString('en-US', {
                                      weekday: 'long',
                                      year: 'numeric',
                                      month: 'long',
                                      day: 'numeric'
                                    })}
                                  </span>
                                  {isCurrentInstance && (
                                    <Badge variant="success" className="text-xs ml-2">
                                      Current Instance
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                  <Clock className="h-3 w-3 text-gray-400 dark:text-gray-500" />
                                  <span className="text-sm text-gray-600 dark:text-gray-300">
                                    {startDate.toLocaleTimeString('en-US', {
                                      hour: 'numeric',
                                      minute: '2-digit',
                                      hour12: true,
                                      timeZone: 'America/Vancouver'
                                    })}
                                    {endDate && (
                                      <>
                                        {' - '}
                                        {endDate.toLocaleTimeString('en-US', {
                                          hour: 'numeric',
                                          minute: '2-digit',
                                          hour12: true,
                                          timeZone: 'America/Vancouver'
                                        })}
                                      </>
                                    )}
                                    <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">(Pacific Time)</span>
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                Instance {index + 1} of {seriesDates.length}
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </TabsContent>
          )}

          <TabsContent value="raw" className="overflow-hidden">
            <div className="h-[60vh] overflow-y-auto">
              <pre className="bg-muted p-4 rounded-md text-sm overflow-x-auto">
                <code>{JSON.stringify(eventData.raw, null, 2)}</code>
              </pre>
            </div>
          </TabsContent>

          <TabsContent value="source" className="overflow-hidden">
            <div className="h-[60vh] overflow-y-auto">
              <div className="space-y-4 pr-4">
                <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                  <div className="font-medium text-foreground">Source ID:</div>
                  <div className="col-span-3">{sourceData.id}</div>
                </div>
                <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                  <div className="font-medium text-foreground">Source Name:</div>
                  <div className="col-span-3">{sourceData.name}</div>
                </div>
                <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                  <div className="font-medium text-foreground">Module Key:</div>
                  <div className="col-span-3 font-mono text-sm">{sourceData.moduleKey}</div>
                </div>
                {sourceData.baseUrl && (
                  <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                    <div className="font-medium text-foreground">Base URL:</div>
                    <div className="col-span-3">
                      <a
                        href={sourceData.baseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline flex items-center gap-1"
                      >
                        {sourceData.baseUrl}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                  <div className="font-medium text-foreground">Run ID:</div>
                  <div className="col-span-3 font-mono text-sm">{eventData.runId}</div>
                </div>
                <div className="grid grid-cols-4 gap-4 py-2 border-b border-gray-100">
                  <div className="font-medium text-foreground">Last Updated By Run ID:</div>
                  <div className="col-span-3 font-mono text-sm">{(eventData as any).lastUpdatedByRunId || <span className="text-muted-foreground italic">Never updated</span>}</div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
