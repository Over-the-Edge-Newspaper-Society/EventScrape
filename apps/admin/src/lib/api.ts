import { runQuery, runMutation, normalizeIds } from './convexClient'

// Convert an ISO date string (or undefined) into epoch-ms number for Convex.
const toMs = (value?: string): number | undefined =>
  value === undefined || value === null || value === '' ? undefined : new Date(value).getTime()

const resolveApiBaseUrl = () => {
  const configured = import.meta.env.VITE_API_URL?.trim()

  if (typeof window !== 'undefined') {
    if (configured && configured.length > 0) {
      let value = configured
        .replace('__HOST__', window.location.hostname)
        .replace('__ORIGIN__', window.location.origin)

      if (value.startsWith('/')) {
        return `${window.location.origin}${value}`
      }

      if (!/^https?:\/\//i.test(value)) {
        // Allow values like "api:3001/api" to resolve relative to current protocol
        value = `${window.location.protocol}//${value.replace(/^\/\//, '')}`
      }

      return value
    }

    return `${window.location.origin}/api`
  }

  if (configured && configured.length > 0) {
    return configured
  }

  return 'http://localhost:3001/api'
}

export const API_BASE_URL = resolveApiBaseUrl()

// Sources API
export const sourcesApi = {
  getAll: () =>
    runQuery<{ sources: Source[] }>('sources:listWebsite').then(normalizeIds),
  getById: (id: string) =>
    runQuery<{ source: Source }>('sources:get', { id }).then(normalizeIds),
  create: (data: CreateSourceData) =>
    runMutation<{ source: Source }>('sources:create', data).then(normalizeIds),
  update: (id: string, data: UpdateSourceData) =>
    runMutation<{ source: Source }>('sources:update', { id, ...data }).then(normalizeIds),
  delete: (id: string) =>
    runMutation<{ deleted: boolean }>('sources:remove', { id }).then(normalizeIds),
  sync: (): Promise<{
    message: string
    stats: { availableModules: number; created: number; updated: number; deactivated: number }
    availableModules: Array<{ key: string; label: string; baseUrl: string }>
  }> => {
    // Module discovery (reading the worker modules dir) is external I/O done by
    // the worker, so it isn't available from the browser. The DB-only sync
    // mutation requires the discovered module list as input.
    throw new Error('Source sync requires the worker (module discovery is not available in the browser)')
  },
}

// Events API
export const eventsApi = {
  getRaw: (params?: EventsQueryParams) =>
    runQuery<EventsResponse>('events:listRaw', {
      ...params,
      startDate: toMs(params?.startDate),
      endDate: toMs(params?.endDate),
    }).then(normalizeIds),
  getRawById: (id: string) =>
    runQuery<{ event: EventWithSource }>('events:getRaw', { id }).then(normalizeIds),
  deleteRaw: (id: string) =>
    runMutation<{ deletedIds: string[] }>('events:deleteRaw', { ids: [id] }).then((res) =>
      normalizeIds({ message: 'Event deleted successfully', deletedId: res.deletedIds[0] ?? id }),
    ),
  deleteRawBulk: (ids: string[]) =>
    runMutation<{ deletedIds: string[] }>('events:deleteRaw', { ids }).then((res) =>
      normalizeIds({ message: 'Events deleted successfully', deletedIds: res.deletedIds }),
    ),
  getCanonical: (params?: EventsQueryParams) =>
    runQuery<CanonicalEventsResponse>('events:listCanonical', {
      ...params,
      startDate: toMs(params?.startDate),
      endDate: toMs(params?.endDate),
    }).then(normalizeIds),
  getCanonicalById: (id: string) =>
    runQuery<{ event: CanonicalEvent; rawEvents: EventWithSource[] }>('events:getCanonical', { id }).then(normalizeIds),
  deleteCanonical: (id: string) =>
    runMutation<{ deletedIds: string[] }>('events:deleteCanonical', { ids: [id] }).then((res) =>
      normalizeIds({ message: 'Event deleted successfully', deletedId: res.deletedIds[0] ?? id }),
    ),
  deleteCanonicalBulk: (ids: string[]) =>
    runMutation<{ deletedIds: string[] }>('events:deleteCanonical', { ids }).then((res) =>
      normalizeIds({ message: 'Events deleted successfully', deletedIds: res.deletedIds }),
    ),
}

