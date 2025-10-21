import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Upload, Info } from 'lucide-react'

interface BulkImportSectionProps {
  csvFile: File | null
  setCsvFile: (file: File | null) => void
  handleCsvUpload: () => void
  importCsvPending: boolean
}

export function BulkImportSection({
  csvFile,
  setCsvFile,
  handleCsvUpload,
  importCsvPending,
}: BulkImportSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Upload className="h-5 w-5" />
          Bulk Import from CSV
        </CardTitle>
        <CardDescription>
          Upload a CSV file to import multiple Instagram sources at once
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            CSV must include columns: <strong>name</strong>, <strong>username</strong>.
            Optional: <strong>active</strong>, <strong>classification_mode</strong>
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <Label htmlFor="csv-file">Select CSV File</Label>
          <Input
            id="csv-file"
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
          />
        </div>

        <Button
          onClick={handleCsvUpload}
          disabled={!csvFile || importCsvPending}
        >
          <Upload className="h-4 w-4 mr-2" />
          {importCsvPending ? 'Importing...' : 'Import CSV'}
        </Button>
      </CardContent>
    </Card>
  )
}
