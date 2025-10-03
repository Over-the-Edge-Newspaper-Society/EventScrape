import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { ThemeProvider } from '@/contexts/ThemeContext'
import { Layout } from '@/components/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { Sources } from '@/pages/Sources'
import { RawEvents } from '@/pages/RawEvents'
import { CanonicalEvents } from '@/pages/CanonicalEvents'
import { Matches } from '@/pages/Matches'
import { Exports } from '@/pages/Exports'
import { Runs } from '@/pages/Runs'
import { PosterImport } from '@/pages/PosterImport'
import { Schedules } from '@/pages/Schedules'
import { WordPressSettings } from '@/pages/WordPressSettings'
import { Settings } from '@/pages/Settings'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false,
    },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <Router>
          <div className="min-h-screen bg-background">
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/sources" element={<Sources />} />
                <Route path="/events/raw" element={<RawEvents />} />
                <Route path="/events/canonical" element={<CanonicalEvents />} />
                <Route path="/matches" element={<Matches />} />
                <Route path="/runs" element={<Runs />} />
                <Route path="/schedules" element={<Schedules />} />
                <Route path="/poster-import" element={<PosterImport />} />
                <Route path="/exports" element={<Exports />} />
                <Route path="/wordpress" element={<WordPressSettings />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </Layout>
            <Toaster richColors />
          </div>
        </Router>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
