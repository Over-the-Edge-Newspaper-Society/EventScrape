import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Upload, Instagram, Zap } from 'lucide-react'

export function InstagramInfoCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>How Instagram Scraping Works</CardTitle>
        <CardDescription>Understanding the Instagram event extraction process</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="p-4 border rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Upload className="h-4 w-4" />
              1. Configure Scraper Access
            </h4>
            <p className="text-sm text-muted-foreground">
              Configure an Apify token in Settings, or upload an Instagram session when using the private API scraper.
            </p>
          </div>

          <div className="p-4 border rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Instagram className="h-4 w-4" />
              2. Configure Instagram Account
            </h4>
            <p className="text-sm text-muted-foreground">
              Add the Instagram username and choose manual review or automatic classification.
              The post limit controls how many recent posts are fetched.
            </p>
          </div>

          <div className="p-4 border rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              3. Trigger Scraping
            </h4>
            <p className="text-sm text-muted-foreground">
              Click &quot;Scrape Now&quot; or enable a schedule to fetch recent posts and store images.
              AI actions use the provider and model selected in Settings.
            </p>
          </div>
        </div>

        <div className="mt-4 p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium mb-2">Classification Modes</h4>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>
              <strong>Manual:</strong> Saves posts and images in the review queue. Classification and event extraction require a review action.
            </li>
            <li>
              <strong>Auto:</strong> Classifies posts using the configured AI provider when enabled, otherwise keywords.
              Automatic extraction runs only for posts classified as events when enabled.
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
