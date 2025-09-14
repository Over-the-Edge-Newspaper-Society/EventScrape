import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Download, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { posterImportApi } from '@/lib/api'

export function PosterImport() {
  const queryClient = useQueryClient()
  const [posterJsonContent, setPosterJsonContent] = useState('')
  const [posterJsonFile, setPosterJsonFile] = useState<File | null>(null)

  const handlePosterFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setPosterJsonFile(file)
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setPosterJsonContent(content)
      }
      reader.readAsText(file)
    }
  }

  const posterImportMutation = useMutation({
    mutationFn: (data: { content: string; testMode?: boolean }) => posterImportApi.upload(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Poster Import</h1>
        <p className="text-muted-foreground">Upload JSON extracted from poster images (no source selection needed)</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>JSON Upload</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="p-3 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-700 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <Download className="h-4 w-4 text-blue-600" />
              <span className="text-sm font-medium text-blue-800 dark:text-blue-100">Instructions</span>
            </div>
            <div className="text-xs text-blue-700 dark:text-blue-200 whitespace-pre-line">
              {`To import events from posters:\n1. Use the Poster Import prompt (repo: Poster Import/poster-import-prompt.md)\n2. Run the prompt on your poster image with an LLM (Claude/GPT-4o etc.)\n3. Copy the JSON output that matches the prompt schema\n4. Upload a .json file below or paste the JSON into the text area`}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="poster-json-upload">Upload JSON File</Label>
              <Input
                id="poster-json-upload"
                type="file"
                accept=".json,application/json"
                onChange={handlePosterFileUpload}
                className="file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-primary file:text-primary-foreground hover:file:bg-primary/80"
              />
              {posterJsonFile && (
                <p className="text-xs text-green-600">✓ File loaded: {posterJsonFile.name}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="poster-json-content">Or Paste JSON Content</Label>
              <Textarea
                id="poster-json-content"
                placeholder="Paste your JSON content here..."
                value={posterJsonContent}
                onChange={(e) => setPosterJsonContent(e.target.value)}
                rows={10}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">You can either upload a .json file above or paste the JSON content directly here.</p>
            </div>
          </div>

          <div>
            <Button
              onClick={async () => {
                if (!posterJsonContent) {
                  toast.error('Please upload or paste JSON content')
                  return
                }
                try {
                  await posterImportMutation.mutateAsync({ content: posterJsonContent })
                  toast.success('Poster JSON submitted. Processing started.')
                  setPosterJsonFile(null)
                  setPosterJsonContent('')
                } catch (err) {
                  console.error(err)
                  toast.error('Failed to submit poster JSON')
                }
              }}
              disabled={posterImportMutation.isPending}
              className="flex items-center gap-2"
            >
              <Upload className="h-4 w-4" /> Submit Poster JSON
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