// Runs API
export const runsApi = {
  getAll: (params?: { sourceId?: string; limit?: number; page?: number }) =>
    runQuery<{ runs: RunListItem[]; pagination: RunsPagination }>('runs:listWithChildren', {
      ...params,
    }).then(normalizeIds),
  getById: (id: string) =>
    runQuery<{ run: RunWithSourceAndEvents }>('runs:getDetail', { id }).then(normalizeIds),
  triggerScrape: (sourceKey: string, options?: any) =>
    runMutation<{ message: string; run: Run; source: Source }>('runs:triggerScrape', {
      sourceKey,
      testMode: false,
      ...(options ?? {}),
    }).then(normalizeIds),
  triggerTest: (sourceKey: string) =>
    runMutation<{ message: string; run: Run; source: Source }>('runs:triggerScrape', {
      sourceKey,
      testMode: true,
    }).then(normalizeIds),
  cancel: (runId: string) =>
    runMutation<{ message: string }>('runs:cancel', { runId }).then(normalizeIds),
}

// Run logs API (log viewer)
export const logsApi = {
  getHistory: (runId: string, limit?: number) =>
    runQuery<any[]>('runLogs:history', { runId, limit }).then(normalizeIds),
}

// Poster Import API
export const posterImportApi = {
  upload: (_data: { content: string; testMode?: boolean }): Promise<{ success: boolean; runId: string; jobId: string }> => {
    throw new Error('Poster import requires the actions phase')
  },
  uploadImage: (_formData: FormData): Promise<{ success: boolean; runId: string; jobId: string; eventsPreviewCount?: number }> => {
    throw new Error('Poster import requires the actions phase')
  },
}

export interface CleanupDuplicatesResult {
  success: boolean
  message: string
  eventsRawDeleted: number
  eventSeriesDeleted: number
  duplicatesFound: Array<{
    url: string
    title: string
    count: number
  }>
}

export interface OpenRouterModel {
  id: string
  name: string
  description?: string
  contextLength?: number
  pricing?: {
    prompt?: string
    completion?: string
  }
}

export const systemSettingsApi = {
  get: () =>
    runQuery<{ settings: SystemSettings } | null>('systemSettings:get').then((response) =>
      normalizeIds(response?.settings ?? null) as SystemSettings | null,
    ),
  update: (data: Partial<{ posterImportEnabled: boolean; aiProvider: 'gemini' | 'claude' | 'openrouter'; geminiApiKey?: string; claudeApiKey?: string; openrouterApiKey?: string; openrouterModel?: string }>) =>
    runMutation<{ settings: SystemSettings }>('systemSettings:update', data).then((response) =>
      normalizeIds(response.settings),
    ),
  cleanupDuplicates: (sourceKey?: string) =>
    runMutation<CleanupDuplicatesResult>('systemSettings:cleanupDuplicates', { sourceKey }).then(normalizeIds),
  getOpenRouterModels: (): Promise<OpenRouterModel[]> => {
    throw new Error('OpenRouter model list requires the actions phase')
  },
}

// Matches API
export const matchesApi = {
  getAll: (params?: { status?: string; minScore?: number; limit?: number }) =>
    runQuery<{ matches: MatchWithEvents[] }>('matches:list', { ...params }).then(normalizeIds),
  getById: (id: string) =>
    runQuery<{ match: Match; eventA: EventWithSource; eventB: EventWithSource }>('matches:get', { id }).then(normalizeIds),
  updateStatus: (id: string, status: 'confirmed' | 'rejected') =>
    runMutation<{ match: Match }>('matches:updateStatus', { id, status }).then(normalizeIds),
  merge: (data: MergeEventsData) =>
    runMutation<{ message: string; canonicalId: string }>('matches:merge', {
      ...data,
      startDatetime: toMs(data.startDatetime),
      endDatetime: toMs(data.endDatetime),
    }).then(normalizeIds),
}

