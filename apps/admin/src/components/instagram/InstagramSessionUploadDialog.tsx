import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'

interface InstagramSessionUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionUsername: string
  sessionData: string
  onSessionUsernameChange: (value: string) => void
  onSessionDataChange: (value: string) => void
  onUpload: () => void
  isUploading: boolean
}

export function InstagramSessionUploadDialog({
  open,
  onOpenChange,
  sessionUsername,
  sessionData,
  onSessionUsernameChange,
  onSessionDataChange,
  onUpload,
  isUploading,
}: InstagramSessionUploadDialogProps) {
  const canUpload = !!sessionUsername && !!sessionData && !isUploading

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Upload Instagram Session</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="session-username">Instagram Username</Label>
            <Input
              id="session-username"
              value={sessionUsername}
              onChange={(event) => onSessionUsernameChange(event.target.value)}
              placeholder="e.g., ubcevents"
            />
          </div>

          <div>
            <Label htmlFor="session-data">Session Data (JSON)</Label>
            <Textarea
              id="session-data"
              value={sessionData}
              onChange={(event) => onSessionDataChange(event.target.value)}
              placeholder='{"cookies": "...", "state": {...}}'
              rows={10}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Paste the exported Instagram session JSON data here
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onUpload} disabled={!canUpload}>
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
