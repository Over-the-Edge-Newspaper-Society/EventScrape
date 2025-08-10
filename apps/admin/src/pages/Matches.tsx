import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { matchesApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { GitMerge, Eye, Check, X, Calendar, MapPin, Building, User, ExternalLink, AlertTriangle } from 'lucide-react'
import { Input } from '@/components/ui/input'

interface MatchDialogProps {
  match: any
  onClose: () => void
  onAction: (matchId: string, action: 'confirm' | 'reject' | 'merge') => void
}

function MatchDialog({ match, onClose, onAction }: MatchDialogProps) {
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
  const scoreColor = score >= 90 ? 'text-red-600' : score >= 70 ? 'text-orange-600' : 'text-yellow-600'

  const getFieldComparison = (fieldA: any, fieldB: any, fieldName: string) => {
    const valueA = fieldA || 'Not provided'
    const valueB = fieldB || 'Not provided'
    const isMatch = valueA === valueB
    
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
    // Auto-fill merge data with better values from both events
    const eventAData = eventA?.event
    const eventBData = eventB?.event
    
    setMergeData({
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
    })
    
    onAction(match.match.id, 'merge')
  }

  return (
    <DialogContent className="max-w-6xl max-h-[80vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <GitMerge className="h-5 w-5" />
          Review Duplicate Match
          <Badge className={scoreColor}>
            {score}% similarity
          </Badge>
        </DialogTitle>
        <DialogDescription>
          Compare these events and decide if they are duplicates
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

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t">
          <Button
            variant="destructive"
            onClick={() => onAction(match.match.id, 'reject')}
            className="flex items-center gap-2"
          >
            <X className="h-4 w-4" />
            Not Duplicate
          </Button>
          <Button
            variant="outline"
            onClick={() => onAction(match.match.id, 'confirm')}
            className="flex items-center gap-2"
          >
            <Check className="h-4 w-4" />
            Confirm Duplicate
          </Button>
          <Button
            onClick={handleMerge}
            className="flex items-center gap-2"
          >
            <GitMerge className="h-4 w-4" />
            Merge Events
          </Button>
        </div>
      </div>
    </DialogContent>
  )
}

export function Matches() {
  const queryClient = useQueryClient()
  const [selectedMatch, setSelectedMatch] = useState<any>(null)
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open')

  const { data: matches, isLoading } = useQuery({
    queryKey: ['matches', { status: statusFilter === 'all' ? undefined : statusFilter }],
    queryFn: () => matchesApi.getAll({ status: statusFilter === 'all' ? undefined : statusFilter }),
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ matchId, status }: { matchId: string; status: 'confirmed' | 'rejected' }) =>
      matchesApi.updateStatus(matchId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      setSelectedMatch(null)
    },
  })

  const mergeMutation = useMutation({
    mutationFn: (data: any) => matchesApi.merge(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['matches'] })
      queryClient.invalidateQueries({ queryKey: ['events'] })
      setSelectedMatch(null)
    },
  })

  const handleAction = async (matchId: string, action: 'confirm' | 'reject' | 'merge') => {
    try {
      if (action === 'merge') {
        // For now, just confirm the duplicate - merge functionality would need more UI
        await updateStatusMutation.mutateAsync({ matchId, status: 'confirmed' })
      } else {
        await updateStatusMutation.mutateAsync({ matchId, status: action === 'confirm' ? 'confirmed' : 'rejected' })
      }
    } catch (error) {
      console.error('Action failed:', error)
    }
  }

  const getScoreBadge = (score: number) => {
    const percentage = Math.round(score * 100)
    if (percentage >= 90) return <Badge variant="destructive">{percentage}%</Badge>
    if (percentage >= 70) return <Badge variant="warning">{percentage}%</Badge>
    return <Badge variant="secondary">{percentage}%</Badge>
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Duplicate Matches</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Review and resolve potential duplicate events
        </p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Button
              variant={statusFilter === 'open' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('open')}
              size="sm"
            >
              Open ({matches?.matches.filter(m => m.match.status === 'open').length || 0})
            </Button>
            <Button
              variant={statusFilter === 'all' ? 'default' : 'outline'}
              onClick={() => setStatusFilter('all')}
              size="sm"
            >
              All Matches ({matches?.matches.length || 0})
            </Button>
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
                  <TableHead>Similarity</TableHead>
                  <TableHead>Event A</TableHead>
                  <TableHead>Event B</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {matches.matches.map((match) => (
                  <TableRow key={match.match.id}>
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
                            onClick={() => setSelectedMatch(match)}
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