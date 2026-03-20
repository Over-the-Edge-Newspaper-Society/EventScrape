import { lazy, Suspense } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'

import { ThemeProvider } from '@/contexts/ThemeContext'
import { Layout } from '@/components/Layout'

const Dashboard = lazy(() => import('@/pages/Dashboard').then((module) => ({ default: module.Dashboard })))
const Sources = lazy(() => import('@/pages/Sources').then((module) => ({ default: module.Sources })))
const InstagramSources = lazy(() =>
  import('@/pages/InstagramSources').then((module) => ({ default: module.InstagramSources }))
)
const Events = lazy(() => import('@/pages/Events').then((module) => ({ default: module.Events })))
const InstagramReview = lazy(() =>
  import('@/pages/InstagramReview').then((module) => ({ default: module.InstagramReview }))
)
const RawEvents = lazy(() => import('@/pages/RawEvents').then((module) => ({ default: module.RawEvents })))
const CanonicalEvents = lazy(() =>
  import('@/pages/CanonicalEvents').then((module) => ({ default: module.CanonicalEvents }))
)
const Matches = lazy(() => import('@/pages/Matches').then((module) => ({ default: module.Matches })))
const Exports = lazy(() => import('@/pages/Exports').then((module) => ({ default: module.Exports })))
const Runs = lazy(() => import('@/pages/Runs').then((module) => ({ default: module.Runs })))
const PosterImport = lazy(() =>
  import('@/pages/PosterImport').then((module) => ({ default: module.PosterImport }))
)
const Schedules = lazy(() => import('@/pages/Schedules').then((module) => ({ default: module.Schedules })))
const WordPressSettings = lazy(() =>
  import('@/pages/WordPressSettings').then((module) => ({ default: module.WordPressSettings }))
)
const Settings = lazy(() => import('@/pages/Settings').then((module) => ({ default: module.Settings })))

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
              <Suspense
                fallback={
                  <div className="py-20 text-center">
                    <p className="text-muted-foreground">Loading page...</p>
                  </div>
                }
              >
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/sources" element={<Sources />} />
                  <Route path="/instagram" element={<InstagramSources />} />
                  <Route path="/instagram/settings" element={<Navigate to="/settings" replace />} />
                  <Route path="/events" element={<Events />}>
                    <Route index element={<Navigate to="/events/raw" replace />} />
                    <Route path="raw" element={<RawEvents />} />
                    <Route path="canonical" element={<CanonicalEvents />} />
                  </Route>
                  <Route path="/review" element={<InstagramReview />} />
                  <Route path="/matches" element={<Matches />} />
                  <Route path="/runs" element={<Runs />} />
                  <Route path="/schedules" element={<Schedules />} />
                  <Route path="/poster-import" element={<PosterImport />} />
                  <Route path="/exports" element={<Exports />} />
                  <Route path="/wordpress" element={<WordPressSettings />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Suspense>
            </Layout>
            <Toaster richColors />
          </div>
        </Router>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
