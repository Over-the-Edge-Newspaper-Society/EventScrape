import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Instagram, Settings, Zap, Trash2 } from 'lucide-react'
import { InstagramSource } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'

type TabKey = 'active' | 'inactive' | 'all'

interface InstagramSourcesTableCardProps {
  isLoading: boolean
  sources: InstagramSource[]
  filteredSources: InstagramSource[]
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
  activeSources: number
  inactiveSources: number
  totalSources: number
  onEdit: (source: InstagramSource) => void
  onTrigger: (source: InstagramSource) => void
  onDelete: (source: InstagramSource) => void
  triggerPending: boolean
}

const getStatusBadge = (active: boolean) => {
  return (
    <Badge variant={active ? 'success' : 'secondary'}>
      {active ? 'Active' : 'Inactive'}
    </Badge>
  )
}

export function InstagramSourcesTableCard({
  isLoading,
  sources,
  filteredSources,
  activeTab,
  onTabChange,
  activeSources,
  inactiveSources,
  totalSources,
  onEdit,
  onTrigger,
  onDelete,
  triggerPending,
}: InstagramSourcesTableCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Configured Instagram Sources</CardTitle>
        <CardDescription>Instagram accounts configured for event scraping</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">Loading Instagram sources...</p>
          </div>
        ) : !sources.length ? (
          <div className="text-center py-8">
            <Instagram className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No Instagram sources configured</p>
            <p className="text-sm text-muted-foreground mt-2">
              Add your first Instagram account to begin scraping event posters
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="border-b border-border">
              <nav className="flex gap-4">
                {([
                  { key: 'active', label: `Active (${activeSources})` },
                  { key: 'inactive', label: `Inactive (${inactiveSources})` },
                  { key: 'all', label: `All (${totalSources})` },
                ] as Array<{ key: TabKey; label: string }>).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => onTabChange(key)}
                    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                      activeTab === key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            </div>

            {filteredSources.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground">No {activeTab} sources found</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Classification</TableHead>
                  <TableHead>Settings</TableHead>
                  <TableHead>Stats</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                  {filteredSources.map((source) => (
                    <TableRow key={source.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-medium text-sm">{source.name}</p>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Instagram className="h-3 w-3" />
                            <a
                              href={`https://instagram.com/${source.instagramUsername}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              @{source.instagramUsername}
                            </a>
                          </div>
                          {source.notes && (
                            <p className="text-xs text-muted-foreground">{source.notes}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={source.classificationMode === 'auto' ? 'default' : 'outline'}>
                          {source.classificationMode === 'auto' ? 'Auto' : 'Manual'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge
                            variant={source.instagramScraperType === 'apify' ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {source.instagramScraperType === 'apify' ? 'Apify' : 'Private API'}
                          </Badge>
                          <p className="text-xs text-muted-foreground">{source.defaultTimezone}</p>
                          <p className="text-xs text-muted-foreground">
                            Added {formatRelativeTime(source.createdAt)}
                          </p>
                          {source.lastChecked && (
                            <p className="text-xs text-muted-foreground">
                              Last checked {formatRelativeTime(source.lastChecked)}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-xs space-y-1">
                          <div>
                            <span className="font-semibold text-foreground">
                              {(source.postsCount ?? 0).toLocaleString()}
                            </span>{' '}
                            <span className="text-muted-foreground">posts pulled</span>
                          </div>
                          <div>
                            <span className="font-semibold text-foreground">
                              {(source.eventCount ?? 0).toLocaleString()}
                            </span>{' '}
                            <span className="text-muted-foreground">events created</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{getStatusBadge(source.active)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onEdit(source)}
                            className="flex items-center gap-1"
                          >
                            <Settings className="h-3 w-3" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!source.active || triggerPending}
                            onClick={() => onTrigger(source)}
                            className="flex items-center gap-1"
                          >
                            <Zap className="h-3 w-3" />
                            Scrape Now
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onDelete(source)}
                            className="flex items-center gap-1 text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
