import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Exports() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Exports</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Export events to various formats and WordPress
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Export History</CardTitle>
          <CardDescription>
            Generated exports and download links
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Coming soon...</p>
        </CardContent>
      </Card>
    </div>
  )
}