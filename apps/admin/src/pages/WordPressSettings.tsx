import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog'
import { formatRelativeTime } from '@/lib/utils'
import { wordpressApi, type WordPressSettings, type NewWordPressSettings } from '@/lib/api'
import { Plus, Settings, Trash2, CheckCircle2, XCircle, TestTube2 } from 'lucide-react'
import { toast } from 'sonner'

function SettingsDialog({
  setting,
  onClose
}: {
  setting?: WordPressSettings
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<NewWordPressSettings>({
    name: setting?.name || '',
    siteUrl: setting?.siteUrl || '',
    username: setting?.username || '',
    applicationPassword: '',
    active: setting?.active ?? true,
  })

  const createMutation = useMutation({
    mutationFn: wordpressApi.createSetting,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wordpress-settings'] })
      toast.success('WordPress settings created successfully')
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<NewWordPressSettings>) =>
      wordpressApi.updateSetting(setting!.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wordpress-settings'] })
      toast.success('WordPress settings updated successfully')
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (setting) {
      // Only include password if it was changed
      const updateData = formData.applicationPassword
        ? formData
        : { ...formData, applicationPassword: undefined }
      updateMutation.mutate(updateData)
    } else {
      createMutation.mutate(formData)
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>
          {setting ? 'Edit WordPress Settings' : 'Add WordPress Settings'}
        </DialogTitle>
        <DialogDescription>
          Configure your WordPress site connection. You'll need an application password from WordPress.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            placeholder="My WordPress Site"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="siteUrl">Site URL</Label>
          <Input
            id="siteUrl"
            type="text"
            placeholder="http://host.docker.internal:10003"
            value={formData.siteUrl}
            onChange={(e) => setFormData({ ...formData, siteUrl: e.target.value })}
            required
          />
          <p className="text-xs text-muted-foreground">
            <strong>For local WordPress:</strong> Use <code className="px-1 py-0.5 bg-muted rounded">http://host.docker.internal:10003</code>
            <br />
            <strong>For remote WordPress:</strong> Use full URL like <code className="px-1 py-0.5 bg-muted rounded">https://yoursite.com</code>
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            placeholder="admin"
            value={formData.username}
            onChange={(e) => setFormData({ ...formData, username: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Application Password</Label>
          <Input
            id="password"
            type="password"
            placeholder={setting ? 'Leave blank to keep current' : 'em3W id3v iPDq 9FBH coan dtAf'}
            value={formData.applicationPassword}
            onChange={(e) => setFormData({ ...formData, applicationPassword: e.target.value })}
            required={!setting}
          />
          <p className="text-xs text-muted-foreground">
            Generate this in WordPress under Users → Profile → Application Passwords
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <input
            type="checkbox"
            id="active"
            checked={formData.active}
            onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
            className="rounded border-gray-300"
          />
          <Label htmlFor="active">Active</Label>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {createMutation.isPending || updateMutation.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

export function WordPressSettings() {
  const queryClient = useQueryClient()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selectedSetting, setSelectedSetting] = useState<WordPressSettings | undefined>()

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['wordpress-settings'],
    queryFn: wordpressApi.getSettings,
  })

  const settings = settingsData?.settings

  const deleteMutation = useMutation({
    mutationFn: wordpressApi.deleteSetting,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wordpress-settings'] })
      toast.success('WordPress settings deleted')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const testMutation = useMutation({
    mutationFn: wordpressApi.testConnection,
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Connection test successful!')
      } else {
        toast.error(result.error || 'Connection test failed')
      }
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleEdit = (setting: WordPressSettings) => {
    setSelectedSetting(setting)
    setDialogOpen(true)
  }

  const handleAdd = () => {
    setSelectedSetting(undefined)
    setDialogOpen(true)
  }

  const handleClose = () => {
    setDialogOpen(false)
    setSelectedSetting(undefined)
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5" />
                WordPress Settings
              </CardTitle>
              <CardDescription>
                Manage your WordPress site connections for direct event uploads
              </CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={handleAdd}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add WordPress Site
                </Button>
              </DialogTrigger>
              <SettingsDialog setting={selectedSetting} onClose={handleClose} />
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center p-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : settings && settings.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Site URL</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {settings.map((setting) => (
                  <TableRow key={setting.id}>
                    <TableCell className="font-medium">{setting.name}</TableCell>
                    <TableCell className="font-mono text-sm">{setting.siteUrl}</TableCell>
                    <TableCell>{setting.username}</TableCell>
                    <TableCell>
                      {setting.active ? (
                        <Badge variant="default" className="gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="gap-1">
                          <XCircle className="h-3 w-3" />
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{formatRelativeTime(setting.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => testMutation.mutate(setting.id)}
                          disabled={testMutation.isPending}
                        >
                          <TestTube2 className="h-4 w-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEdit(setting)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteMutation.mutate(setting.id)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="text-center py-12">
              <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">
                No WordPress sites configured yet
              </p>
              <Button onClick={handleAdd}>
                <Plus className="h-4 w-4 mr-2" />
                Add Your First WordPress Site
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
