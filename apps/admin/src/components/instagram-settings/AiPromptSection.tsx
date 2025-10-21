import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Settings as SettingsIcon, Save } from 'lucide-react'

interface AiPromptSectionProps {
  geminiPrompt: string
  setGeminiPrompt: (value: string) => void
  handleSavePrompt: () => void
  updateSettingsPending: boolean
}

export function AiPromptSection({
  geminiPrompt,
  setGeminiPrompt,
  handleSavePrompt,
  updateSettingsPending,
}: AiPromptSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SettingsIcon className="h-5 w-5" />
          AI Extraction Prompt
        </CardTitle>
        <CardDescription>
          Customize the prompt used by Gemini to extract event data from Instagram images
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gemini-prompt">Gemini Extraction Prompt</Label>
          <Textarea
            id="gemini-prompt"
            value={geminiPrompt}
            onChange={(e) => setGeminiPrompt(e.target.value)}
            placeholder="Enter the AI prompt for event extraction..."
            className="min-h-[300px] font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            This prompt instructs the AI how to extract event information from poster images.
            Leave empty to use the default prompt.
          </p>
        </div>

        <Button onClick={handleSavePrompt} disabled={updateSettingsPending}>
          <Save className="h-4 w-4 mr-2" />
          Save Prompt
        </Button>
      </CardContent>
    </Card>
  )
}
