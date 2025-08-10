import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Runs() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Scraper Runs</h1>
        <p className="text-gray-600 dark:text-gray-400">
          View scraper execution history and trigger new runs
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
          <CardDescription>
            Past and current scraper executions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon...</p>
        </CardContent>
      </Card>
    </div>
  )
}