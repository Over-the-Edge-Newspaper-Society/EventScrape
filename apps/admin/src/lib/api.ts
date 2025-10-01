const resolveApiBaseUrl = () => {
  const configured = import.meta.env.VITE_API_URL
  if (typeof window !== 'undefined') {
    if (configured && configured.length > 0) {
      let value = configured.replace('__HOST__', window.location.hostname)
      if (!/^https?:\/\//i.test(value)) {
        // Allow values like "api:3001/api" to resolve relative to current protocol
        value = `${window.location.protocol}//${value.replace(/^\/\//, '')}`
      }
      return value
    }
    return `${window.location.protocol}//${window.location.hostname}:3001/api`
  }
  if (configured && configured.length > 0) {
    return configured
  }
  return 'http://localhost:3001/api'
}

export const API_BASE_URL = resolveApiBaseUrl()

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`
  
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string> || {}),
  }
  
  // Only set Content-Type if we have a body
  if (options?.body) {
    headers['Content-Type'] = 'application/json'
  }
  
  const response = await fetch(url, {
    headers,
    ...options,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
    console.error('API Error:', response.status, errorData)
    throw new ApiError(response.status, errorData.error || `HTTP ${response.status}`)
  }

  return response.json()
}

// Sources API
export const sourcesApi = {
  getAll: () => fetchApi<{ sources: Source[] }>('/sources'),
  getById: (id: string) => fetchApi<{ source: Source }>(`/sources/${id}`),
  create: (data: CreateSourceData) => fetchApi<{ source: Source }>('/sources', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  update: (id: string, data: UpdateSourceData) => fetchApi<{ source: Source }>(`/sources/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => fetchApi<void>(`/sources/${id}`, { method: 'DELETE' }),
  sync: () => fetchApi<{ 
    message: string; 
    stats: { availableModules: number; created: number; updated: number; deactivated: number }; 
    availableModules: Array<{key: string, label: string, baseUrl: string}> 
  }>('/sources/sync', { method: 'POST' }),
}

// Events API
export const eventsApi = {
  getRaw: (params?: EventsQueryParams) => {
    const searchParams = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value))
        }
      })
    }
    return fetchApi<EventsResponse>(`/events/raw?${searchParams}`)
  },
  getRawById: (id: string) => fetchApi<{ event: EventWithSource }>(`/events/raw/${id}`),
  deleteRaw: (id: string) => fetchApi<{ message: string; deletedId: string }>(`/events/raw/${id}`, { method: 'DELETE' }),
  deleteRawBulk: (ids: string[]) => fetchApi<{ message: string; deletedIds: string[] }>('/events/raw', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  }),
  getCanonical: (params?: EventsQueryParams) => fetchApi<CanonicalEventsResponse>(`/events/canonical?${new URLSearchParams(params as any)}`),
  getCanonicalById: (id: string) => fetchApi<{ event: CanonicalEvent, rawEvents: EventWithSource[] }>(`/events/canonical/${id}`),
  deleteCanonical: (id: string) => fetchApi<{ message: string; deletedId: string }>(`/events/canonical/${id}`, { method: 'DELETE' }),
  deleteCanonicalBulk: (ids: string[]) => fetchApi<{ message: string; deletedIds: string[] }>('/events/canonical', {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  }),
}

// Runs API
export const runsApi = {
  getAll: (params?: { sourceId?: string; limit?: number }) => {
    const searchParams = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value))
        }
      })
    }
    return fetchApi<{ runs: RunWithSource[] }>(`/runs?${searchParams}`)
  },
  getById: (id: string) => fetchApi<{ run: RunWithSourceAndEvents }>(`/runs/${id}`),
  triggerScrape: (sourceKey: string, options?: any) => fetchApi<{ message: string; run: Run; source: Source }>(`/runs/scrape/${sourceKey}`, {
    method: 'POST',
    body: options ? JSON.stringify(options) : undefined,
  }),
  triggerTest: (sourceKey: string) => fetchApi<{ message: string; run: Run; source: Source }>(`/runs/test/${sourceKey}`, {
    method: 'POST',
  }),
  cancel: (runId: string) => fetchApi<{ message: string }>(`/runs/${runId}/cancel`, {
    method: 'POST',
  }),
}

