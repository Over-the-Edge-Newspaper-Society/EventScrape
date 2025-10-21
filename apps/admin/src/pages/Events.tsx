import { Link, useLocation, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'

export function Events() {
  const location = useLocation()

  // If on /events exactly, show both tab options
  const isRawActive = location.pathname === '/events/raw'
  const isCanonicalActive = location.pathname === '/events/canonical'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Events</h1>
        <p className="text-muted-foreground">
          Browse and manage both raw and canonical events
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-border">
        <nav className="flex gap-4">
          <Link
            to="/events/raw"
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              isRawActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Raw Events
          </Link>
          <Link
            to="/events/canonical"
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 transition-colors",
              isCanonicalActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Canonical Events
          </Link>
        </nav>
      </div>

      {/* Tab Content */}
      <Outlet />
    </div>
  )
}
