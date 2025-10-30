import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Sparkles, Save, Info, PlayCircle } from 'lucide-react'

interface GeminiSettingsSectionProps {
  autoExtractNewPosts: boolean
  setAutoExtractNewPosts: (value: boolean) => void
  autoClassifyWithAi: boolean
  setAutoClassifyWithAi: (value: boolean) => void
  handleSaveSettings: () => void
  handleClassifyBacklog: () => void
  updateSettingsPending: boolean
  classifyBacklogPending: boolean
}

export function GeminiSettingsSection({
  autoExtractNewPosts,
  setAutoExtractNewPosts,
  autoClassifyWithAi,
  setAutoClassifyWithAi,
  handleSaveSettings,
  handleClassifyBacklog,
  updateSettingsPending,
  classifyBacklogPending,
}: GeminiSettingsSectionProps) {
  const [showBacklogDialog, setShowBacklogDialog] = useState(false)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Gemini AI Settings
        </CardTitle>
        <CardDescription>
          Configure AI-powered event extraction and classification. When both settings are enabled, the system will automatically classify posts and extract event data for posts identified as events.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="auto-extract" className="flex items-center gap-2">
              Auto-Extract New Posts
              <Info className="h-4 w-4 text-muted-foreground" />
            </Label>
            <Switch
              id="auto-extract"
              checked={autoExtractNewPosts}
              onCheckedChange={setAutoExtractNewPosts}
            />
            <p className="text-xs text-muted-foreground">
              Automatically extract event data from posts classified as events. Works with AI Auto-Classification for full automation.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="auto-classify" className="flex items-center gap-2">
              AI Auto-Classification
              <Info className="h-4 w-4 text-muted-foreground" />
            </Label>
            <Switch
              id="auto-classify"
              checked={autoClassifyWithAi}
              onCheckedChange={setAutoClassifyWithAi}
            />
            <p className="text-xs text-muted-foreground">
              Let Gemini decide if new Instagram posts are events before review
            </p>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="space-y-4">
            <div>
              <h4 className="text-sm font-medium mb-1">Classify Backlog</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Run AI classification on existing unclassified posts in the backlog
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowBacklogDialog(true)}
                disabled={classifyBacklogPending}
                variant="outline"
              >
                <PlayCircle className="h-4 w-4 mr-2" />
                {classifyBacklogPending ? 'Processing...' : 'Classify Backlog'}
              </Button>
              <Button onClick={handleSaveSettings} disabled={updateSettingsPending}>
                <Save className="h-4 w-4 mr-2" />
                Save AI Settings
              </Button>
            </div>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={showBacklogDialog} onOpenChange={setShowBacklogDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Classify Backlog Posts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will use Gemini AI to classify all unclassified Instagram posts in the backlog.
              Up to 100 posts will be processed at a time. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleClassifyBacklog()
                setShowBacklogDialog(false)
              }}
            >
              Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
