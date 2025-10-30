import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Download, CheckCircle, AlertCircle } from 'lucide-react'

interface InstagramApifyRunCardProps {
  runId: string
  onRunIdChange: (value: string) => void
  postLimit: number
  onPostLimitChange: (value: number) => void
  onImport: () => void
  isImporting: boolean
  successMessage: string | null
  errorMessage: string | null
}

export function InstagramApifyRunCard({
  runId,
  onRunIdChange,
  postLimit,
  onPostLimitChange,
  onImport,
  isImporting,
  successMessage,
  errorMessage,
}: InstagramApifyRunCardProps) {
  const trimmedRunId = runId.trim()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Load Existing Apify Run</CardTitle>
        <CardDescription>Import posts from a previous Apify Instagram scraping run</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-[2fr,auto] gap-3">
            <div>
              <Label htmlFor="apify-run-id">Apify Run ID</Label>
              <Input
                id="apify-run-id"
                type="text"
                value={runId}
                onChange={(event) => onRunIdChange(event.target.value)}
                placeholder="e.g., H8k9J2lP1A2B3C4D"
                className="w-full"
              />
            </div>
            <div>
              <Label htmlFor="apify-run-limit">Post Limit</Label>
              <Input
                id="apify-run-limit"
                type="number"
                min={1}
                max={100}
                value={postLimit}
                onChange={(event) => {
                  const parsed = parseInt(event.target.value, 10)
                  onPostLimitChange(Number.isNaN(parsed) ? 10 : parsed)
                }}
                className="w-full"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={onImport}
              disabled={isImporting || !trimmedRunId}
              className="flex items-center gap-2"
            >
              {isImporting ? (
                <Download className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {isImporting ? 'Importing...' : 'Import Posts'}
            </Button>
          </div>

          {successMessage && (
            <div className="flex items-start gap-2 text-sm text-green-600 bg-green-50 p-3 rounded-md">
              <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-start gap-2 text-sm text-red-600 bg-red-50 p-3 rounded-md">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
