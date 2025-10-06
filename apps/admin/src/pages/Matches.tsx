import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogTrigger } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { matchesApi, queueApi } from '@/lib/api'
import { formatRelativeTime } from '@/lib/utils'
import { Eye, MapPin, Search, Check, X, Zap, GitMerge, AlertTriangle } from 'lucide-react'
import { MatchDialog } from '@/components/matches/MatchDialog'
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
                          {new Date(match.eventB.startDatetime).toLocaleDateString()} • {match.sourceB?.name ?? 'Unknown source'}
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
