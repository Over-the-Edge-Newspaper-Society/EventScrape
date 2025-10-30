import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { exportsApi, CreateExportData, API_BASE_URL } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Download, Plus, FileSpreadsheet, FileJson, Calendar as CalendarIcon, Globe, AlertCircle, ExternalLink, Clock } from 'lucide-react'
import { ExportWizard } from '@/components/exports/ExportWizard'
export function Exports() {
  const queryClient = useQueryClient()
  const [showWizard, setShowWizard] = useState(false)
  const [selectedExport, setSelectedExport] = useState<any | null>(null)
  const [showDetailsDialog, setShowDetailsDialog] = useState(false)

  const { data: exports, isLoading } = useQuery({
    queryKey: ['exports'],
    queryFn: () => exportsApi.getAll(),
  })

  const createExportMutation = useMutation({
    mutationFn: (data: CreateExportData) => exportsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports'] })
    },
  })

  const cancelExportMutation = useMutation({
    mutationFn: (id: string) => exportsApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exports'] })
    },
  })

  const handleExport = async (data: CreateExportData) => {
    try {
      await createExportMutation.mutateAsync(data)
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  const handleCancelExport = async (id: string) => {
    try {
      await cancelExportMutation.mutateAsync(id)
    } catch (error) {
      console.error('Cancel export failed:', error)
    }
  }

  const getFormatIcon = (format: string) => {
    const icons = {
      csv: FileSpreadsheet,
      json: FileJson,
      ics: CalendarIcon,
      'wp-rest': Globe,
    }
    const Icon = icons[format as keyof typeof icons] || FileSpreadsheet
    return <Icon className="h-4 w-4" />
  }

  const getStatusBadge = (status: string) => {
    let variant: 'success' | 'destructive' | 'default' = 'default';
    if (status === 'success') variant = 'success';
    else if (status === 'error') variant = 'destructive';

    const statusText = status.charAt(0).toUpperCase() + status.slice(1);

    return (
      <Badge variant={variant}>
        {status === 'processing' && <Clock className="h-3 w-3 mr-1 animate-spin" />}
        {statusText}
      </Badge>
    )
  }


  const getDownloadFilename = (id: string, format: string): string => {
    const timestamp = new Date().toISOString().split('T')[0];
    switch (format) {
      case 'csv': return `events-export-${timestamp}.csv`;
      case 'json': return `events-export-${timestamp}.json`;
      case 'wp-rest': return `events-wp-export-${timestamp}.json`;
      case 'ics': return `events-calendar-${timestamp}.ics`;
      default: return `export-${id}`;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Exports</h1>
        <p className="text-muted-foreground">
          Export canonical events to various formats and WordPress
        </p>
      </div>

      {/* Create New Export */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Create New Export</h3>
              <p className="text-sm text-muted-foreground">
                Export your canonical events to CSV, JSON, ICS, or directly to WordPress
              </p>
            </div>
            <Dialog open={showWizard} onOpenChange={setShowWizard}>
              <DialogTrigger asChild>
                <Button className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  New Export
                </Button>
              </DialogTrigger>
              <ExportWizard
                onClose={() => setShowWizard(false)}
                onExport={handleExport}
              />
            </Dialog>
          </div>
        </CardContent>
      </Card>

      {/* Export History */}
      <Card>
        <CardHeader>
          <CardTitle>Export History</CardTitle>
          <CardDescription>
            Generated exports and download links
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading exports...</p>
            </div>
          ) : !exports?.exports.length ? (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No exports yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                Create your first export using the button above
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Format</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.exports.map((row) => (
                  <TableRow key={row.export.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getFormatIcon(row.export.format)}
                        <span className="font-medium capitalize">
                          {row.export.format.toUpperCase()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.schedule ? (
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-blue-600" />
                          <div className="space-y-1">
                            <Badge variant="outline" className="text-xs">
                              Automated
                            </Badge>
                            {row.wordpressSettings && (
                              <div className="text-xs text-muted-foreground">
                                {row.wordpressSettings.name}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <Badge variant="secondary" className="text-xs">
                          Manual
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="text-sm font-medium">{formatRelativeTime(row.export.createdAt)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(row.export.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit'
                          })}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {row.export.itemCount} events
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(row.export.status)}
                      {row.export.status === 'error' && row.export.errorMessage && (
                        <p className="text-xs text-red-600 mt-1">
                          {row.export.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-2">
                        {row.export.status === 'processing' && (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="flex items-center gap-1 h-8"
                            onClick={() => handleCancelExport(row.export.id)}
                            disabled={cancelExportMutation.isPending}
                          >
                            <AlertCircle className="h-3 w-3" />
                            Cancel
                          </Button>
                        )}
                        {row.export.status === 'success' && row.export.filePath && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-1 h-8"
                            onClick={() => {
                              const downloadUrl = `${API_BASE_URL}/exports/${row.export.id}/download`;

                              // Create temporary anchor element to trigger download with proper filename
                              const link = document.createElement('a');
                              link.href = downloadUrl;
                              link.download = getDownloadFilename(row.export.id, row.export.format);
                              link.target = '_blank';
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                            }}
                          >
                            <Download className="h-3 w-3" />
                            Download
                          </Button>
                        )}
                        {row.export.format === 'wp-rest' && row.export.status === 'success' && (
                          <>
                            <div className="flex flex-col gap-1 text-xs">
                              {row.export.params?.wpResults ? (
                                <>
                                  <div className="flex items-center gap-2">
                                    <Badge variant="success" className="text-xs">
                                      ✓ {row.export.params.wpResults.createdCount || 0} created
                                    </Badge>
                                    {row.export.params.wpResults.skippedCount > 0 && (
                                      <Badge variant="outline" className="text-xs">
                                        ⊘ {row.export.params.wpResults.skippedCount} skipped
                                      </Badge>
                                    )}
                                    {row.export.params.wpResults.failedCount > 0 && (
                                      <Badge variant="destructive" className="text-xs">
                                        ✗ {row.export.params.wpResults.failedCount} failed
                                      </Badge>
                                    )}
                                  </div>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      setSelectedExport(row.export)
                                      setShowDetailsDialog(true)
                                    }}
                                  >
                                    View Details →
                                  </Button>
                                </>
                              ) : (
                                <Badge variant="secondary" className="text-xs">
                                  Uploaded to WordPress
                                </Badge>
                              )}
                            </div>
                          </>
                        )}
                        {row.export.status === 'error' && (
                          <Badge variant="destructive" className="text-xs">
                            Failed
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Export Formats Info */}
      <Card>
        <CardHeader>
          <CardTitle>Export Formats</CardTitle>
          <CardDescription>
            Choose the right format for your needs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <FileSpreadsheet className="h-5 w-5 text-green-600" />
                <h4 className="font-medium">CSV</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Perfect for Excel and WordPress imports via WP All Import plugin
              </p>
            </div>
            
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <FileJson className="h-5 w-5 text-blue-600" />
                <h4 className="font-medium">JSON</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Machine-readable format for custom integrations and APIs
              </p>
            </div>
            
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <CalendarIcon className="h-5 w-5 text-purple-600" />
                <h4 className="font-medium">ICS</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Calendar format compatible with Google Calendar, Outlook, etc.
              </p>
            </div>
            
            <div className="p-4 border rounded-lg">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="h-5 w-5 text-indigo-600" />
                <h4 className="font-medium">WordPress</h4>
              </div>
              <p className="text-sm text-muted-foreground">
                Direct upload to WordPress via REST API (requires setup)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* WordPress Export Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 scrollbar-track-gray-200 dark:scrollbar-track-gray-800">
          <DialogHeader>
            <DialogTitle>WordPress Export Details</DialogTitle>
            <DialogDescription>
              Detailed results from WordPress upload
            </DialogDescription>
          </DialogHeader>

          {selectedExport?.params?.wpResults && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {selectedExport.params.wpResults.createdCount || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Created</div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-blue-600">
                        {selectedExport.params.wpResults.updatedCount || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Updated</div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-600">
                        {selectedExport.params.wpResults.skippedCount || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Skipped</div>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">
                        {selectedExport.params.wpResults.failedCount || 0}
                      </div>
                      <div className="text-sm text-muted-foreground">Failed</div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Detailed Results Table */}
              <div>
                <h3 className="font-semibold mb-2">Event-by-Event Results</h3>
                <div className="border dark:border-gray-700 rounded-lg overflow-hidden max-h-96 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-400 dark:scrollbar-thumb-gray-600 scrollbar-track-gray-200 dark:scrollbar-track-gray-800">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event Title</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>WordPress Link</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedExport.params.wpResults.results.map((result: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="max-w-md">
                            <div className="truncate" title={result.eventTitle}>
                              {result.eventTitle}
                            </div>
                          </TableCell>
                          <TableCell>
                            {result.success ? (
                              <Badge variant={
                                result.action === 'created' ? 'success' :
                                result.action === 'updated' ? 'default' :
                                'outline'
                              }>
                                {result.action === 'created' && '✓ Created'}
                                {result.action === 'updated' && '↻ Updated'}
                                {result.action === 'skipped' && '⊘ Skipped (exists)'}
                              </Badge>
                            ) : (
                              <Badge variant="destructive">✗ Failed</Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            {result.postUrl ? (
                              <a
                                href={result.postUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline flex items-center gap-1"
                              >
                                View in WordPress
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : result.error ? (
                              <span className="text-xs text-red-600">{result.error}</span>
                            ) : (
                              <span className="text-muted-foreground text-xs">-</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}