import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { sourcesApi, runsApi, CreateSourceData, Source } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Plus, Settings, Play, Pause, ExternalLink, Globe, Clock, AlertTriangle, CheckCircle, Zap, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

interface SourceFormProps {
  source?: Source
  onClose: () => void
  onSave: (data: CreateSourceData) => void
}

function SourceForm({ source, onClose, onSave }: SourceFormProps) {
  const [formData, setFormData] = useState<CreateSourceData>({
    name: source?.name || '',
    baseUrl: source?.baseUrl || '',
    moduleKey: source?.moduleKey || '',
    active: source?.active ?? true,
    defaultTimezone: source?.defaultTimezone || 'America/Vancouver',
    notes: source?.notes || '',
    rateLimitPerMin: source?.rateLimitPerMin || 60,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
    onClose()
  }

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          {source ? 'Edit Source' : 'Add New Source'}
        </DialogTitle>
        <DialogDescription>
          Configure an event scraping source
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Source Name</label>
            <Input
              required
              placeholder="City of Prince George Events"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Module Key</label>
            <Input
              required
              placeholder="prince_george_ca"
              value={formData.moduleKey}
              onChange={(e) => setFormData(prev => ({ ...prev, moduleKey: e.target.value }))}
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Base URL</label>
          <Input
            required
            type="url"
            placeholder="https://www.princegeorge.ca"
            value={formData.baseUrl}
            onChange={(e) => setFormData(prev => ({ ...prev, baseUrl: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">Default Timezone</label>
            <Input
              placeholder="America/Vancouver"
              value={formData.defaultTimezone}
              onChange={(e) => setFormData(prev => ({ ...prev, defaultTimezone: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-sm font-medium">Rate Limit (per minute)</label>
            <Input
              type="number"
              min="1"
              max="300"
              value={formData.rateLimitPerMin}
              onChange={(e) => setFormData(prev => ({ ...prev, rateLimitPerMin: parseInt(e.target.value) }))}
            />
          </div>
        </div>

        <div>
          <label className="text-sm font-medium">Notes</label>
          <Input
            placeholder="Optional notes about this source"
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
          />
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="active"
            checked={formData.active}
            onChange={(e) => setFormData(prev => ({ ...prev, active: e.target.checked }))}
            className="rounded border-gray-300"
          />
          <label htmlFor="active" className="text-sm font-medium">
            Active (enable scraping for this source)
          </label>
        </div>

        <div className="flex justify-end space-x-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">
            {source ? 'Update Source' : 'Add Source'}
          </Button>
        </div>
      </form>
    </DialogContent>
  )
}

export function Sources() {
  const queryClient = useQueryClient()
  const [selectedSource, setSelectedSource] = useState<Source | null>(null)
  const [showForm, setShowForm] = useState(false)

  const { data: sources, isLoading } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.getAll(),
  })

  const createMutation = useMutation({
    mutationFn: (data: CreateSourceData) => sourcesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: CreateSourceData }) => sourcesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
    },
  })

  const triggerScrapeMutation = useMutation({
    mutationFn: (sourceKey: string) => runsApi.triggerScrape(sourceKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const syncSourcesMutation = useMutation({
    mutationFn: () => sourcesApi.sync(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sources'] })
      toast.success(`Sync completed: ${data.stats.created} created, ${data.stats.updated} updated, ${data.stats.deactivated} deactivated`)
    },
    onError: (error) => {
      toast.error(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    },
  })

  const handleSave = async (data: CreateSourceData) => {
    try {
      if (selectedSource) {
        await updateMutation.mutateAsync({ id: selectedSource.id, data })
      } else {
        await createMutation.mutateAsync(data)
      }
      setSelectedSource(null)
    } catch (error) {
      console.error('Save failed:', error)
    }
  }

  const handleTriggerScrape = async (source: Source) => {
    try {
      await triggerScrapeMutation.mutateAsync(source.moduleKey)
    } catch (error) {
      console.error('Scrape trigger failed:', error)
    }
  }

  const handleEdit = (source: Source) => {
    setSelectedSource(source)
    setShowForm(true)
  }

  const handleAdd = () => {
    setSelectedSource(null)
    setShowForm(true)
  }

  const handleSync = async () => {
    try {
      await syncSourcesMutation.mutateAsync()
    } catch (error) {
      console.error('Sync failed:', error)
    }
  }

  const getStatusBadge = (active: boolean) => {
    return (
      <Badge variant={active ? 'success' : 'secondary'}>
        {active ? (
          <>
            <CheckCircle className="h-3 w-3 mr-1" />
            Active
          </>
        ) : (
          <>
            <Pause className="h-3 w-3 mr-1" />
            Inactive
          </>
        )}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Sources</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Manage scraping sources and modules
        </p>
      </div>

      {/* Add Source */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Scraping Sources</h3>
              <p className="text-sm text-muted-foreground">
                Configure event sources and their scraping modules
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                onClick={handleSync} 
                variant="outline"
                disabled={syncSourcesMutation.isPending}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${syncSourcesMutation.isPending ? 'animate-spin' : ''}`} />
                {syncSourcesMutation.isPending ? 'Syncing...' : 'Sync Modules'}
              </Button>
              <Dialog open={showForm} onOpenChange={setShowForm}>
                <DialogTrigger asChild>
                  <Button onClick={handleAdd} className="flex items-center gap-2">
                    <Plus className="h-4 w-4" />
                    Add Source
                  </Button>
                </DialogTrigger>
              <SourceForm
                source={selectedSource || undefined}
                onClose={() => setShowForm(false)}
                onSave={handleSave}
              />
            </Dialog>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sources Table */}
      <Card>
        <CardHeader>
          <CardTitle>Configured Sources</CardTitle>
          <CardDescription>
            Event sources and their scraping configuration
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading sources...</p>
            </div>
          ) : !sources?.sources.length ? (
            <div className="text-center py-8">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No sources configured</p>
              <p className="text-sm text-muted-foreground mt-2">
                Add your first event source to begin scraping
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Module</TableHead>
                  <TableHead>Settings</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.sources.map((source) => (
                  <TableRow key={source.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-sm">{source.name}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Globe className="h-3 w-3" />
                          <a
                            href={source.baseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                          >
                            {new URL(source.baseUrl).hostname}
                          </a>
                        </div>
                        {source.notes && (
                          <p className="text-xs text-muted-foreground">{source.notes}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <Badge variant="outline" className="text-xs font-mono">
                          {source.moduleKey}
                        </Badge>
                        <p className="text-xs text-muted-foreground">
                          {source.defaultTimezone}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-xs">
                          <Clock className="h-3 w-3" />
                          {source.rateLimitPerMin}/min
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Added {formatRelativeTime(source.createdAt)}
                        </p>
                        {source.updatedAt !== source.createdAt && (
                          <p className="text-xs text-muted-foreground">
                            Updated {formatRelativeTime(source.updatedAt)}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(source.active)}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(source)}
                          className="flex items-center gap-1"
                        >
                          <Settings className="h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!source.active || triggerScrapeMutation.isPending}
                          onClick={() => handleTriggerScrape(source)}
                          className="flex items-center gap-1"
                        >
                          <Zap className="h-3 w-3" />
                          Scrape Now
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Module Information */}
      <Card>
        <CardHeader>
          <CardTitle>Available Modules</CardTitle>
          <CardDescription>
            Information about scraping modules
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2">prince_george_ca</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Scrapes events from City of Prince George's official events calendar
              </p>
              <div className="flex gap-2">
                <Badge variant="success" className="text-xs">Available</Badge>
                <Badge variant="outline" className="text-xs">Playwright</Badge>
              </div>
            </div>
            
            <div className="p-4 border rounded-lg">
              <h4 className="font-medium mb-2">example_com</h4>
              <p className="text-sm text-muted-foreground mb-2">
                Example module for testing and development purposes
              </p>
              <div className="flex gap-2">
                <Badge variant="success" className="text-xs">Available</Badge>
                <Badge variant="outline" className="text-xs">Test Module</Badge>
              </div>
            </div>
          </div>
          
          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-medium mb-2">Adding New Modules</h4>
            <p className="text-sm text-muted-foreground mb-2">
              To add a new scraping module:
            </p>
            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Create a new directory in <code>worker/src/modules/</code></li>
              <li>Implement the <code>ScraperModule</code> interface</li>
              <li>Add fixtures and tests</li>
              <li>Register the module key in your source configuration</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}