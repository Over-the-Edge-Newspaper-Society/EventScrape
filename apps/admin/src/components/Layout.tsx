import { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  Calendar,
  Database,
  Download,
  GitMerge,
  Home,
  Play,
  Settings,
  Upload,
  Clock,
  Globe,
  HardDrive,
  Instagram
} from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'

interface LayoutProps {
  children: ReactNode
}

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Sources', href: '/sources', icon: Settings },
  { name: 'Instagram', href: '/instagram', icon: Instagram },
  { name: 'Raw Events', href: '/events/raw', icon: Database },
  { name: 'Canonical Events', href: '/events/canonical', icon: Calendar },
  { name: 'Matches', href: '/matches', icon: GitMerge },
  { name: 'Runs', href: '/runs', icon: Play },
  { name: 'Schedules', href: '/schedules', icon: Clock },
  { name: 'Poster Import', href: '/poster-import', icon: Upload },
  { name: 'Exports', href: '/exports', icon: Download },
  { name: 'WordPress', href: '/wordpress', icon: Globe },
  { name: 'Settings', href: '/settings', icon: HardDrive },
]

export function Layout({ children }: LayoutProps) {
  const location = useLocation()

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <div className="flex flex-col w-64 bg-card border-r border-border">
        <div className="flex items-center justify-between h-16 px-4 border-b border-border">
          <h1 className="text-xl font-bold text-foreground">
            Event Scraper
          </h1>
          <ThemeToggle />
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-2">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href
            const Icon = item.icon
            
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <Icon className="mr-3 h-5 w-5" />
                {item.name}
              </Link>
            )
          })}
        </nav>
        
        <div className="p-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            Event Scraper & Review System
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background">
          <div className="container mx-auto px-6 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