// Exports API
export const exportsApi = {
  getAll: () =>
    runQuery<{ exports: ExportWithSchedule[] }>('exports:list').then(normalizeIds),
  getById: (id: string) =>
    runQuery<{ export: Export }>('exports:get', { id }).then(normalizeIds),
  create: (data: CreateExportData) =>
    runMutation<string>('exports:create', {
      format: data.format,
      filters: data.filters
        ? {
            ...data.filters,
            startDate: data.filters.startDate,
            endDate: data.filters.endDate,
          }
        : undefined,
      fieldMap: data.fieldMap,
      wpSiteId: data.wpSiteId,
      wpPostStatus: data.wpPostStatus,
      status: data.status,
    }).then(async (exportId) => {
      const res = await runQuery<{ export: Export } | null>('exports:get', { id: exportId })
      return normalizeIds({ message: 'Export created successfully', export: res?.export as Export })
    }),
  cancel: (id: string) =>
    runMutation<{ message: string }>('exports:cancel', { id }).then(normalizeIds),
  download: (_id: string): Promise<Blob> => {
    throw new Error('Export download requires the actions phase')
  },
}

// Queue API
export const queueApi = {
  triggerMatch: (_data?: { startDate?: string; endDate?: string; sourceIds?: string[] }) =>
    runMutation<{ message: string; jobId: string }>('matches:recompute', {}).then(normalizeIds),
}

// Schedules API
export interface Schedule {
  id: string
  scheduleType: 'scrape' | 'wordpress_export' | 'instagram_scrape'
  sourceId: string | null
  wordpressSettingsId: string | null
  cron: string
  timezone: string
  active: boolean
  repeatKey?: string | null
  config?: any
  createdAt: string
  updatedAt: string
}

export interface ScheduleWithSource {
  schedule: Schedule
  source: Pick<Source, 'id' | 'name' | 'moduleKey'> | null
  wordpressSettings: Pick<WordPressSettings, 'id' | 'name' | 'siteUrl'> | null
}

export type CreateScrapeSchedule = {
  scheduleType: 'scrape'
  sourceId: string
  cron: string
  timezone?: string
  active?: boolean
}

export type CreateWordPressSchedule = {
  scheduleType: 'wordpress_export'
  wordpressSettingsId: string
  cron: string
  timezone?: string
  active?: boolean
  config?: {
    sourceIds?: string[]
    startDateOffset?: number
    endDateOffset?: number
    city?: string
    category?: string
    status?: 'publish' | 'draft' | 'pending'
    updateIfExists?: boolean
  }
}

export type CreateInstagramSchedule = {
  scheduleType: 'instagram_scrape'
  cron: string
  timezone?: string
  active?: boolean
  config?: {
    scope?: 'all_active' | 'all_inactive' | 'custom'
    accountIds?: string[]
    postLimit?: number
    batchSize?: number
    accountLimit?: number
  }
}

export const schedulesApi = {
  getAll: () =>
    runQuery<{ schedules: ScheduleWithSource[] }>('schedules:list').then(normalizeIds),
  create: (data: CreateScrapeSchedule | CreateWordPressSchedule | CreateInstagramSchedule) =>
    runMutation<{ schedule: Schedule }>('schedules:create', data).then(normalizeIds),
  update: (id: string, data: Partial<{ cron: string; timezone: string; active: boolean; config: any }>) =>
    runMutation<{ schedule: Schedule }>('schedules:update', { id, ...data }).then(normalizeIds),
  delete: (id: string) =>
    runMutation<null>('schedules:remove', { id }).then(normalizeIds),
  trigger: (id: string) =>
    runMutation<{ message: string; scheduleId: string }>('schedules:trigger', { id }).then(normalizeIds),
}

