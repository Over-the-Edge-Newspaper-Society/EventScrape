import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { matchesApi, queueApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { GitMerge, Eye, Check, X, Calendar, MapPin, Building, ExternalLink, AlertTriangle, ChevronLeft, ChevronRight, Zap, Clock, Hash, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { cn } from '@/lib/utils'

interface MatchDialogProps {
  match: any
  onClose: () => void
  onAction: (matchId: string, action: 'confirm' | 'reject' | 'merge', mergeData?: any) => void
  onNavigate?: (direction: 'prev' | 'next') => void
  currentIndex?: number
  totalMatches?: number
}

function MatchDialog({ match, onClose, onAction, onNavigate, currentIndex = 0, totalMatches = 0 }: MatchDialogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['match', match.match.id],
    queryFn: () => matchesApi.getById(match.match.id),
    enabled: !!match.match.id,
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
    if (!data) return // Early return inside useEffect is fine
    
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
  }, [match.match.id, mergeMode, onNavigate, onClose, onAction, data])

  // Early return for loading state - after all hooks
  if (isLoading || !data) {
    return (
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Loading match details...</DialogTitle>
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
          {totalMatches > 0 && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onNavigate?.('prev')}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                {currentIndex + 1} / {totalMatches}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onNavigate?.('next')}
                disabled={currentIndex === totalMatches - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </DialogTitle>
        <DialogDescription asChild>
          <div>
            <p>{mergeMode ? 'Select the best values for each field to create a merged event' : 'Compare these events and decide if they are duplicates'}</p>
            {!mergeMode && (
              <p className="mt-2 text-xs">
                Keyboard shortcuts: <kbd>Y</kbd> = Confirm, <kbd>N</kbd> = Reject, <kbd>M</kbd> = Merge, <kbd>←→</kbd> = Navigate
              </p>
            )}
          </div>
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

export function Matches() {
  const queryClient = useQueryClient()
  const [selectedMatch, setSelectedMatch] = useState<any>(null)
  const [selectedMatchIndex, setSelectedMatchIndex] = useState(0)
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open')
  const [selectedMatches, setSelectedMatches] = useState<Set<string>>(new Set())
  const [batchMode, setBatchMode] = useState(false)

  const { data: matches, isLoading } = useQuery({
    queryKey: ['matches', { status: statusFilter === 'all' ? undefined : statusFilter }],
    queryFn: () => matchesApi.getAll({ status: statusFilter === 'all' ? undefined : statusFilter, limit: 100 }),
  })

  // Get counts for all statuses
  const { data: allMatches } = useQuery({
    queryKey: ['matches', { status: undefined }],
    queryFn: () => matchesApi.getAll({ status: undefined, limit: 100 }),
  })

  const openCount = allMatches?.matches.filter(m => m.match.status === 'open').length || 0
  const totalCount = allMatches?.matches.length || 0

  const updateStatusMutation = useMutation({
    mutationFn: ({ matchId, status }: { matchId: string; status: 'confirmed' | 'rejected' }) =>
      matchesApi.updateStatus(matchId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      // Don't close dialog automatically - let user continue reviewing
    },
  })

  const mergeMutation = useMutation({
    mutationFn: (data: any) => matchesApi.merge(data),
    onSuccess: () => {
      // Force refetch of matches with current filter
      queryClient.invalidateQueries({ 
        queryKey: ['matches'], 
        exact: false,
        refetchType: 'active'
      })
      queryClient.invalidateQueries({ queryKey: ['events'] })
      // Don't close dialog automatically - let user continue reviewing
    },
  })

  const triggerMatchMutation = useMutation({
    mutationFn: () => queueApi.triggerMatch(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] })
    },
  })

  const handleAction = async (matchId: string, action: 'confirm' | 'reject' | 'merge', mergeData?: any) => {
    try {
      if (action === 'merge' && mergeData) {
        // Execute the merge with the provided data
        const matchData = matches?.matches.find(m => m.match.id === matchId)
        const rawIds = [matchData?.eventA.id, matchData?.eventB.id].filter(Boolean)
        
        const mergePayload = {
          rawIds,
          ...mergeData,
          // Ensure required fields have values
          title: mergeData.title || 'Untitled Event',
          urlPrimary: mergeData.urlPrimary || 'https://example.com',
          // Remove empty imageUrl to avoid validation error
          ...(mergeData.imageUrl ? { imageUrl: mergeData.imageUrl } : {})
        }
        
        console.log('Merge payload:', mergePayload)
        await mergeMutation.mutateAsync(mergePayload)
      } else if (action === 'merge') {
        // Just confirm for now if no merge data provided
        await updateStatusMutation.mutateAsync({ matchId, status: 'confirmed' })
      } else {
        await updateStatusMutation.mutateAsync({ matchId, status: action === 'confirm' ? 'confirmed' : 'rejected' })
      }
      
      // Don't auto-close dialog, just refresh the data
      // The user can navigate manually or close when done
    } catch (error) {
      console.error('Action failed:', error)
    }
  }

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (!matches?.matches) return
    
    const newIndex = direction === 'prev' 
      ? Math.max(0, selectedMatchIndex - 1)
      : Math.min(matches.matches.length - 1, selectedMatchIndex + 1)
    
    if (newIndex !== selectedMatchIndex) {
      setSelectedMatchIndex(newIndex)
      setSelectedMatch(matches.matches[newIndex])
    }
  }

  const handleBatchAction = async (action: 'confirm' | 'reject') => {
    try {
      const promises = Array.from(selectedMatches).map(matchId => 
        updateStatusMutation.mutateAsync({ 
          matchId, 
          status: action === 'confirm' ? 'confirmed' : 'rejected' 
        })
      )
      await Promise.all(promises)
      setSelectedMatches(new Set())
      setBatchMode(false)
    } catch (error) {
      console.error('Batch action failed:', error)
    }
  }

  const toggleMatchSelection = (matchId: string) => {
    const newSelection = new Set(selectedMatches)
    if (newSelection.has(matchId)) {
      newSelection.delete(matchId)
    } else {
      newSelection.add(matchId)
    }
    setSelectedMatches(newSelection)
  }

  const selectAll = () => {
    if (!matches?.matches) return
    const allIds = matches.matches.filter(m => m.match.status === 'open').map(m => m.match.id)
    setSelectedMatches(new Set(allIds))
  }

  const getScoreBadge = (score: number) => {
    const percentage = Math.round(score * 100)
    if (percentage >= 90) return <Badge variant="destructive">{percentage}%</Badge>
    if (percentage >= 70) return <Badge variant="warning">{percentage}%</Badge>
    return <Badge variant="secondary">{percentage}%</Badge>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Duplicate Matches</h1>
          <p className="text-muted-foreground">
            Review and resolve potential duplicate events
          </p>
        </div>
        <Button
          onClick={() => triggerMatchMutation.mutate()}
          disabled={triggerMatchMutation.isPending}
          className="flex items-center gap-2"
        >
          <Search className="h-4 w-4" />
          {triggerMatchMutation.isPending ? 'Searching...' : 'Find Duplicates'}
        </Button>
      </div>

      {/* Filters and Batch Actions */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex justify-between items-center">
            <div className="flex gap-2">
              <Button
                variant={statusFilter === 'open' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('open')}
                size="sm"
              >
                Open ({openCount})
              </Button>
              <Button
                variant={statusFilter === 'all' ? 'default' : 'outline'}
                onClick={() => setStatusFilter('all')}
                size="sm"
              >
                All Matches ({totalCount})
              </Button>
            </div>
            
            <div className="flex gap-2">
              {batchMode && selectedMatches.size > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => selectAll()}
                  >
                    Select All Open
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleBatchAction('confirm')}
                  >
                    <Check className="h-4 w-4 mr-1" />
                    Confirm {selectedMatches.size} as Duplicates
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleBatchAction('reject')}
                  >
                    <X className="h-4 w-4 mr-1" />
                    Reject {selectedMatches.size}
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant={batchMode ? 'secondary' : 'outline'}
                onClick={() => {
                  setBatchMode(!batchMode)
                  setSelectedMatches(new Set())
                }}
              >
                <Zap className="h-4 w-4 mr-1" />
                {batchMode ? 'Exit Batch Mode' : 'Batch Mode'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Matches Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" />
            Potential Duplicates
          </CardTitle>
          <CardDescription>
            Events that might be duplicates based on similarity scoring
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">Loading matches...</p>
            </div>
          ) : !matches?.matches.length ? (
            <div className="text-center py-8">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No matches found</p>
              {statusFilter === 'open' && (
                <p className="text-sm text-muted-foreground mt-2">
                  All potential duplicates have been reviewed, or no duplicates were detected.
                </p>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {batchMode && <TableHead className="w-12"></TableHead>}
                  <TableHead>Similarity</TableHead>
                  <TableHead>Event A</TableHead>
                  <TableHead>Event B</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.matches.map((match, index) => (
                  <TableRow key={match.match.id}>
                    {batchMode && (
                      <TableCell>
                        <Checkbox
                          checked={selectedMatches.has(match.match.id)}
                          onCheckedChange={() => toggleMatchSelection(match.match.id)}
                          disabled={match.match.status !== 'open'}
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {getScoreBadge(match.match.score)}
                        <span className="text-xs text-muted-foreground">
                          {formatRelativeTime(match.match.createdAt)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-sm">{match.eventA.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(match.eventA.startDatetime).toLocaleDateString()} • {match.sourceA.name}
                        </p>
                        {match.eventA.venueName && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {match.eventA.venueName}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-medium text-sm">{match.eventB.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(match.eventB.startDatetime).toLocaleDateString()} • Source B
                        </p>
                        {match.eventB.venueName && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {match.eventB.venueName}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          match.match.status === 'open'
                            ? 'secondary'
                            : match.match.status === 'confirmed'
                            ? 'success'
                            : 'destructive'
                        }
                      >
                        {match.match.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedMatch(match)
                              setSelectedMatchIndex(index)
                            }}
                            className="flex items-center gap-1"
                          >
                            <Eye className="h-3 w-3" />
                            Review
                          </Button>
                        </DialogTrigger>
                        {selectedMatch && (
                          <MatchDialog
                            match={selectedMatch}
                            onClose={() => setSelectedMatch(null)}
                            onAction={handleAction}
                            onNavigate={handleNavigate}
                            currentIndex={selectedMatchIndex}
                            totalMatches={matches?.matches.length || 0}
                          />
                        )}
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}