import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { instagramApi, InstagramScrapeJobStatus } from '@/lib/api'

export interface InstagramScrapeJobSummary {
  jobId: string
  accountId: string
  username: string
}

export interface ScrapeProgressCounts {
  queued: number
  running: number
  completed: number
  failed: number
  missing: number
}

export interface ScrapeProgressFailedJob {
  username: string
  reason: string | null
}

export interface ScrapeProgressSummary {
  total: number
  counts: ScrapeProgressCounts
  percentage: number
  finished: boolean
  finishedCount: number
  runningUsernames: string[]
  queuedUsernames: string[]
  failedJobs: ScrapeProgressFailedJob[]
  completedUsernames: string[]
  cancelRequestedUsernames: string[]
}

const DEFAULT_PROGRESS: ScrapeProgressSummary = {
  total: 0,
  counts: {
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    missing: 0,
  },
  percentage: 0,
  finished: false,
  finishedCount: 0,
  runningUsernames: [],
  queuedUsernames: [],
  failedJobs: [],
  completedUsernames: [],
  cancelRequestedUsernames: [],
}

export function useInstagramScrapeProgress() {
  const [activeJobs, setActiveJobs] = useState<InstagramScrapeJobSummary[]>([])
  const [completedAt, setCompletedAt] = useState<number | null>(null)

  const trackedJobIds = useMemo(() => {
    if (activeJobs.length === 0) {
      return []
    }
    const ids = activeJobs.map(job => job.jobId)
    ids.sort()
    return ids
  }, [activeJobs])

  const jobStatusesQuery = useQuery({
    queryKey: ['instagram-scrape-job-statuses', trackedJobIds],
    queryFn: () => instagramApi.getJobStatuses(trackedJobIds),
    enabled: trackedJobIds.length > 0,
    refetchInterval: (query) => {
      if (trackedJobIds.length === 0) return false
      const data = query.state.data
      if (!data) return 3000
      const finishedStates = new Set(['completed', 'failed', 'error', 'missing', 'cancelled'])
      const finishedCount = data.jobs.filter((job: InstagramScrapeJobStatus) => finishedStates.has(job.state)).length
      return finishedCount >= trackedJobIds.length ? false : 3000
    },
  })

  const jobStatuses = jobStatusesQuery.data

  const progress: ScrapeProgressSummary = useMemo(() => {
    if (activeJobs.length === 0) {
      return DEFAULT_PROGRESS
    }

    const statusMap = new Map<string, InstagramScrapeJobStatus>()
    jobStatuses?.jobs.forEach(job => {
      statusMap.set(job.jobId, job)
    })

    const counts: ScrapeProgressCounts = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      missing: 0,
    }

    const runningUsernames: string[] = []
    const queuedUsernames: string[] = []
    const failedJobs: ScrapeProgressFailedJob[] = []
    const completedUsernames: string[] = []
    const cancelRequestedUsernames: string[] = []

    for (const job of activeJobs) {
      const status = statusMap.get(job.jobId)
      const username = job.username || job.accountId

      if (!status) {
        counts.queued += 1
        queuedUsernames.push(username)
        continue
      }

      const cancelState = status.cancelState
      const state = status.state

      if (cancelState === 'cancelled' || state === 'cancelled') {
        counts.failed += 1
        failedJobs.push({ username, reason: 'Cancelled by user' })
        continue
      }

      switch (state) {
        case 'completed':
          counts.completed += 1
          completedUsernames.push(username)
          break
        case 'failed':
        case 'error':
          counts.failed += 1
          failedJobs.push({ username, reason: status.failedReason || null })
          break
        case 'missing':
          counts.failed += 1
          counts.missing += 1
          failedJobs.push({ username, reason: 'Job no longer found in queue' })
          break
        case 'active':
          counts.running += 1
          runningUsernames.push(username)
          if (cancelState === 'requested') {
            cancelRequestedUsernames.push(username)
          }
          break
        default:
          counts.queued += 1
          queuedUsernames.push(username)
          if (cancelState === 'requested') {
            cancelRequestedUsernames.push(username)
          }
          break
      }
    }

    const finishedCount = counts.completed + counts.failed
    const percentage = activeJobs.length > 0 ? Math.round((finishedCount / activeJobs.length) * 100) : 0
    const finished = activeJobs.length > 0 && finishedCount >= activeJobs.length

    return {
      total: activeJobs.length,
      counts,
      percentage,
      finished,
      finishedCount,
      runningUsernames,
      queuedUsernames,
      failedJobs,
      completedUsernames,
      cancelRequestedUsernames,
    }
  }, [activeJobs, jobStatuses])

  useEffect(() => {
    if (progress.total === 0) return
    if (!progress.finished) return
    if (completedAt !== null) return
    setCompletedAt(Date.now())
  }, [progress.total, progress.finished, completedAt])

  useEffect(() => {
    if (completedAt === null) return
    const timeoutId = window.setTimeout(() => {
      setActiveJobs([])
      setCompletedAt(null)
    }, 8000)

    return () => window.clearTimeout(timeoutId)
  }, [completedAt])

  const startTracking = useCallback((jobs: InstagramScrapeJobSummary[]) => {
    setActiveJobs(jobs)
    setCompletedAt(null)
  }, [])

  const reset = useCallback(() => {
    setActiveJobs([])
    setCompletedAt(null)
  }, [])

  return {
    isVisible: activeJobs.length > 0,
    activeJobs,
    progress,
    startTracking,
    reset,
    jobIds: trackedJobIds,
    queryState: jobStatusesQuery,
  }
}
