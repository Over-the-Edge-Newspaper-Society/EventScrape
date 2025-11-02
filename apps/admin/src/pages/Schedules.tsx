import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrapeSchedules } from '@/components/schedules/ScrapeSchedules'
import { InstagramSchedules } from '@/components/schedules/InstagramSchedules'
import { WordPressSchedules } from '@/components/schedules/WordPressSchedules'
import { Play, Globe, Instagram } from 'lucide-react'

export function Schedules() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-foreground">Schedules</h1>
        <p className="text-muted-foreground">Automate scraping and WordPress exports with scheduled tasks</p>
      </div>

      <Tabs defaultValue="scrape" className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-3">
          <TabsTrigger value="scrape" className="flex items-center gap-2">
            <Play className="h-4 w-4" />
            Event Scraping
          </TabsTrigger>
          <TabsTrigger value="instagram" className="flex items-center gap-2">
            <Instagram className="h-4 w-4" />
            Instagram Scraping
          </TabsTrigger>
          <TabsTrigger value="wordpress" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            WordPress Export
          </TabsTrigger>
        </TabsList>
        <TabsContent value="scrape" className="mt-6">
          <ScrapeSchedules />
        </TabsContent>
        <TabsContent value="instagram" className="mt-6">
          <InstagramSchedules />
        </TabsContent>
        <TabsContent value="wordpress" className="mt-6">
          <WordPressSchedules />
        </TabsContent>
      </Tabs>
    </div>
  )
}
