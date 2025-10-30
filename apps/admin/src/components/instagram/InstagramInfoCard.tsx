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
              1. Upload Instagram Session
            </h4>
            <p className="text-sm text-muted-foreground">
              Export your Instagram session cookies and upload them using the &quot;Upload Session&quot; button.
              This allows the scraper to access Instagram posts without logging in repeatedly.
            </p>
          </div>

          <div className="p-4 border rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Instagram className="h-4 w-4" />
              2. Configure Instagram Account
            </h4>
            <p className="text-sm text-muted-foreground">
              Add the Instagram username you want to scrape. Choose between manual mode (scrape all posts) or auto mode
              (AI classifies which posts contain events).
            </p>
          </div>

          <div className="p-4 border rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              3. Trigger Scraping
            </h4>
            <p className="text-sm text-muted-foreground">
              Click &quot;Scrape Now&quot; to fetch recent posts. The system will download images and use Gemini AI to
              extract event details from poster images.
            </p>
          </div>
        </div>

        <div className="mt-4 p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium mb-2">Classification Modes</h4>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>
              <strong>Manual:</strong> Scrapes all posts and extracts events from each image (slower, more thorough)
            </li>
            <li>
              <strong>Auto:</strong> Uses keyword detection to identify event posts before extraction (faster, may miss
              some events)
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}