// Poster Import API
export const posterImportApi = {
  upload: (data: { content: string; testMode?: boolean }) =>
    fetchApi<{ success: boolean; runId: string; jobId: string }>(`/poster-import`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// Matches API
export const matchesApi = {
  getAll: (params?: { status?: string; minScore?: number; limit?: number }) => {
    const searchParams = new URLSearchParams()
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          searchParams.append(key, String(value))
        }
      })
    }
    return fetchApi<{ matches: MatchWithEvents[] }>(`/matches?${searchParams}`)
  },
  getById: (id: string) => fetchApi<{ match: Match; eventA: EventWithSource; eventB: EventWithSource }>(`/matches/${id}`),
  updateStatus: (id: string, status: 'confirmed' | 'rejected') => fetchApi<{ match: Match }>(`/matches/${id}/status`, {
    method: 'PUT',
    body: JSON.stringify({ status }),
  }),
  merge: (data: MergeEventsData) => fetchApi<{ message: string; canonicalId: string }>('/matches/merge', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
}

// Exports API
export const exportsApi = {
  getAll: () => fetchApi<{ exports: Export[] }>('/exports'),
  getById: (id: string) => fetchApi<{ export: Export }>(`/exports/${id}`),
  create: (data: CreateExportData) => fetchApi<{ message: string; export: Export }>('/exports', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  download: (id: string) => fetchApi<Blob>(`/exports/${id}/download`),
}

// Queue API
export const queueApi = {
  triggerMatch: (data?: { startDate?: string; endDate?: string; sourceIds?: string[] }) =>
    fetchApi<{ message: string; jobId: string }>('/queue/match/trigger', {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
}

// Schedules API
export interface Schedule {
  id: string
  sourceId: string
  cron: string
  timezone: string
  active: boolean
  repeatKey?: string | null
  createdAt: string
  updatedAt: string
}

export interface ScheduleWithSource {
  schedule: Schedule
  source: Pick<Source, 'id' | 'name' | 'moduleKey'>
}

export const schedulesApi = {
  getAll: () => fetchApi<{ schedules: ScheduleWithSource[] }>(`/schedules`),
  create: (data: { sourceId: string; cron: string; timezone?: string; active?: boolean }) =>
    fetchApi<{ schedule: Schedule }>(`/schedules`, { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<{ cron: string; timezone: string; active: boolean }>) =>
    fetchApi<{ schedule: Schedule }>(`/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => fetchApi<void>(`/schedules/${id}`, { method: 'DELETE' }),
}

export const wordpressApi = {
  getSettings: () => fetchApi<{ settings: WordPressSettings[] }>(`/wordpress/settings`),
  createSetting: (data: NewWordPressSettings) =>
    fetchApi<{ setting: WordPressSettings; message: string }>(`/wordpress/settings`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateSetting: (id: string, data: Partial<NewWordPressSettings>) =>
    fetchApi<{ setting: WordPressSettings; message: string }>(`/wordpress/settings/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteSetting: (id: string) =>
    fetchApi<{ message: string }>(`/wordpress/settings/${id}`, { method: 'DELETE' }),
  testConnection: (id: string) =>
    fetchApi<{ success: boolean; error?: string }>(`/wordpress/settings/${id}/test`, {
      method: 'POST',
    }),
  uploadEvents: (data: { settingsId: string; eventIds: string[]; status?: 'publish' | 'draft' | 'pending' }) =>
    fetchApi<{ message: string; results: any[] }>(`/wordpress/upload`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}

// Types
export interface Source {
  id: string
  name: string
  baseUrl: string
  moduleKey: string
  active: boolean
  defaultTimezone: string
  notes?: string
  rateLimitPerMin: number
  createdAt: string
  updatedAt: string
}

export interface CreateSourceData {
  name: string
  baseUrl: string
  moduleKey: string
  active?: boolean
  defaultTimezone?: string
  notes?: string
  rateLimitPerMin?: number
}

export type UpdateSourceData = Partial<CreateSourceData>

export interface Run {
  id: string
  sourceId: string
  startedAt: string
  finishedAt?: string
  status: 'queued' | 'running' | 'success' | 'partial' | 'error'
  pagesCrawled: number
  eventsFound: number
  errorsJsonb?: any
}

export interface RunWithSource {
  run: Run
  source: Pick<Source, 'id' | 'name' | 'moduleKey'>
}

export interface RunEventSummary {
  id: string
  title: string
  startDatetime: string
  endDatetime?: string | null
  venueName?: string | null
  venueAddress?: string | null
  city?: string | null
  region?: string | null
  country?: string | null
  url: string
  category?: string | null
  organizer?: string | null
  sourceEventId?: string | null
}

export interface RunWithSourceAndEvents extends RunWithSource {
  events: RunEventSummary[]
}

export interface EventRaw {
  id: string
  sourceId: string
  runId: string
  lastUpdatedByRunId?: string
  sourceEventId?: string
  title: string
  descriptionHtml?: string
  startDatetime: string
  endDatetime?: string
  timezone?: string
  venueName?: string
  venueAddress?: string
  city?: string
  region?: string
  country?: string
  lat?: number
  lon?: number
  organizer?: string
  category?: string
  price?: string
  tags?: string[]
  url: string
  imageUrl?: string
  scrapedAt: string
  lastSeenAt?: string
  raw: any
  contentHash: string
}

export interface EventWithSource {
  event: EventRaw
  source: Pick<Source, 'id' | 'name' | 'moduleKey' | 'baseUrl'>
}

export interface CanonicalEvent {
  id: string
  dedupeKey?: string
  title: string
  descriptionHtml?: string
  startDatetime: string
  endDatetime?: string
  timezone?: string
  venueName?: string
  venueAddress?: string
  city?: string
  region?: string
  country?: string
  lat?: number
  lon?: number
  organizer?: string
  category?: string
  price?: string
  tags?: string[]
  urlPrimary: string
  imageUrl?: string
  mergedFromRawIds: string[]
  status: 'new' | 'ready' | 'exported' | 'ignored'
  createdAt: string
  updatedAt: string
}

export interface Match {
  id: string
  rawIdA: string
  rawIdB: string
  score: number
  reason: any
  status: 'open' | 'confirmed' | 'rejected'
  createdAt: string
  createdBy?: string
}

export interface MatchWithEvents {
  match: Match
  eventA: Pick<EventRaw, 'id' | 'title' | 'startDatetime' | 'city' | 'venueName' | 'url'>
  eventB: Pick<EventRaw, 'id' | 'title' | 'startDatetime' | 'city' | 'venueName' | 'url'>
  sourceA: Pick<Source, 'name'>
  sourceB: Pick<Source, 'name'>
}

export interface Export {
  id: string
  format: 'csv' | 'json' | 'ics' | 'wp-rest'
  createdAt: string
  itemCount: number
  filePath?: string
  params: any
  status: 'success' | 'error'
  errorMessage?: string
}

export interface EventsQueryParams {
  page?: number
  limit?: number
  sourceId?: string
  city?: string
  startDate?: string
  endDate?: string
  search?: string
  hasDuplicates?: boolean
  missingFields?: boolean
  hasSeries?: boolean
  sortBy?: 'title' | 'startDatetime' | 'city' | 'source' | 'scrapedAt'
  sortOrder?: 'asc' | 'desc'
}

export interface EventsResponse {
  events: EventWithSource[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface CanonicalEventsResponse {
  events: CanonicalEvent[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface MergeEventsData {
  rawIds: string[]
  decisions?: Record<string, string>
  title: string
  descriptionHtml?: string
  startDatetime: string
  endDatetime?: string
  timezone?: string
  venueName?: string
  venueAddress?: string
  city?: string
  region?: string
  country?: string
  lat?: number
  lon?: number
  organizer?: string
  category?: string
  price?: string
  tags?: string[]
  urlPrimary: string
  imageUrl?: string
}

export interface CreateExportData {
  format: 'csv' | 'json' | 'ics' | 'wp-rest'
  filters?: {
    startDate?: string
    endDate?: string
    city?: string
    category?: string
    sourceIds?: string[]
    status?: 'new' | 'ready' | 'exported' | 'ignored'
  }
  fieldMap?: Record<string, string>
}

export interface WordPressSettings {
  id: string
  name: string
  siteUrl: string
  username: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface NewWordPressSettings {
  name: string
  siteUrl: string
  username: string
  applicationPassword: string
  active: boolean
}
