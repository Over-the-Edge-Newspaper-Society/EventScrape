import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { matchesApi } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ExternalLink, ChevronLeft, ChevronRight, GitMerge, Building, Calendar, MapPin, Hash, Clock, X, Check } from 'lucide-react'

interface MatchDialogProps {
  match: any | null
  onClose: () => void
  onAction: (matchId: string, action: 'confirm' | 'reject' | 'merge', mergeData?: any) => Promise<void>
  onNavigate?: (direction: 'prev' | 'next') => void
  currentIndex?: number
  totalMatches?: number
  children?: React.ReactNode
}

export function MatchDialog({ match, onClose, onAction, onNavigate, currentIndex = 0, totalMatches = 0 }: Omit<MatchDialogProps, 'children'>) {
  return (
    <Dialog open={!!match} onOpenChange={(open) => !open && onClose()}>
      <MatchDialogContent
        match={match}
        onClose={onClose}
        onAction={onAction}
        onNavigate={onNavigate}
        currentIndex={currentIndex}
        totalMatches={totalMatches}
      />
    </Dialog>
  )
}

function MatchDialogContent({ match, onClose, onAction, onNavigate, currentIndex, totalMatches }: Omit<MatchDialogProps, 'children'>) {
  const { data, isLoading } = useQuery({
    queryKey: ['match', match?.match?.id],
    queryFn: () => matchesApi.getById(match!.match.id),
    enabled: !!match?.match?.id,
  })

  const [mergeData, setMergeData] = useState({
    title: '',
    descriptionHtml: '',
    startDatetime: '',
    endDatetime: '',
    venueName: '',
    venueAddress: '',
    city: '',
    region: '',
    country: '',
    organizer: '',
    category: '',
    price: '',
    urlPrimary: '',
    imageUrl: '',
  })
  const [mergeMode, setMergeMode] = useState(false)
  const [selectedFields, setSelectedFields] = useState<Record<string, 'A' | 'B' | 'custom'>>({})

  // Keyboard shortcuts - must be before any returns
  useEffect(() => {
    if (!match || !data) return // Early return inside useEffect is fine

    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (mergeMode) {
          setMergeMode(false)
        } else {
          onClose()
        }
      } else if (!mergeMode) {
        if (e.key === 'ArrowLeft' && onNavigate) {
          onNavigate('prev')
        } else if (e.key === 'ArrowRight' && onNavigate) {
          onNavigate('next')
        } else if (e.key === 'y' || e.key === 'Y') {
          onAction(match.match.id, 'confirm')
        } else if (e.key === 'n' || e.key === 'N') {
          onAction(match.match.id, 'reject')
        } else if (e.key === 'm' || e.key === 'M') {
          // Handle merge will be defined later, just set merge mode for now
          setMergeMode(true)
        }
      }
    }

    window.addEventListener('keydown', handleKeyPress)
    return () => window.removeEventListener('keydown', handleKeyPress)
  }, [match?.match?.id, mergeMode, onNavigate, onClose, onAction, data, match])

  // Early return for no match or loading state - after all hooks
  if (!match) return null

  if (isLoading || !data) {
    return (
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Loading match details...</DialogTitle>
          <DialogDescription>Please wait while we load the match information.</DialogDescription>
        </DialogHeader>
        <div className="text-center py-8">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </DialogContent>
    )
  }

  const { eventA, eventB } = data
  const score = Math.round(match.match.score * 100)
  const scoreColor = score >= 90 ? 'text-destructive' : score >= 70 ? 'text-orange-600' : 'text-yellow-600'

  const getFieldComparison = (fieldA: any, fieldB: any, fieldName: string) => {
    const valueA = fieldA || 'Not provided'
    const valueB = fieldB || 'Not provided'
    const isMatch = valueA === valueB
    
    if (mergeMode) {
      return (
        <div className="space-y-3">
          <RadioGroup 
            value={selectedFields[fieldName] || 'A'} 
            onValueChange={(value) => {
              setSelectedFields(prev => ({ ...prev, [fieldName]: value as 'A' | 'B' | 'custom' }))
              if (value === 'A') {
                setMergeData(prev => ({ ...prev, [fieldName]: fieldA }))
              } else if (value === 'B') {
                setMergeData(prev => ({ ...prev, [fieldName]: fieldB }))
              }
            }}
          >
            <div className="grid grid-cols-2 gap-4">
              <div className={cn(
                "p-3 border rounded-lg cursor-pointer transition-colors",
                selectedFields[fieldName] === 'A' && "border-primary bg-primary/5"
              )}>
                <RadioGroupItem value="A" id={`${fieldName}-A`} className="sr-only" />
                <Label htmlFor={`${fieldName}-A`} className="cursor-pointer">
                  <div className="space-y-1">
                    <div className="font-medium text-sm text-muted-foreground">{eventA?.source?.name}</div>
                    <div className={`text-sm ${isMatch ? 'text-green-600' : ''}`}>{valueA}</div>
                  </div>
                </Label>
              </div>
              <div className={cn(
                "p-3 border rounded-lg cursor-pointer transition-colors",
                selectedFields[fieldName] === 'B' && "border-primary bg-primary/5"
              )}>
                <RadioGroupItem value="B" id={`${fieldName}-B`} className="sr-only" />
                <Label htmlFor={`${fieldName}-B`} className="cursor-pointer">
                  <div className="space-y-1">
                    <div className="font-medium text-sm text-muted-foreground">{eventB?.source?.name}</div>
                    <div className={`text-sm ${isMatch ? 'text-green-600' : ''}`}>{valueB}</div>
                  </div>
                </Label>
              </div>
            </div>
            {selectedFields[fieldName] === 'custom' && (
              <div className="mt-2">
                <Input
                  value={(mergeData as any)[fieldName] || ''}
                  onChange={(e) => setMergeData(prev => ({ ...prev, [fieldName]: e.target.value }))}
                  placeholder="Enter custom value"
                  className="w-full"
                />
              </div>
            )}
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="custom" id={`${fieldName}-custom`} />
              <Label htmlFor={`${fieldName}-custom`}>Use custom value</Label>
            </div>
          </RadioGroup>
        </div>
      )
    }
    
    return (
      <div className="grid grid-cols-2 gap-4 p-4 border rounded">
        <div className="space-y-2">
          <h4 className="font-medium text-sm text-muted-foreground">{eventA?.source?.name}</h4>
          <p className={`text-sm ${isMatch ? 'text-green-600' : ''}`}>{valueA}</p>
        </div>
        <div className="space-y-2">
          <h4 className="font-medium text-sm text-muted-foreground">{eventB?.source?.name}</h4>
          <p className={`text-sm ${isMatch ? 'text-green-600' : ''}`}>{valueB}</p>
        </div>
      </div>
    )
  }

  const handleMerge = () => {
    if (!mergeMode) {
      // Enter merge mode
      setMergeMode(true)
      const eventAData = eventA?.event
      const eventBData = eventB?.event
      
      // Auto-fill merge data with better values from both events
      const initialData = {
        title: eventAData?.title || eventBData?.title || '',
        descriptionHtml: eventAData?.descriptionHtml || eventBData?.descriptionHtml || '',
        startDatetime: eventAData?.startDatetime || eventBData?.startDatetime || '',
        endDatetime: eventAData?.endDatetime || eventBData?.endDatetime || '',
        venueName: eventAData?.venueName || eventBData?.venueName || '',
        venueAddress: eventAData?.venueAddress || eventBData?.venueAddress || '',
        city: eventAData?.city || eventBData?.city || '',
        region: eventAData?.region || eventBData?.region || '',
        country: eventAData?.country || eventBData?.country || '',
        organizer: eventAData?.organizer || eventBData?.organizer || '',
        category: eventAData?.category || eventBData?.category || '',
        price: eventAData?.price || eventBData?.price || '',
        urlPrimary: eventAData?.url || eventBData?.url || '',
        imageUrl: eventAData?.imageUrl || eventBData?.imageUrl || '',
      }
      setMergeData(initialData)
      
      // Set default selections (prefer event A if available)
      const fields = Object.keys(initialData)
      const defaultSelections: Record<string, 'A' | 'B'> = {}
      fields.forEach(field => {
        defaultSelections[field] = (eventAData as any)?.[field] ? 'A' : 'B'
      })
      setSelectedFields(defaultSelections)
    } else {
      // Execute merge - ensure dates are properly formatted and URLs are valid
      const formattedMergeData = {
        ...mergeData,
        startDatetime: mergeData.startDatetime ? new Date(mergeData.startDatetime).toISOString() : new Date().toISOString(),
        endDatetime: mergeData.endDatetime ? new Date(mergeData.endDatetime).toISOString() : undefined,
        // Ensure URL is valid
        urlPrimary: mergeData.urlPrimary || eventA?.event?.url || eventB?.event?.url || 'https://example.com',
        // Only include imageUrl if it's a valid URL
        imageUrl: mergeData.imageUrl && mergeData.imageUrl.startsWith('http') ? mergeData.imageUrl : undefined,
      }
      
      // Remove undefined values
      Object.keys(formattedMergeData).forEach(key => {
        if ((formattedMergeData as any)[key] === undefined || (formattedMergeData as any)[key] === '') {
          delete (formattedMergeData as any)[key]
        }
      })
      
      console.log('Formatted merge data:', formattedMergeData)
      onAction(match.match.id, 'merge', formattedMergeData)
      setMergeMode(false)
    }
  }

  return (
    <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            {mergeMode ? 'Merge Events' : 'Review Duplicate Match'}
            <Badge className={scoreColor}>
              {score}% similarity
            </Badge>
          </div>
          {(totalMatches ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onNavigate?.('prev')}
                disabled={(currentIndex ?? 0) === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {(currentIndex ?? 0) + 1} / {totalMatches}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onNavigate?.('next')}
                disabled={(currentIndex ?? 0) === (totalMatches ?? 0) - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </DialogTitle>
        <DialogDescription>
          {mergeMode ? 'Select the best values for each field to create a merged event' : 'Compare these events and decide if they are duplicates'}
          {!mergeMode && ' • Keyboard shortcuts: Y = Confirm, N = Reject, M = Merge, ←→ = Navigate'}
        </DialogDescription>
      </DialogHeader>
      
      <div className="space-y-6">
        {/* Quick Overview */}
        <div className="grid grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building className="h-4 w-4" />
                {eventA?.source?.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <h4 className="font-medium">{eventA?.event?.title}</h4>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                  <Calendar className="h-3 w-3" />
                  {eventA?.event?.startDatetime && new Date(eventA.event.startDatetime).toLocaleString()}
                </p>
                {eventA?.event?.venueName && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                    <MapPin className="h-3 w-3" />
                    {eventA.event.venueName}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" asChild>
                <a href={eventA?.event?.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  View Original
                </a>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building className="h-4 w-4" />
                {eventB?.source?.name}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <h4 className="font-medium">{eventB?.event?.title}</h4>
                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                  <Calendar className="h-3 w-3" />
                  {eventB?.event?.startDatetime && new Date(eventB.event.startDatetime).toLocaleString()}
                </p>
                {eventB?.event?.venueName && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
                    <MapPin className="h-3 w-3" />
                    {eventB.event.venueName}
                  </p>
                )}
              </div>
              <Button size="sm" variant="outline" asChild>
                <a href={eventB?.event?.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                  <ExternalLink className="h-3 w-3" />
                  View Original
                </a>
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Field-by-Field Comparison */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Field Comparison</h3>
          
          <div className="space-y-3">
            <div>
              <h4 className="font-medium mb-2">Title</h4>
              {getFieldComparison(eventA?.event?.title, eventB?.event?.title, 'title')}
            </div>

            <div>
              <h4 className="font-medium mb-2">Date & Time</h4>
              {getFieldComparison(
                eventA?.event?.startDatetime && new Date(eventA.event.startDatetime).toLocaleString(),
                eventB?.event?.startDatetime && new Date(eventB.event.startDatetime).toLocaleString(),
                'datetime'
              )}
            </div>

            <div>
              <h4 className="font-medium mb-2">Venue</h4>
              {getFieldComparison(eventA?.event?.venueName, eventB?.event?.venueName, 'venue')}
            </div>

            <div>
              <h4 className="font-medium mb-2">City</h4>
              {getFieldComparison(eventA?.event?.city, eventB?.event?.city, 'city')}
            </div>

            <div>
              <h4 className="font-medium mb-2">Organizer</h4>
              {getFieldComparison(eventA?.event?.organizer, eventB?.event?.organizer, 'organizer')}
            </div>
          </div>
        </div>

        {/* Match Confidence Indicators */}
        {!mergeMode && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Match Confidence Indicators</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="flex items-center gap-2">
                  <Hash className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Title Match</p>
                    <p className="text-xs text-muted-foreground">
                      {eventA?.event?.title === eventB?.event?.title ? '✓ Exact match' : '✗ Different'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Time Match</p>
                    <p className="text-xs text-muted-foreground">
                      {eventA?.event?.startDatetime === eventB?.event?.startDatetime ? '✓ Same time' : '✗ Different'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Venue Match</p>
                    <p className="text-xs text-muted-foreground">
                      {eventA?.event?.venueName === eventB?.event?.venueName ? '✓ Same venue' : '✗ Different'}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t">
          {mergeMode ? (
            <>
              <Button
                variant="outline"
                onClick={() => setMergeMode(false)}
                className="flex items-center gap-2"
              >
                Cancel
              </Button>
              <Button
                onClick={handleMerge}
                className="flex items-center gap-2"
              >
                <GitMerge className="h-4 w-4" />
                Confirm Merge
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={() => onAction(match.match.id, 'reject')}
                className="flex items-center gap-2"
              >
                <X className="h-4 w-4" />
                Not Duplicate (N)
              </Button>
              <Button
                variant="outline"
                onClick={() => onAction(match.match.id, 'confirm')}
                className="flex items-center gap-2"
              >
                <Check className="h-4 w-4" />
                Confirm Duplicate (Y)
              </Button>
              <Button
                onClick={handleMerge}
                className="flex items-center gap-2"
              >
                <GitMerge className="h-4 w-4" />
                Merge Events (M)
              </Button>
            </>
          )}
        </div>
      </div>
    </DialogContent>
  )
}

