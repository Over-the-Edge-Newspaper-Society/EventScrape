import { ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  type LucideIcon,
  ChevronDown,
  Download,
  GitMerge,
  Home,
  Play,
  Settings,
  Upload,
  Clock,
  Globe,
  HardDrive,
  Instagram,
  CheckSquare,
  List
} from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'

interface LayoutProps {
  children: ReactNode
}

type NavigationChild = {
  name: string
  href: string
  icon?: LucideIcon
}

type NavigationItem = {
  name: string
  href: string
  icon: LucideIcon
  children?: NavigationChild[]
}

const navigation: NavigationItem[] = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Sources', href: '/sources', icon: Settings },
  {
    name: 'Instagram',
    href: '/instagram',
    icon: Instagram,
    children: [
      { name: 'Review', href: '/review', icon: CheckSquare },
      { name: 'Instagram Settings', href: '/instagram/settings', icon: Settings },
    ],
  },
  { name: 'Events', href: '/events', icon: List },
  { name: 'Matches', href: '/matches', icon: GitMerge },
  { name: 'Runs', href: '/runs', icon: Play },
  { name: 'Schedules', href: '/schedules', icon: Clock },
  { name: 'Poster Import', href: '/poster-import', icon: Upload },
  { name: 'Exports', href: '/exports', icon: Download },
  { name: 'WordPress', href: '/wordpress', icon: Globe },
  { name: 'Settings', href: '/settings', icon: HardDrive },
]

const isPathActive = (targetPath: string, currentPath: string) => {
  if (targetPath === '/') {
    return currentPath === '/'
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const [openSections, setOpenSections] = useState<string[]>(() =>
    navigation
      .filter((item) =>
        item.children?.some((child) => isPathActive(child.href, location.pathname))
      )
      .map((item) => item.name)
  )

  useEffect(() => {
    setOpenSections((previouslyOpen) => {
      const activeParents = navigation
        .filter((item) =>
          item.children?.some((child) => isPathActive(child.href, location.pathname))
        )
        .map((item) => item.name)

      if (activeParents.every((name) => previouslyOpen.includes(name))) {
        return previouslyOpen
      }

      return Array.from(new Set([...previouslyOpen, ...activeParents]))
    })
  }, [location.pathname])

  const toggleSection = (name: string) => {
    setOpenSections((current) =>
      current.includes(name)
        ? current.filter((itemName) => itemName !== name)
        : [...current, name]
    )
  }

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
            const hasChildren = Boolean(item.children?.length)
            const isActive =
              isPathActive(item.href, location.pathname) ||
              item.children?.some((child) => isPathActive(child.href, location.pathname))
            const Icon = item.icon

            return (
              <div key={item.name} className="space-y-1">
                <Link
                  to={item.href}
                  onClick={() => {
                    if (hasChildren) {
                      toggleSection(item.name)
                    }
                  }}
                  className={cn(
                    "flex items-center px-3 py-2 text-sm font-medium rounded-md transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  )}
                >
                  <Icon className="mr-3 h-5 w-5" />
                  <span className="flex-1">{item.name}</span>
                  {hasChildren && (
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 transition-transform",
                        openSections.includes(item.name) ? "rotate-0" : "-rotate-90"
                      )}
                    />
                  )}
                </Link>

                {hasChildren && openSections.includes(item.name) && (
                  <div className="ml-8 space-y-1">
                    {item.children?.map((child) => {
                      const ChildIcon = child.icon
                      const childIsActive = isPathActive(child.href, location.pathname)

                      return (
                        <Link
                          key={child.name}
                          to={child.href}
                          className={cn(
                            "flex items-center px-3 py-2 text-sm rounded-md transition-colors",
                            childIsActive
                              ? "bg-accent text-accent-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                          )}
                        >
                          {ChildIcon && <ChildIcon className="mr-3 h-4 w-4" />}
                          <span>{child.name}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
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
