import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/DatePicker'
import { CreateExportData, wordpressApi, sourcesApi } from '@/lib/api'
import { FileSpreadsheet, FileJson, Calendar as CalendarIcon, Globe, Settings } from 'lucide-react'

interface ExportWizardProps {
  onClose: () => void
  onExport: (data: CreateExportData) => void
  selectedEventIds?: string[]
}

export function ExportWizard({ onClose, onExport, selectedEventIds }: ExportWizardProps) {
  const hasPreselectedEvents = selectedEventIds && selectedEventIds.length > 0
  const [step, setStep] = useState(1)
  const [exportData, setExportData] = useState<CreateExportData>({
    format: 'csv',
    filters: {},
    fieldMap: {},
  })
  const [allData, setAllData] = useState(false)
  const [wpSiteId, setWpSiteId] = useState('')
  const [wpPostStatus, setWpPostStatus] = useState<'publish' | 'draft' | 'pending'>('draft')

  const { data: wpSettings } = useQuery({
    queryKey: ['wordpress-settings'],
    queryFn: () => wordpressApi.getSettings(),
    enabled: exportData.format === 'wp-rest',
  })

  const { data: sources } = useQuery({
    queryKey: ['sources'],
    queryFn: () => sourcesApi.getAll(),
  })

  const handleNext = () => {
    // With preselected events: step 1 (format) -> step 3 (wordpress/done)
    // Without preselected events: step 1 (format) -> step 2 (filters) -> step 3 (wordpress/done)

    if (hasPreselectedEvents) {
      // With preselected events, only 2 steps: format selection and final config
      if (step === 1) {
        setStep(3) // Jump to step 3 (skipping filters)
      } else {
        // We're on step 3, this is the last step, export now
        let finalExportData = {
          ...exportData,
          filters: {
            ...exportData.filters,
            ids: selectedEventIds,
          },
        }

        if (exportData.format === 'wp-rest') {
          finalExportData = { ...finalExportData, wpSiteId, status: wpPostStatus } as any
        }

        onExport(finalExportData)
        onClose()
      }
    } else {
      // Without preselected events, normal 3-step flow
      if (step < 3) {
        setStep(step + 1)
      } else {
        let finalExportData = allData
          ? { ...exportData, filters: { ...exportData.filters, startDate: undefined, endDate: undefined } }
          : exportData

        if (exportData.format === 'wp-rest') {
          finalExportData = { ...finalExportData, wpSiteId, status: wpPostStatus } as any
        }

        onExport(finalExportData)
        onClose()
      }
    }
  }

  const formatOptions = [
    { value: 'csv', label: 'CSV (Excel/WP All Import)', icon: FileSpreadsheet, description: 'Comma-separated values, perfect for importing into WordPress' },
    { value: 'json', label: 'JSON (API/Custom)', icon: FileJson, description: 'Machine-readable format for custom integrations' },
    { value: 'ics', label: 'ICS (Calendar)', icon: CalendarIcon, description: 'iCalendar format for calendar applications' },
    { value: 'wp-rest', label: 'WordPress REST API', icon: Globe, description: 'Direct upload to WordPress via REST API' },
  ]

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5" />
          Export Wizard
          {hasPreselectedEvents && (
            <span className="text-sm font-normal text-muted-foreground">
              ({selectedEventIds.length} event{selectedEventIds.length !== 1 ? 's' : ''} selected)
            </span>
          )}
        </DialogTitle>
        <DialogDescription>
          Step {hasPreselectedEvents && step === 3 ? '2' : step} of {hasPreselectedEvents ? '2' : '3'}: Configure your export
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6">
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
                      exportData.format === option.value ? 'border-primary bg-primary/5' : 'border-gray-200 hover:border-gray-300'
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

        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Apply Filters</h3>
            <div className="flex items-center space-x-2 p-3 border rounded-lg bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <Checkbox
                id="all-data"
                checked={allData}
                onCheckedChange={(checked) => {
                  setAllData(!!checked)
                  if (checked) setExportData(prev => ({ ...prev, filters: { ...prev.filters, startDate: undefined, endDate: undefined } }))
                }}
              />
              <label htmlFor="all-data" className="text-sm font-medium cursor-pointer dark:text-blue-100">
                Export All Data (no date restrictions)
              </label>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={`text-sm font-medium mb-2 block ${allData ? 'text-muted-foreground' : ''}`}>
                  Start Date {allData && '(disabled)'}
                </label>
                <DatePicker
                  disabled={allData}
                  date={allData ? undefined : (exportData.filters?.startDate ? new Date(exportData.filters.startDate) : undefined)}
                  onDateChange={(date) => !allData && setExportData(prev => ({ ...prev, filters: { ...prev.filters, startDate: date?.toISOString().split('T')[0] } }))}
                  placeholder={allData ? "All data selected" : "Select start date"}
                />
              </div>
              <div>
                <label className={`text-sm font-medium mb-2 block ${allData ? 'text-muted-foreground' : ''}`}>
                  End Date {allData && '(disabled)'}
                </label>
                <DatePicker
                  disabled={allData}
                  date={allData ? undefined : (exportData.filters?.endDate ? new Date(exportData.filters.endDate) : undefined)}
                  onDateChange={(date) => !allData && setExportData(prev => ({ ...prev, filters: { ...prev.filters, endDate: date?.toISOString().split('T')[0] } }))}
                  placeholder={allData ? "All data selected" : "Select end date"}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Filter by Source (optional)</Label>
              <Select
                value={exportData.filters?.sourceIds?.[0] || ''}
                onValueChange={(value) => setExportData(prev => ({
                  ...prev,
                  filters: { ...prev.filters, sourceIds: value ? [value] : undefined }
                }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All sources</SelectItem>
                  {sources?.sources.map(source => (
                    <SelectItem key={source.id} value={source.id}>
                      {source.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            {exportData.format === 'wp-rest' && wpSettings ? (
              <>
                <h3 className="text-lg font-semibold">WordPress Settings</h3>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>WordPress Site</Label>
                    <Select value={wpSiteId} onValueChange={setWpSiteId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose WordPress site..." />
                      </SelectTrigger>
                      <SelectContent>
                        {wpSettings.settings.filter(s => s.active).map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name} - {s.siteUrl}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Post Status</Label>
                    <Select value={wpPostStatus} onValueChange={(v: any) => setWpPostStatus(v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft (for review)</SelectItem>
                        <SelectItem value="pending">Pending Review</SelectItem>
                        <SelectItem value="publish">Publish Immediately</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <Settings className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <p className="text-muted-foreground">Configuration complete</p>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between pt-4 border-t">
          <Button variant="outline" onClick={step === 1 ? onClose : () => setStep(1)}>
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
