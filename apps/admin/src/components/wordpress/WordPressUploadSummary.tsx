import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getUploadWarnings, summarizeWordPressUpload, type WordPressUploadResponse } from '../../../../../convex/lib/wordpressUploadResults'

export function WordPressUploadSummary({ response, onDismiss }: { response: WordPressUploadResponse; onDismiss: () => void }) {
  const summary = summarizeWordPressUpload(response.results)
  return (
    <Card aria-label="WordPress upload results">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle>WordPress upload results</CardTitle>
          <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss results</Button>
        </div>
        <CardDescription role="status">
          {summary.saved} saved · {summary.skipped} skipped · {summary.failed} failed · {summary.warned} with warnings
        </CardDescription>
        {summary.warned > 0 && <p className="text-sm">Some events have warnings. Review the details below before treating their imports as complete.</p>}
      </CardHeader>
      <CardContent>
        <ul className="max-h-96 space-y-4 overflow-y-auto" aria-label="Per-event upload results">
          {response.results.map(({ event, result }, index) => {
            const warnings = getUploadWarnings(result)
            const status = !result.success ? 'Failed' : result.action === 'skipped' ? 'Skipped' : warnings.length ? 'Saved with warnings' : 'Saved'
            return (
              <li key={`${event.id}-${index}`} className="rounded-md border p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{event.title}</span>
                  <Badge variant={!result.success ? 'destructive' : 'secondary'} className={result.success && warnings.length ? 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100' : undefined}>{status}</Badge>
                </div>
                {result.action === 'skipped' && <p className="text-sm text-muted-foreground">An existing event was kept. No image import was attempted.</p>}
                {result.media?.status === 'imported' && <p className="text-sm">Featured image imported.</p>}
                {result.error && <p className="text-sm text-destructive">{result.error}</p>}
                {warnings.length > 0 && (
                  <ul className="list-disc pl-5 text-sm text-amber-800 dark:text-amber-200">
                    {warnings.map((warning, i) => <li key={i}>{warning}</li>)}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
