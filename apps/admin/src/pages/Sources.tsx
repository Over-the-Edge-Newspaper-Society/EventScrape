import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Sources() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Sources</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage scraping sources and modules
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Scraping Sources</CardTitle>
          <CardDescription>
            Configure and manage event sources
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon...</p>
        </CardContent>
      </Card>
    </div>
  )
}