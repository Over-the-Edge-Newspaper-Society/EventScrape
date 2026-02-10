import { ReactNode, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import {
  type LucideIcon,
  CheckSquare,
  ChevronDown,
  Clock,
  Download,
  GitMerge,
  Globe,
  HardDrive,
  Home,
  Instagram,
  List,
  Menu,
  Play,
  Settings,
  Upload,
  X,
} from 'lucide-react'
import { ThemeToggle } from '@/components/ThemeToggle'
import { systemSettingsApi } from '@/lib/api'

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

type SidebarContentProps = {
  navigationItems: NavigationItem[]
  currentPath: string
  openSections: string[]
  toggleSection: (name: string) => void
  onNavigate?: () => void
  onClose?: () => void
}

function SidebarContent({
  navigationItems,
  currentPath,
  openSections,
  toggleSection,
  onNavigate,
  onClose,
}: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between h-16 px-4 border-b border-border">
        <h1 className="text-xl font-bold text-foreground">
          Event Scraper
        </h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close navigation menu"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 px-4 py-4 space-y-2 overflow-y-auto">
        {navigationItems.map((item) => {
          const hasChildren = Boolean(item.children?.length)
          const isActive =
            isPathActive(item.href, currentPath) ||
            item.children?.some((child) => isPathActive(child.href, currentPath))
          const Icon = item.icon

          return (
            <div key={item.name} className="space-y-1">
              <Link
                to={item.href}
                onClick={() => {
                  if (hasChildren) {
                    toggleSection(item.name)
                  } else {
                    onNavigate?.()
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
                    const childIsActive = isPathActive(child.href, currentPath)

                    return (
                      <Link
                        key={child.name}
                        to={child.href}
                        onClick={() => {
                          onNavigate?.()
                        }}
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
  )
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation()
  const { data: systemSettings } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.get(),
    staleTime: 5 * 60 * 1000,
  })
  const posterImportEnabled = systemSettings?.posterImportEnabled ?? true
  const visibleNavigation = navigation.filter(
    (item) => item.href !== '/poster-import' || posterImportEnabled
  )
  const [openSections, setOpenSections] = useState<string[]>(() =>
    navigation
      .filter((item) =>
        item.children?.some((child) => isPathActive(child.href, location.pathname))
      )
      .map((item) => item.name)
  )
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

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

  useEffect(() => {
    setIsMobileSidebarOpen(false)
  }, [location.pathname])

  const toggleSection = (name: string) => {
    setOpenSections((current) =>
      current.includes(name)
        ? current.filter((itemName) => itemName !== name)
        : [...current, name]
    )
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col bg-card border-r border-border">
        <SidebarContent
          navigationItems={visibleNavigation}
          currentPath={location.pathname}
          openSections={openSections}
          toggleSection={toggleSection}
        />
      </aside>

      {/* Mobile sidebar */}
      <div
        className={cn(
          "fixed inset-0 z-40 lg:hidden",
          isMobileSidebarOpen ? "pointer-events-auto" : "pointer-events-none"
        )}
      >
        <div
          className={cn(
            "absolute inset-0 bg-black/50 transition-opacity",
            isMobileSidebarOpen ? "opacity-100" : "opacity-0"
          )}
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-hidden="true"
        />
        <aside
          className={cn(
            "relative h-full w-64 bg-card border-r border-border shadow-lg transition-transform duration-300",
            isMobileSidebarOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <SidebarContent
            navigationItems={visibleNavigation}
            currentPath={location.pathname}
            openSections={openSections}
            toggleSection={toggleSection}
            onNavigate={() => setIsMobileSidebarOpen(false)}
            onClose={() => setIsMobileSidebarOpen(false)}
          />
        </aside>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 h-16 px-4 border-b border-border bg-card lg:hidden">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            onClick={() => setIsMobileSidebarOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1 text-center text-base font-semibold text-foreground">
            Event Scraper
          </div>
          <ThemeToggle />
        </header>

        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-background">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