export const wordpressApi = {
  getSources: () =>
    runQuery<{ sources: Source[] }>('wordpress:listSources').then(normalizeIds),
  getSettings: () =>
    runQuery<{ settings: WordPressSettings[] }>('wordpress:listSettings').then(normalizeIds),
  getCategories: (_id: string): Promise<{ categories: WordPressCategory[] }> => {
    throw new Error('WordPress category fetch requires the actions phase')
  },
  createSetting: (data: NewWordPressSettings) =>
    runMutation<{ setting: WordPressSettings; message: string }>('wordpress:createSettings', data).then(normalizeIds),
  updateSetting: (id: string, data: Partial<NewWordPressSettings>) =>
    runMutation<{ setting: WordPressSettings; message: string }>('wordpress:updateSettings', { id, ...data }).then(normalizeIds),
  deleteSetting: (id: string) =>
    runMutation<{ message: string }>('wordpress:deleteSettings', { id }).then(normalizeIds),
  testConnection: (_id: string): Promise<{ success: boolean; error?: string }> => {
    throw new Error('WordPress connection test requires the actions phase')
  },
  uploadEvents: (_data: { settingsId: string; eventIds: string[]; status?: 'publish' | 'draft' | 'pending' }): Promise<{ message: string; results: any[] }> => {
    throw new Error('WordPress upload requires the actions phase')
  },
}

// Instagram API
export const instagramApi = {
  getAll: () =>
    runQuery<{ sources: InstagramSource[] }>('instagramAccounts:list').then(normalizeIds),
  getById: (id: string) =>
    runQuery<{ source: InstagramSource }>('instagramAccounts:get', { id }).then(normalizeIds),
  create: (data: CreateInstagramSourceData) =>
    runMutation<{ source: InstagramSource }>('instagramAccounts:create', data).then(normalizeIds),
  update: (id: string, data: Partial<CreateInstagramSourceData>) =>
    runMutation<{ source: InstagramSource }>('instagramAccounts:update', { id, ...data }).then(normalizeIds),
  delete: (id: string) =>
    runMutation<{ message: string }>('instagramAccounts:remove', { id }).then(normalizeIds),
  trigger: (id: string, data?: { postLimit?: number; batchSize?: number }) =>
    runMutation<InstagramTriggerResponse>('instagramAccounts:trigger', { id, ...(data ?? {}) }).then(normalizeIds),
  triggerAllActive: (options?: { postLimit?: number; accountLimit?: number; batchSize?: number }) =>
    runMutation<{
      message: string
      accountsQueued: number
      postLimit?: number
      batchSize?: number | null
      parentRunId?: string
      jobs: InstagramScrapeJob[]
    }>('instagramAccounts:triggerAllActive', { ...(options ?? {}) }).then(normalizeIds),
  getJobStatuses: (jobIds: string[]) =>
    runQuery<{ jobs: InstagramScrapeJobStatus[] }>('instagramAccounts:jobStatuses', { jobIds }).then(normalizeIds),
  cancelJobs: (jobIds: string[]) =>
    runMutation<{ results: InstagramScrapeCancelResult[] }>('instagramAccounts:cancelJobs', { jobIds }).then(normalizeIds),
  uploadSession: (data: { username: string; sessionData: { cookies: string; state?: any } }) =>
    runMutation<{ message: string; session: InstagramSession }>('instagramAccounts:uploadSession', data).then(normalizeIds),
  getSession: (username: string) =>
    runQuery<{ session: InstagramSession }>('instagramAccounts:getSession', { username }).then(normalizeIds),
  deleteSession: (username: string) =>
    runMutation<{ message: string }>('instagramAccounts:deleteSession', { username }).then(normalizeIds),
}

// Instagram Apify API
export const instagramApifyApi = {
  fetchRunSnapshot: (_runId: string, _limit?: number): Promise<{ success: boolean; runId: string; posts: any[]; input: any }> => {
    throw new Error('Apify run import requires the actions phase')
  },
  importRun: (_runId: string, _limit?: number): Promise<{ success: boolean; runId: string; stats: { attempted: number; created: number; skippedExisting: number; missingAccounts: number }; message: string }> => {
    throw new Error('Apify run import requires the actions phase')
  },
}

