import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Source, CreateSourceData } from '@/lib/api'
import { Settings } from 'lucide-react'

interface SourceFormProps {
  source: Source | null
  onClose: () => void
  onSave: (data: CreateSourceData) => Promise<void>
  children: React.ReactNode
}

export function SourceForm({ source, onClose, onSave, children }: SourceFormProps) {
  return (
    <Dialog open={!!source} onOpenChange={(open) => !open && onClose()}>
      {children}
      <SourceFormContent source={source} onClose={onClose} onSave={onSave} />
    </Dialog>
  )
}

function SourceFormContent({ source, onClose, onSave }: Omit<SourceFormProps, 'children'>) {
  if (!source) return null

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

