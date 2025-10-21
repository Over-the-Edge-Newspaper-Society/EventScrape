import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Database, Download, Upload, Trash2 } from 'lucide-react'

interface BackupFile {
  filename: string
  size: number
  createdAt: string
}

interface BackupTransferSectionProps {
  backups: BackupFile[] | undefined
  backupFile: File | null
  setBackupFile: (file: File | null) => void
  sqliteFile: File | null
  setSqliteFile: (file: File | null) => void
  createBackupPending: boolean
  createBackup: () => void
  handleRestoreBackup: () => void
  restoreBackupPending: boolean
  handleImportSqlite: () => void
  importSqlitePending: boolean
  handleDownloadBackup: (filename: string) => void
  handleDeleteBackup: (filename: string) => void
  deleteBackupPending: boolean
}

export function BackupTransferSection({
  backups,
  backupFile,
  setBackupFile,
  sqliteFile,
  setSqliteFile,
  createBackupPending,
  createBackup,
  handleRestoreBackup,
  restoreBackupPending,
  handleImportSqlite,
  importSqlitePending,
  handleDownloadBackup,
  handleDeleteBackup,
  deleteBackupPending,
}: BackupTransferSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Backup & Transfer
        </CardTitle>
        <CardDescription>
          Create backups or restore from previous backups
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Create & Download Backup Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-2">Create New Backup</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Creates and downloads a ZIP file with database data and cached Instagram images
            </p>
            <Button
              onClick={createBackup}
              disabled={createBackupPending}
              className="w-full sm:w-auto"
            >
              <Download className="h-4 w-4 mr-2" />
              {createBackupPending ? 'Creating Backup...' : 'Create & Download Backup'}
            </Button>
          </div>
        </div>

        <Separator />

        {/* Restore Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-2">Restore from Backup</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Upload a backup ZIP file to restore Instagram data
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="backup-file"
              type="file"
              accept=".zip"
              onChange={(e) => setBackupFile(e.target.files?.[0] || null)}
              className="flex-1"
            />
            <Button
              onClick={handleRestoreBackup}
              disabled={!backupFile || restoreBackupPending}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Upload className="h-4 w-4 mr-2" />
              {restoreBackupPending ? 'Restoring...' : 'Restore Backup'}
            </Button>
          </div>
        </div>

        <Separator />

        {/* Import from Old System Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-2">Import from Old Event-Monitor</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Import clubs and images from old Event-Monitor backup (ZIP) or SQLite database file
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              id="sqlite-file"
              type="file"
              accept=".db,.sqlite,.sqlite3,.zip"
              onChange={(e) => setSqliteFile(e.target.files?.[0] || null)}
              className="flex-1"
            />
            <Button
              onClick={handleImportSqlite}
              disabled={!sqliteFile || importSqlitePending}
              variant="outline"
              className="w-full sm:w-auto"
            >
              <Database className="h-4 w-4 mr-2" />
              {importSqlitePending ? 'Importing...' : 'Import Data'}
            </Button>
          </div>
        </div>

        <Separator />

        {/* Available Backups Section */}
        <div className="space-y-4">
          <div>
            <h3 className="text-sm font-semibold mb-2">Available Backups</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Download or delete previously created backups
            </p>
          </div>
          {backups && backups.length > 0 ? (
            <div className="space-y-2">
              {backups.map((backup) => (
                <div
                  key={backup.filename}
                  className="flex items-center justify-between p-3 border rounded-lg bg-muted/50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{backup.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {(backup.size / 1024 / 1024).toFixed(2)} MB • Created {new Date(backup.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownloadBackup(backup.filename)}
                      title="Download backup"
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDeleteBackup(backup.filename)}
                      disabled={deleteBackupPending}
                      className="text-destructive hover:bg-destructive hover:text-destructive-foreground"
                      title="Delete backup"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 border rounded-lg bg-muted/30">
              <Database className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No backups available</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create your first backup to get started
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
