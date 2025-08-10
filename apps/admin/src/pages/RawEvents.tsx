import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function RawEvents() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Raw Events</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Browse and filter scraped events
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Raw Event Data</CardTitle>
          <CardDescription>
            Events scraped directly from sources
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon...</p>
        </CardContent>
      </Card>
    </div>
  )
}