// Instagram Review API
export const instagramReviewApi = {
  getQueue: (params?: { page?: number; limit?: number; filter?: 'pending' | 'event' | 'not-event' | 'needs-extraction' | 'all'; accountId?: string }) =>
    runQuery<InstagramReviewQueueResponse>('instagramReview:queue', { ...params }).then(normalizeIds),
  classifyPost: (id: string, data: { isEventPoster: boolean; classificationConfidence?: number }) =>
    runMutation<{ message: string; post: EventRaw }>('instagramReview:classify', { id, ...data }).then(normalizeIds),
  extractEvent: (_id: string, _options?: { overwrite?: boolean; createEvents?: boolean }): Promise<{
    success: boolean
    message: string
    extraction: any
    eventsCreated: number
  }> => {
    throw new Error('Event extraction requires the actions phase (AI extraction runs in the worker)')
  },
  aiClassifyPost: (_id: string): Promise<{
    message: string
    classification: InstagramAiClassificationResult
    post: EventRaw
  }> => {
    throw new Error('AI classification requires the actions phase (AI extraction runs in the worker)')
  },
  aiClassifyPending: (_options?: { accountId?: string; limit?: number }): Promise<InstagramReviewBulkAiClassifyResponse> => {
    throw new Error('Bulk AI classification requires the actions phase (AI extraction runs in the worker)')
  },
  getStats: () =>
    runQuery<InstagramReviewStats>('instagramReview:getStats').then(normalizeIds),
  getAccounts: () =>
    runQuery<{ accounts: InstagramAccount[] }>('instagramReview:getAccounts').then(normalizeIds),
  extractMissing: (_options?: { accountId?: string; limit?: number; overwrite?: boolean }): Promise<InstagramReviewBulkExtractResponse> => {
    throw new Error('Bulk event extraction requires the actions phase (AI extraction runs in the worker)')
  },
}

// Types
export interface Source {
  id: string
  name: string
  baseUrl: string
  moduleKey: string
  sourceType?: string
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
  parentRunId?: string | null
  metadata?: any
}

export interface RunWithSource {
  run: Run
  source: Pick<Source, 'id' | 'name' | 'moduleKey'>
}

export interface RunChildSummary {
  total: number
  success: number
  failed: number
  pending: number
  running: number
  queued: number
}

export interface RunListItem extends RunWithSource {
  children: RunWithSource[]
  summary: RunChildSummary
}

export interface RunsPagination {
  page: number
  limit: number
  total: number
  totalPages: number
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
  children?: RunWithSource[]
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
  // Instagram-specific fields
  instagramAccountId?: string
  instagramPostId?: string
  instagramCaption?: string
  localImagePath?: string
  localImageStorageId?: string
  // Resolved Convex storage URL for the local image (added server-side).
  localImageUrl?: string | null
  isEventPoster?: boolean | null
  classificationConfidence?: number
}

export interface EventWithSource {
  event: EventRaw
  source: Pick<Source, 'id' | 'name' | 'moduleKey' | 'baseUrl' | 'sourceType'>
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
  status: 'success' | 'error' | 'processing'
  errorMessage?: string
  scheduleId?: string
}

export interface ExportWithSchedule {
  export: Export
  schedule?: {
    id: string
    scheduleType: 'scrape' | 'wordpress_export'
    cron: string
    timezone: string
    active: boolean
    config?: any
  }
  wordpressSettings?: {
    id: string
    name: string
    siteUrl: string
  }
}

export interface EventsQueryParams {
  page?: number
  limit?: number
  sourceId?: string
  sourceType?: 'website' | 'instagram'
  status?: 'new' | 'ready' | 'exported' | 'ignored'
  city?: string
  category?: string
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
    ids?: string[]
  }
  fieldMap?: Record<string, string>
  wpSiteId?: string
  status?: 'publish' | 'draft' | 'pending' // Unified field name for WordPress post status
  wpPostStatus?: 'publish' | 'draft' | 'pending' // Deprecated: keep for backwards compatibility
}

export interface SystemSettings {
  id: string
  posterImportEnabled: boolean
  aiProvider?: 'gemini' | 'claude' | 'openrouter'
  hasGeminiKey?: boolean
  hasClaudeKey?: boolean
  hasOpenrouterKey?: boolean
  openrouterModel?: string
  createdAt: string
  updatedAt: string
}

export interface WordPressSettings {
  id: string
  name: string
  siteUrl: string
  username: string
  active: boolean
  sourceCategoryMappings?: Record<string, number>
  includeMedia: boolean
  createdAt: string
  updatedAt: string
}

