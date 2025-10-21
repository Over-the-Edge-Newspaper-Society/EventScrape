import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, Upload, Trash2, HardDrive } from 'lucide-react'
import { API_BASE_URL } from '@/lib/api'

interface Backup {
  filename: string
  size: number
  created: string
  modified: string
}

export function Settings() {
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const queryClient = useQueryClient()

  // Fetch available backups
  const { data: backupsData, isLoading: isLoadingBackups } = useQuery({
    queryKey: ['backups'],
    queryFn: async () => {
      const res = await fetch(`${API_BASE_URL}/database/backups`)
      if (!res.ok) throw new Error('Failed to fetch backups')
      return res.json() as Promise<{ backups: Backup[] }>
    },
  })

  // Export database mutation
  const exportMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/database/export`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to export database')
      return res.json()
    },
    onSuccess: (data) => {
      toast.success('Database exported successfully')
      queryClient.invalidateQueries({ queryKey: ['backups'] })
      // Trigger download
      if (data.filename) {
        window.open(`${API_BASE_URL}/database/export/${data.filename}`, '_blank')
      }
    },
    onError: (error: Error) => {
      toast.error(`Export failed: ${error.message}`)
    },
  })

  // Import database mutation
  const importMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`${API_BASE_URL}/database/import`, {
        method: 'POST',
        body: formData,
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.message || 'Failed to import database')
      }
      return res.json()
    },
    onSuccess: (data) => {
      if (data.restarting) {
        toast.success('Database imported successfully! Server is restarting to refresh connections. Page will reload in 5 seconds...')
        // Reload the page after server has had time to restart
        setTimeout(() => {
          window.location.reload()
        }, 5000)
      } else {
        toast.success('Database imported successfully')
      }
      setUploadFile(null)
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (error: Error) => {
      toast.error(`Import failed: ${error.message}`)
    },
  })

  // Delete backup mutation
  const deleteMutation = useMutation({
    mutationFn: async (filename: string) => {
      const res = await fetch(`${API_BASE_URL}/database/backups/${filename}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete backup')
      return res.json()
    },
    onSuccess: () => {
      toast.success('Backup deleted successfully')
      queryClient.invalidateQueries({ queryKey: ['backups'] })
    },
    onError: (error: Error) => {
      toast.error(`Delete failed: ${error.message}`)
    },
  })

  const handleExport = () => {
    exportMutation.mutate()
  }

  const handleImport = () => {
    if (!uploadFile) {
      toast.error('Please select a file to import')
      return
    }

    if (confirm('⚠️ Warning: This will replace your current database. Are you sure you want to continue?')) {
      importMutation.mutate(uploadFile)
    }
  }

  const handleDownload = (filename: string) => {
    window.open(`${API_BASE_URL}/database/export/${filename}`, '_blank')
  }

  const handleDelete = (filename: string) => {
    if (confirm(`Are you sure you want to delete backup: ${filename}?`)) {
      deleteMutation.mutate(filename)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleString()
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage database backups and system settings
        </p>
      </div>

      {/* Database Export/Import Section */}
      <Card className="p-6">
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <HardDrive className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-xl font-semibold">Database Backup & Restore</h2>
              <p className="text-sm text-muted-foreground">
                Export your database or restore from a backup file
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Export Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5" />
                <h3 className="font-semibold">Export Database</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Create a backup of your entire database. This will download a SQL file that you can use to restore your data later.
              </p>
              <Button
                onClick={handleExport}
                disabled={exportMutation.isPending}
                className="w-full"
              >
                {exportMutation.isPending ? 'Exporting...' : 'Export Database'}
              </Button>
            </div>

            {/* Import Section */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                <h3 className="font-semibold">Import Database</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Restore your database from a backup file. <strong>Warning:</strong> This will replace your current database.
              </p>
              <div className="space-y-2">
                <input
                  type="file"
                  accept=".sql"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                />
                <Button
                  onClick={handleImport}
                  disabled={!uploadFile || importMutation.isPending}
                  variant="destructive"
                  className="w-full"
                >
                  {importMutation.isPending ? 'Importing...' : 'Import Database'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Backup History Section */}
      <Card className="p-6">
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Backup History</h2>

          {isLoadingBackups ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading backups...
            </div>
          ) : backupsData?.backups.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No backups available
            </div>
          ) : (
            <div className="space-y-2">
              {backupsData?.backups.map((backup) => (
                <div
                  key={backup.filename}
                  className="flex items-center justify-between p-4 rounded-lg border border-border hover:bg-accent/50 transition-colors"
                >
                  <div className="flex-1">
                    <div className="font-medium">{backup.filename}</div>
                    <div className="text-sm text-muted-foreground">
                      Created: {formatDate(backup.created)} • Size: {formatBytes(backup.size)}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => handleDownload(backup.filename)}
                      variant="outline"
                      size="sm"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      onClick={() => handleDelete(backup.filename)}
                      variant="outline"
                      size="sm"
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
