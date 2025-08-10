import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Matches() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Duplicate Matches</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Review and resolve potential duplicate events
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Potential Duplicates</CardTitle>
          <CardDescription>
            Events that might be duplicates based on similarity
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon...</p>
        </CardContent>
      </Card>
    </div>
  )
}