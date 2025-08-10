import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function CanonicalEvents() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Canonical Events</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Review and manage merged events ready for export
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Canonical Events</CardTitle>
          <CardDescription>
            Deduplicated and reviewed events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon...</p>
        </CardContent>
      </Card>
    </div>
  )
}