export interface NewWordPressSettings {
  name: string
  siteUrl: string
  username: string
  applicationPassword: string
  active: boolean
  sourceCategoryMappings?: Record<string, number>
  includeMedia: boolean
}

export interface WordPressCategory {
  id: number
  name: string
  slug: string
}

export interface InstagramSource {
  id: string
  name: string
  instagramUsername: string
  classificationMode: 'manual' | 'auto'
  instagramScraperType: 'apify' | 'instagram-private-api'
  active: boolean
  defaultTimezone: string
  notes?: string
  createdAt: string
  updatedAt: string
  lastChecked?: string
  postsCount?: number
  eventCount?: number
}

export interface CreateInstagramSourceData {
  name: string
  instagramUsername: string
  classificationMode?: 'manual' | 'auto'
  instagramScraperType?: 'apify' | 'instagram-private-api'
  active?: boolean
  defaultTimezone?: string
  notes?: string
}

export interface InstagramSession {
  id: string
  username: string
  uploadedAt: string
  expiresAt?: string
  lastUsedAt?: string
  isValid: boolean
}

export interface InstagramImportStats {
  attempted: number
  created: number
  updated: number
  skippedExisting: number
  missingAccounts: number
}

export interface InstagramScrapeJob {
  accountId: string
  username: string
  jobId: string
  runId: string
}

export interface InstagramTriggerResponse {
  message: string
  accountId: string
  username: string
  runId?: string
  parentRunId?: string
  jobId?: string | null
  postLimit?: number
  batchSize?: number | null
  accountsQueued?: number
  jobs?: InstagramScrapeJob[]
  stats?: InstagramImportStats
}

export interface InstagramEventRaw extends EventRaw {
  instagramPostId?: string
  instagramCaption?: string
  localImagePath?: string
  localImageStorageId?: string
  // Resolved Convex storage URL for the local image (added server-side).
  localImageUrl?: string | null
  isEventPoster?: boolean | null
  classificationConfidence?: number
}

export interface InstagramEventWithSource {
  event: InstagramEventRaw
  source: Pick<Source, 'id' | 'name' | 'moduleKey'> & { instagramUsername: string | null }
  account?: {
    id: string
    name: string
    instagramUsername: string | null
    classificationMode: 'manual' | 'auto'
    active: boolean
  } | null
}

export interface InstagramAiClassificationResult {
  isEventPoster: boolean
  confidence?: number | null
  reasoning?: string | null
  cues?: string[] | null
  shouldExtractEvents?: boolean
}

export interface InstagramReviewQueueResponse {
  posts: InstagramEventWithSource[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

export interface InstagramReviewStats {
  unclassified: number
  markedAsEvent: number
  markedAsNotEvent: number
  needsExtraction: number
  total: number
}

export interface InstagramReviewBulkExtractResult {
  id: string
  status: 'success' | 'error'
  message?: string
  eventsCreated?: number
}

export interface InstagramReviewBulkExtractResponse {
  success: boolean
  message: string
  processed: number
  successful: number
  failed: number
  remaining: number
  results: InstagramReviewBulkExtractResult[]
}

export interface InstagramReviewBulkAiClassifyResult {
  id: string
  status: 'success' | 'error'
  isEventPoster?: boolean
  confidence?: number | null
  message?: string
}

export interface InstagramReviewBulkAiClassifyResponse {
  success: boolean
  message: string
  processed: number
  successful: number
  failed: number
  remaining: number
  results: InstagramReviewBulkAiClassifyResult[]
}

export interface InstagramAccount {
  id: string
  name: string
  instagramUsername: string | null
  active: boolean
}

export interface InstagramScrapeJobStatus {
  jobId: string
  state: string
  progress?: number | null
  attemptsMade?: number
  failedReason?: string | null
  returnvalue?: any
  processedOn?: number | null
  finishedOn?: number | null
  timestamp?: number | null
  data?: any
  cancelState?: 'requested' | 'cancelled' | null
}

export interface InstagramScrapeCancelResult {
  jobId: string
  state: string | null
  action: 'removed' | 'cancel_requested' | 'already_finished' | 'missing'
}
