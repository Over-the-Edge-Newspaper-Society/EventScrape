import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { exportsApi, CreateExportData } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Download, Plus, FileSpreadsheet, FileJson, Calendar as CalendarIcon, Globe, Settings, AlertCircle } from 'lucide-react'

interface ExportWizardProps {
  onClose: () => void
  onExport: (data: CreateExportData) => void
}

function ExportWizard({ onClose, onExport }: ExportWizardProps) {
  const [step, setStep] = useState(1)
  const [exportData, setExportData] = useState<CreateExportData>({
    format: 'csv',
    filters: {},
    fieldMap: {},
  })

  const handleNext = () => {
    if (step < 3) {
      setStep(step + 1)
    } else {
      onExport(exportData)
      onClose()
    }
  }

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1)
    }
  }

  const formatOptions = [
    {
      value: 'csv',
      label: 'CSV (Excel/WP All Import)',
      icon: FileSpreadsheet,
      description: 'Comma-separated values, perfect for importing into WordPress',
    },
    {
      value: 'json',
      label: 'JSON (API/Custom)',
      icon: FileJson,
      description: 'Machine-readable format for custom integrations',
    },
    {
      value: 'ics',
      label: 'ICS (Calendar)',
      icon: CalendarIcon,
      description: 'iCalendar format for calendar applications',
    },
    {
      value: 'wp-rest',
      label: 'WordPress REST API',
      icon: Globe,
      description: 'Direct upload to WordPress via REST API',
    },
  ]

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Export Wizard
        </DialogTitle>
        <DialogDescription>
          Step {step} of 3: Configure your export
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6">
        {/* Step 1: Format Selection */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Choose Export Format</h3>
            <div className="grid gap-3">
              {formatOptions.map((option) => {
                const Icon = option.icon
                return (
                  <div
                    key={option.value}
                    className={`p-4 border rounded-lg cursor-pointer transition-colors ${
                      exportData.format === option.value
                        ? 'border-primary bg-primary/5'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => setExportData(prev => ({ ...prev, format: option.value as any }))}
                  >
                    <div className="flex items-start gap-3">
                      <Icon className="h-5 w-5 mt-0.5" />
                      <div>
                        <h4 className="font-medium">{option.label}</h4>
                        <p className="text-sm text-muted-foreground">{option.description}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Step 2: Filters */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Apply Filters</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Start Date</label>
                <Input
                  type="date"
                  value={exportData.filters?.startDate || ''}
                  onChange={(e) =>
                    setExportData(prev => ({
                      ...prev,
                      filters: { ...prev.filters, startDate: e.target.value || undefined },
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium">End Date</label>
                <Input
                  type="date"
                  value={exportData.filters?.endDate || ''}
                  onChange={(e) =>
                    setExportData(prev => ({
                      ...prev,
                      filters: { ...prev.filters, endDate: e.target.value || undefined },
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium">City</label>
                <Input
                  placeholder="Filter by city"
                  value={exportData.filters?.city || ''}
                  onChange={(e) =>
                    setExportData(prev => ({
                      ...prev,
                      filters: { ...prev.filters, city: e.target.value || undefined },
                    }))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={exportData.filters?.status || 'all'}
                  onValueChange={(value) =>
                    setExportData(prev => ({
                      ...prev,
                      filters: {
                        ...prev.filters,
                        status: value === 'all' ? undefined : (value as any),
                      },
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="ready">Ready</SelectItem>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="exported">Exported</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Field Mapping (for CSV/WordPress) */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Field Mapping</h3>
            {exportData.format === 'csv' || exportData.format === 'wp-rest' ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Map event fields to {exportData.format === 'csv' ? 'CSV columns' : 'WordPress fields'}
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'title', label: 'Event Title', default: 'post_title' },
                    { key: 'description', label: 'Description', default: 'post_content' },
                    { key: 'start', label: 'Start Date/Time', default: 'event_start' },
                    { key: 'end', label: 'End Date/Time', default: 'event_end' },
                    { key: 'venue', label: 'Venue Name', default: 'venue_name' },
                    { key: 'city', label: 'City', default: 'city' },
                    { key: 'organizer', label: 'Organizer', default: 'organizer' },
                    { key: 'category', label: 'Category', default: 'category' },
                  ].map((field) => (
                    <div key={field.key}>
                      <label className="text-sm font-medium">{field.label}</label>
                      <Input
                        placeholder={field.default}
                        value={exportData.fieldMap?.[field.key] || field.default}
                        onChange={(e) =>
                          setExportData(prev => ({
                            ...prev,
                            fieldMap: {
                              ...prev.fieldMap,
                              [field.key]: e.target.value || field.default,
                            },
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">
                  {exportData.format === 'json'
                    ? 'JSON exports use standard field names'
                    : 'ICS exports use calendar-standard field mapping'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={step === 1 ? onClose : handleBack}>
            {step === 1 ? 'Cancel' : 'Back'}
          </Button>
          <Button onClick={handleNext}>
            {step === 3 ? 'Start Export' : 'Next'}
          </Button>
        </div>
      </div>
    </DialogContent>
  )
}

export function Exports() {
  const queryClient = useQueryClient()
  const [showWizard, setShowWizard] = useState(false)

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

  const handleExport = async (data: CreateExportData) => {
    try {
      await createExportMutation.mutateAsync(data)
    } catch (error) {
      console.error('Export failed:', error)
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
    return (
      <Badge variant={status === 'success' ? 'success' : 'destructive'}>
        {status}
      </Badge>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Exports</h1>
        <p className="text-gray-600 dark:text-gray-400">
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
                  <TableHead>Created</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.exports.map((exportRecord) => (
                  <TableRow key={exportRecord.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getFormatIcon(exportRecord.format)}
                        <span className="font-medium capitalize">
                          {exportRecord.format.toUpperCase()}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="text-sm">{formatRelativeTime(exportRecord.createdAt)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(exportRecord.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {exportRecord.itemCount} events
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(exportRecord.status)}
                      {exportRecord.status === 'error' && exportRecord.errorMessage && (
                        <p className="text-xs text-red-600 mt-1">
                          {exportRecord.errorMessage}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {exportRecord.status === 'success' && exportRecord.filePath && (
                          <Button size="sm" variant="outline" className="flex items-center gap-1">
                            <Download className="h-3 w-3" />
                            Download
                          </Button>
                        )}
                        {exportRecord.format === 'wp-rest' && exportRecord.status === 'success' && (
                          <Badge variant="success" className="text-xs">
                            Uploaded to WordPress
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
    </div>
  )
}