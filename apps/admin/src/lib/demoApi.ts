import type {
  CanonicalEvent,
  EventWithSource,
  ExportWithSchedule,
  InstagramAccount,
  InstagramEventWithSource,
  InstagramReviewBulkAiClassifyResponse,
  InstagramReviewBulkExtractResponse,
  InstagramReviewQueueResponse,
  InstagramReviewStats,
  InstagramScrapeJob,
  InstagramScrapeJobStatus,
  InstagramSource,
  Match,
  MatchWithEvents,
  Run,
  RunChildSummary,
  RunEventSummary,
  RunListItem,
  RunWithSourceAndEvents,
  Schedule,
  ScheduleWithSource,
  Source,
  SystemSettings,
  WordPressCategory,
  WordPressSettings,
} from '@/lib/api'
import { isDemoMode } from '@/lib/demoMode'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]

type InstagramSettingsDemo = {
  id: string
  apifyActorId: string
  apifyResultsLimit: number
  fetchDelayMinutes: number
  autoExtractNewPosts: boolean
  autoClassifyWithAi: boolean
  aiProvider: 'gemini' | 'claude'
  geminiPrompt: string | null
  claudePrompt: string | null
  hasApifyToken: boolean
  hasGeminiKey: boolean
  hasClaudeKey: boolean
  defaultScraperType: 'apify' | 'instagram-private-api'
  allowPerAccountOverride: boolean
  createdAt: string
  updatedAt: string
}

type BackupBundle = {
  filename: string
  size: number
  createdAt: string
  manifest: {
    createdAt: string
    includeDatabase: boolean
    includeInstagramData: boolean
    includeImages: boolean
    counts: {
      instagramSources: number
      instagramAccounts: number
      instagramSessions: number
      instagramEvents: number
      instagramImages: number
    }
  }
}

const nowIso = '2026-04-23T17:00:00.000Z'
const yesterdayIso = '2026-04-22T17:00:00.000Z'
const lastWeekIso = '2026-04-16T17:00:00.000Z'

let installed = false

function posterDataUri(title: string, accent: string) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">
      <defs>
        <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
          <stop stop-color="${accent}" offset="0"/>
          <stop stop-color="#101828" offset="1"/>
        </linearGradient>
      </defs>
      <rect width="900" height="600" fill="url(#bg)"/>
      <circle cx="730" cy="105" r="150" fill="#ffffff" opacity=".12"/>
      <circle cx="145" cy="505" r="190" fill="#ffffff" opacity=".1"/>
      <text x="70" y="275" fill="#ffffff" font-family="Avenir Next, Arial, sans-serif" font-size="58" font-weight="800">${title}</text>
      <text x="74" y="340" fill="#dbeafe" font-family="Avenir Next, Arial, sans-serif" font-size="25">EventScrape demo fixture</text>
    </svg>
  `

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

let demoSources: Source[] = [
  {
    id: 'src_downtown_pg',
    name: 'Downtown Prince George',
    baseUrl: 'https://downtownpg.com/events',
    moduleKey: 'downtownpg_com',
    sourceType: 'website',
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: 'Business improvement area calendar',
    rateLimitPerMin: 12,
    createdAt: lastWeekIso,
    updatedAt: yesterdayIso,
  },
  {
    id: 'src_tourism_pg',
    name: 'Tourism Prince George',
    baseUrl: 'https://tourismpg.com/events',
    moduleKey: 'tourismpg_com',
    sourceType: 'website',
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: 'Primary public events feed',
    rateLimitPerMin: 10,
    createdAt: lastWeekIso,
    updatedAt: yesterdayIso,
  },
  {
    id: 'src_unbc',
    name: 'UNBC Events',
    baseUrl: 'https://www.unbc.ca/events',
    moduleKey: 'unbc_ca',
    sourceType: 'website',
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: 'University lectures and community notices',
    rateLimitPerMin: 8,
    createdAt: '2026-04-10T17:00:00.000Z',
    updatedAt: yesterdayIso,
  },
  {
    id: 'src_instagram',
    name: 'Instagram Review Feed',
    baseUrl: 'https://instagram.com',
    moduleKey: 'instagram',
    sourceType: 'instagram',
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: 'Poster review queue for configured Instagram accounts',
    rateLimitPerMin: 6,
    createdAt: '2026-04-12T17:00:00.000Z',
    updatedAt: nowIso,
  },
  {
    id: 'src_cn_centre',
    name: 'CN Centre',
    baseUrl: 'https://www.cncentre.ca/events',
    moduleKey: 'cncentre_ca',
    sourceType: 'website',
    active: false,
    defaultTimezone: 'America/Vancouver',
    notes: 'Paused while venue markup is being updated',
    rateLimitPerMin: 5,
    createdAt: '2026-04-08T17:00:00.000Z',
    updatedAt: '2026-04-20T17:00:00.000Z',
  },
]

let demoInstagramSources: InstagramSource[] = [
  {
    id: 'ig_downtown_pg',
    name: 'Downtown PG',
    instagramUsername: 'downtownpg',
    classificationMode: 'auto',
    instagramScraperType: 'apify',
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: 'Reliable event posters and market notices',
    createdAt: '2026-04-12T17:00:00.000Z',
    updatedAt: yesterdayIso,
    lastChecked: yesterdayIso,
    postsCount: 136,
    eventCount: 48,
  },
  {
    id: 'ig_theatre_pg',
    name: 'Theatre NorthWest',
    instagramUsername: 'theatrenorthwest',
    classificationMode: 'manual',
    instagramScraperType: 'apify',
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: 'Manual review catches multi-day runs',
    createdAt: '2026-04-13T17:00:00.000Z',
    updatedAt: yesterdayIso,
    lastChecked: '2026-04-22T02:00:00.000Z',
    postsCount: 92,
    eventCount: 31,
  },
  {
    id: 'ig_unbc',
    name: 'UNBC',
    instagramUsername: 'unbc',
    classificationMode: 'auto',
    instagramScraperType: 'apify',
    active: true,
    defaultTimezone: 'America/Vancouver',
    notes: 'Campus events and public lectures',
    createdAt: '2026-04-13T18:00:00.000Z',
    updatedAt: yesterdayIso,
    lastChecked: '2026-04-22T02:10:00.000Z',
    postsCount: 214,
    eventCount: 56,
  },
  {
    id: 'ig_archived',
    name: 'Archived venue',
    instagramUsername: 'oldpgvenue',
    classificationMode: 'manual',
    instagramScraperType: 'instagram-private-api',
    active: false,
    defaultTimezone: 'America/Vancouver',
    notes: 'Kept for historical mapping',
    createdAt: '2026-04-01T17:00:00.000Z',
    updatedAt: '2026-04-18T17:00:00.000Z',
    lastChecked: '2026-04-15T02:00:00.000Z',
    postsCount: 17,
    eventCount: 4,
  },
]

let demoSystemSettings: SystemSettings = {
  id: 'settings_demo',
  posterImportEnabled: true,
  aiProvider: 'openrouter',
  hasGeminiKey: true,
  hasClaudeKey: false,
  hasOpenrouterKey: true,
  openrouterModel: 'google/gemini-2.0-flash-001',
  createdAt: lastWeekIso,
  updatedAt: nowIso,
}

let demoInstagramSettings: InstagramSettingsDemo = {
  id: 'instagram_settings_demo',
  apifyActorId: 'apify/instagram-post-scraper',
  apifyResultsLimit: 18,
  fetchDelayMinutes: 20,
  autoExtractNewPosts: true,
  autoClassifyWithAi: true,
  aiProvider: 'gemini',
  geminiPrompt: 'Extract event title, dates, venue, price, and organizer from local event posters.',
  claudePrompt: null,
  hasApifyToken: true,
  hasGeminiKey: true,
  hasClaudeKey: false,
  defaultScraperType: 'apify',
  allowPerAccountOverride: true,
  createdAt: lastWeekIso,
  updatedAt: nowIso,
}

let demoWordPressSettings: WordPressSettings[] = [
  {
    id: 'wp_city_events',
    name: 'City Events Preview',
    siteUrl: 'https://events.example.org',
    username: 'events-admin',
    active: true,
    sourceCategoryMappings: {
      src_downtown_pg: 12,
      src_tourism_pg: 16,
      src_unbc: 22,
    },
    includeMedia: true,
    createdAt: '2026-04-11T17:00:00.000Z',
    updatedAt: yesterdayIso,
  },
]

let demoSchedules: ScheduleWithSource[] = [
  {
    schedule: {
      id: 'sch_daily_web',
      scheduleType: 'scrape',
      sourceId: 'src_tourism_pg',
      wordpressSettingsId: null,
      cron: '0 6 * * *',
      timezone: 'America/Vancouver',
      active: true,
      repeatKey: 'daily-tourism-pg',
      createdAt: '2026-04-12T17:00:00.000Z',
      updatedAt: yesterdayIso,
    },
    source: { id: 'src_tourism_pg', name: 'Tourism Prince George', moduleKey: 'tourismpg_com' },
    wordpressSettings: null,
  },
  {
    schedule: {
      id: 'sch_instagram_morning',
      scheduleType: 'instagram_scrape',
      sourceId: null,
      wordpressSettingsId: null,
      cron: '30 7 * * *',
      timezone: 'America/Vancouver',
      active: true,
      repeatKey: 'instagram-morning',
      config: { scope: 'all_active', postLimit: 12, batchSize: 4 },
      createdAt: '2026-04-13T17:00:00.000Z',
      updatedAt: yesterdayIso,
    },
    source: null,
    wordpressSettings: null,
  },
  {
    schedule: {
      id: 'sch_wp_draft',
      scheduleType: 'wordpress_export',
      sourceId: null,
      wordpressSettingsId: 'wp_city_events',
      cron: '15 8 * * 1-5',
      timezone: 'America/Vancouver',
      active: true,
      repeatKey: 'wp-weekday-draft',
      config: { status: 'draft', updateIfExists: true, startDateOffset: 0, endDateOffset: 90 },
      createdAt: '2026-04-14T17:00:00.000Z',
      updatedAt: yesterdayIso,
    },
    source: null,
    wordpressSettings: { id: 'wp_city_events', name: 'City Events Preview', siteUrl: 'https://events.example.org' },
  },
]

let demoBackups: BackupBundle[] = [
  {
    filename: 'eventscrape-demo-2026-04-22.zip',
    size: 4850000,
    createdAt: yesterdayIso,
    manifest: {
      createdAt: yesterdayIso,
      includeDatabase: true,
      includeInstagramData: true,
      includeImages: true,
      counts: {
        instagramSources: 4,
        instagramAccounts: 4,
        instagramSessions: 2,
        instagramEvents: 38,
        instagramImages: 28,
      },
    },
  },
]

const wordpressCategories: WordPressCategory[] = [
  { id: 12, name: 'Community', slug: 'community' },
  { id: 16, name: 'Arts and Culture', slug: 'arts-culture' },
  { id: 22, name: 'Education', slug: 'education' },
]

function sourceById(id: string) {
  return demoSources.find((source) => source.id === id) ?? demoSources[0]
}

function eventSource(source: Source): EventWithSource['source'] {
  return {
    id: source.id,
    name: source.name,
    moduleKey: source.moduleKey,
    baseUrl: source.baseUrl,
    sourceType: source.sourceType,
  }
}

function runSource(source: Source): RunListItem['source'] {
  return {
    id: source.id,
    name: source.name,
    moduleKey: source.moduleKey,
  }
}

function eventSummary(item: EventWithSource): RunEventSummary {
  return {
    id: item.event.id,
    title: item.event.title,
    startDatetime: item.event.startDatetime,
    endDatetime: item.event.endDatetime,
    venueName: item.event.venueName,
    venueAddress: item.event.venueAddress,
    city: item.event.city,
    region: item.event.region,
    country: item.event.country,
    url: item.event.url,
    category: item.event.category,
    organizer: item.event.organizer,
    sourceEventId: item.event.sourceEventId,
  }
}

function createRawEvents(): EventWithSource[] {
  const downtown = eventSource(sourceById('src_downtown_pg'))
  const tourism = eventSource(sourceById('src_tourism_pg'))
  const unbc = eventSource(sourceById('src_unbc'))
  const instagram = eventSource(sourceById('src_instagram'))

  return [
    {
      event: {
        id: 'raw_market_1',
        sourceId: 'src_downtown_pg',
        runId: 'run_web_1',
        sourceEventId: 'downtown-night-market-2026',
        title: 'Downtown Summer Night Market',
        descriptionHtml: '<p>Food trucks, makers, music, and patio specials across downtown.</p>',
        startDatetime: '2026-05-08T18:00:00-07:00',
        endDatetime: '2026-05-08T22:00:00-07:00',
        timezone: 'America/Vancouver',
        venueName: 'Canada Games Plaza',
        venueAddress: '808 Canada Games Way',
        city: 'Prince George',
        region: 'BC',
        country: 'CA',
        organizer: 'Downtown Prince George',
        category: 'Market',
        price: 'Free',
        tags: ['market', 'food', 'family'],
        url: 'https://downtownpg.com/events/night-market',
        imageUrl: posterDataUri('Night Market', '#0f766e'),
        scrapedAt: yesterdayIso,
        raw: { source: 'demo', seriesDates: ['2026-05-08', '2026-05-15', '2026-05-22'] },
        contentHash: 'demo-market-1',
      },
      source: downtown,
    },
    {
      event: {
        id: 'raw_market_2',
        sourceId: 'src_tourism_pg',
        runId: 'run_web_2',
        sourceEventId: 'tourism-night-market-2026',
        title: 'Summer Night Market',
        descriptionHtml: '<p>Open-air local market downtown with live music and vendors.</p>',
        startDatetime: '2026-05-08T18:00:00-07:00',
        endDatetime: '2026-05-08T22:00:00-07:00',
        timezone: 'America/Vancouver',
        venueName: 'Canada Games Plaza',
        venueAddress: '808 Canada Games Way',
        city: 'Prince George',
        region: 'BC',
        country: 'CA',
        organizer: 'Tourism Prince George',
        category: 'Market',
        price: 'Free',
        tags: ['market', 'downtown'],
        url: 'https://tourismpg.com/events/summer-night-market',
        imageUrl: posterDataUri('Market', '#0369a1'),
        scrapedAt: yesterdayIso,
        raw: { source: 'demo' },
        contentHash: 'demo-market-2',
      },
      source: tourism,
    },
    {
      event: {
        id: 'raw_unbc_lecture',
        sourceId: 'src_unbc',
        runId: 'run_web_2',
        sourceEventId: 'climate-resilience-panel',
        title: 'Northern Climate Resilience Panel',
        descriptionHtml: '<p>Researchers and local leaders discuss adaptation work across northern communities.</p>',
        startDatetime: '2026-05-14T17:30:00-07:00',
        endDatetime: '2026-05-14T19:00:00-07:00',
        timezone: 'America/Vancouver',
        venueName: 'UNBC Canfor Theatre',
        venueAddress: '3333 University Way',
        city: 'Prince George',
        region: 'BC',
        country: 'CA',
        organizer: 'UNBC',
        category: 'Lecture',
        price: 'Free registration',
        tags: ['education', 'climate'],
        url: 'https://www.unbc.ca/events/climate-resilience-panel',
        imageUrl: posterDataUri('Climate Panel', '#7c2d12'),
        scrapedAt: nowIso,
        raw: { source: 'demo' },
        contentHash: 'demo-unbc-1',
      },
      source: unbc,
    },
    {
      event: {
        id: 'raw_family_festival',
        sourceId: 'src_tourism_pg',
        runId: 'run_web_3',
        sourceEventId: 'family-festival-lheidli',
        title: 'Riverside Family Festival',
        descriptionHtml: '<p>Outdoor performances, kids activities, and community booths.</p>',
        startDatetime: '2026-06-01T11:00:00-07:00',
        endDatetime: '2026-06-01T16:00:00-07:00',
        timezone: 'America/Vancouver',
        venueName: "Lheidli T'enneh Memorial Park",
        venueAddress: '17th Ave',
        city: 'Prince George',
        region: 'BC',
        country: 'CA',
        organizer: 'Tourism Prince George',
        category: 'Festival',
        price: 'Free',
        tags: ['family', 'festival'],
        url: 'https://tourismpg.com/events/riverside-family-festival',
        imageUrl: posterDataUri('Family Festival', '#be123c'),
        scrapedAt: nowIso,
        raw: { source: 'demo' },
        contentHash: 'demo-family-1',
      },
      source: tourism,
    },
    {
      event: {
        id: 'raw_ig_theatre',
        sourceId: 'src_instagram',
        runId: 'run_ig_child_1',
        sourceEventId: 'ig_180000001',
        title: 'Opening night this Friday - Northern Lights',
        descriptionHtml: '',
        startDatetime: '2026-05-03T19:30:00-07:00',
        endDatetime: '2026-05-03T21:30:00-07:00',
        timezone: 'America/Vancouver',
        venueName: 'Theatre NorthWest',
        venueAddress: '36 Kellogg Ave',
        city: 'Prince George',
        region: 'BC',
        country: 'CA',
        organizer: 'Theatre NorthWest',
        category: 'Theatre',
        price: '$28',
        tags: ['instagram', 'arts'],
        url: 'https://instagram.com/p/demo-theatre',
        imageUrl: posterDataUri('Northern Lights', '#6d28d9'),
        scrapedAt: yesterdayIso,
        raw: {
          instagram: { username: 'theatrenorthwest', timestamp: '2026-04-22T01:00:00.000Z' },
          events: [
            {
              title: 'Northern Lights Opening Night',
              startDate: '2026-05-03',
              startTime: '19:30',
              category: 'Theatre',
              price: '$28',
              venue: { name: 'Theatre NorthWest', city: 'Prince George' },
              organizer: 'Theatre NorthWest',
            },
          ],
        },
        contentHash: 'demo-ig-theatre',
        instagramAccountId: 'ig_theatre_pg',
        instagramPostId: '180000001',
        instagramCaption: 'Opening night this Friday. Tickets are moving fast for Northern Lights.',
        isEventPoster: true,
        classificationConfidence: 0.94,
      },
      source: instagram,
    },
    {
      event: {
        id: 'raw_ig_unbc',
        sourceId: 'src_instagram',
        runId: 'run_ig_child_2',
        sourceEventId: 'ig_180000002',
        title: 'Public lecture: Food systems in the North',
        descriptionHtml: '',
        startDatetime: '2026-05-21T18:00:00-07:00',
        endDatetime: '2026-05-21T19:30:00-07:00',
        timezone: 'America/Vancouver',
        venueName: 'UNBC Agora',
        venueAddress: '3333 University Way',
        city: 'Prince George',
        region: 'BC',
        country: 'CA',
        organizer: 'UNBC',
        category: 'Lecture',
        price: 'Free',
        tags: ['instagram', 'education'],
        url: 'https://instagram.com/p/demo-unbc',
        imageUrl: posterDataUri('Food Systems', '#1d4ed8'),
        scrapedAt: yesterdayIso,
        raw: {
          instagram: { username: 'unbc', timestamp: '2026-04-22T01:30:00.000Z' },
          events: [],
        },
        contentHash: 'demo-ig-unbc',
        instagramAccountId: 'ig_unbc',
        instagramPostId: '180000002',
        instagramCaption: 'Join us for a free public lecture on northern food systems.',
        isEventPoster: null,
        classificationConfidence: 0.71,
      },
      source: instagram,
    },
    {
      event: {
        id: 'raw_ig_downtown',
        sourceId: 'src_instagram',
        runId: 'run_ig_child_3',
        sourceEventId: 'ig_180000003',
        title: 'Vendor call for May market',
        descriptionHtml: '',
        startDatetime: '2026-05-01T09:00:00-07:00',
        timezone: 'America/Vancouver',
        venueName: '',
        city: 'Prince George',
        region: 'BC',
        country: 'CA',
        organizer: 'Downtown PG',
        category: 'Announcement',
        price: '',
        tags: ['instagram'],
        url: 'https://instagram.com/p/demo-vendor-call',
        imageUrl: posterDataUri('Vendor Call', '#b45309'),
        scrapedAt: yesterdayIso,
        raw: {
          instagram: { username: 'downtownpg', timestamp: '2026-04-22T02:10:00.000Z' },
        },
        contentHash: 'demo-ig-downtown',
        instagramAccountId: 'ig_downtown_pg',
        instagramPostId: '180000003',
        instagramCaption: 'Vendor applications are open for our May night market.',
        isEventPoster: false,
        classificationConfidence: 0.82,
      },
      source: instagram,
    },
  ]
}

let demoRawEvents = createRawEvents()

let demoCanonicalEvents: CanonicalEvent[] = [
  {
    id: 'can_market',
    dedupeKey: 'downtown-summer-night-market-2026-05-08',
    title: 'Downtown Summer Night Market',
    descriptionHtml: '<p>Food trucks, makers, music, and patio specials across downtown.</p>',
    startDatetime: '2026-05-08T18:00:00-07:00',
    endDatetime: '2026-05-08T22:00:00-07:00',
    timezone: 'America/Vancouver',
    venueName: 'Canada Games Plaza',
    venueAddress: '808 Canada Games Way',
    city: 'Prince George',
    region: 'BC',
    country: 'CA',
    organizer: 'Downtown Prince George',
    category: 'Market',
    price: 'Free',
    tags: ['market', 'food', 'family'],
    urlPrimary: 'https://downtownpg.com/events/night-market',
    imageUrl: posterDataUri('Night Market', '#0f766e'),
    mergedFromRawIds: ['raw_market_1', 'raw_market_2'],
    status: 'ready',
    createdAt: yesterdayIso,
    updatedAt: nowIso,
  },
  {
    id: 'can_unbc_lecture',
    dedupeKey: 'northern-climate-resilience-panel-2026-05-14',
    title: 'Northern Climate Resilience Panel',
    descriptionHtml: '<p>Researchers and local leaders discuss adaptation work across northern communities.</p>',
    startDatetime: '2026-05-14T17:30:00-07:00',
    endDatetime: '2026-05-14T19:00:00-07:00',
    timezone: 'America/Vancouver',
    venueName: 'UNBC Canfor Theatre',
    venueAddress: '3333 University Way',
    city: 'Prince George',
    region: 'BC',
    country: 'CA',
    organizer: 'UNBC',
    category: 'Lecture',
    price: 'Free registration',
    tags: ['education', 'climate'],
    urlPrimary: 'https://www.unbc.ca/events/climate-resilience-panel',
    imageUrl: posterDataUri('Climate Panel', '#7c2d12'),
    mergedFromRawIds: ['raw_unbc_lecture'],
    status: 'new',
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    id: 'can_theatre',
    dedupeKey: 'northern-lights-opening-night-2026-05-03',
    title: 'Northern Lights Opening Night',
    descriptionHtml: '<p>Opening night performance at Theatre NorthWest.</p>',
    startDatetime: '2026-05-03T19:30:00-07:00',
    endDatetime: '2026-05-03T21:30:00-07:00',
    timezone: 'America/Vancouver',
    venueName: 'Theatre NorthWest',
    venueAddress: '36 Kellogg Ave',
    city: 'Prince George',
    region: 'BC',
    country: 'CA',
    organizer: 'Theatre NorthWest',
    category: 'Theatre',
    price: '$28',
    tags: ['arts', 'instagram'],
    urlPrimary: 'https://instagram.com/p/demo-theatre',
    imageUrl: posterDataUri('Northern Lights', '#6d28d9'),
    mergedFromRawIds: ['raw_ig_theatre'],
    status: 'exported',
    createdAt: yesterdayIso,
    updatedAt: nowIso,
  },
]

const demoRunsBase: RunListItem[] = [
  {
    run: {
      id: 'run_ig_batch',
      sourceId: 'src_instagram',
      startedAt: '2026-04-22T15:00:00.000Z',
      finishedAt: '2026-04-22T15:04:45.000Z',
      status: 'partial',
      pagesCrawled: 36,
      eventsFound: 11,
      metadata: { batch: { total: 3, success: 2, failed: 1, pending: 0 }, options: { postLimit: 12, batchSize: 4 } },
    },
    source: runSource(sourceById('src_instagram')),
    children: [],
    summary: { total: 3, success: 2, failed: 1, pending: 0, running: 0, queued: 0 },
  },
  {
    run: {
      id: 'run_web_3',
      sourceId: 'src_tourism_pg',
      startedAt: '2026-04-22T13:30:00.000Z',
      finishedAt: '2026-04-22T13:31:12.000Z',
      status: 'success',
      pagesCrawled: 12,
      eventsFound: 18,
    },
    source: runSource(sourceById('src_tourism_pg')),
    children: [],
    summary: emptySummary(),
  },
  {
    run: {
      id: 'run_web_2',
      sourceId: 'src_unbc',
      startedAt: '2026-04-22T12:00:00.000Z',
      finishedAt: '2026-04-22T12:00:48.000Z',
      status: 'success',
      pagesCrawled: 7,
      eventsFound: 9,
    },
    source: runSource(sourceById('src_unbc')),
    children: [],
    summary: emptySummary(),
  },
  {
    run: {
      id: 'run_web_1',
      sourceId: 'src_downtown_pg',
      startedAt: '2026-04-21T17:10:00.000Z',
      finishedAt: '2026-04-21T17:10:34.000Z',
      status: 'success',
      pagesCrawled: 9,
      eventsFound: 13,
    },
    source: runSource(sourceById('src_downtown_pg')),
    children: [],
    summary: emptySummary(),
  },
  {
    run: {
      id: 'run_failed_1',
      sourceId: 'src_cn_centre',
      startedAt: '2026-04-20T15:00:00.000Z',
      finishedAt: '2026-04-20T15:00:09.000Z',
      status: 'error',
      pagesCrawled: 1,
      eventsFound: 0,
      errorsJsonb: { message: 'Demo failure: venue calendar returned a maintenance page.' },
    },
    source: runSource(sourceById('src_cn_centre')),
    children: [],
    summary: emptySummary(),
  },
]

let demoExports: ExportWithSchedule[] = [
  {
    export: {
      id: 'exp_wp_1',
      format: 'wp-rest',
      createdAt: '2026-04-22T16:20:00.000Z',
      itemCount: 3,
      params: {
        status: 'draft',
        wpResults: {
          createdCount: 2,
          updatedCount: 1,
          skippedCount: 0,
          failedCount: 0,
          results: [
            { eventId: 'can_market', eventTitle: 'Downtown Summer Night Market', action: 'created', wpPostId: 1011, wpUrl: 'https://events.example.org/night-market' },
            { eventId: 'can_theatre', eventTitle: 'Northern Lights Opening Night', action: 'updated', wpPostId: 1009, wpUrl: 'https://events.example.org/northern-lights' },
          ],
        },
      },
      status: 'success',
      scheduleId: 'sch_wp_draft',
    },
    schedule: {
      id: 'sch_wp_draft',
      scheduleType: 'wordpress_export',
      cron: '15 8 * * 1-5',
      timezone: 'America/Vancouver',
      active: true,
      config: { status: 'draft', updateIfExists: true },
    },
    wordpressSettings: { id: 'wp_city_events', name: 'City Events Preview', siteUrl: 'https://events.example.org' },
  },
  {
    export: {
      id: 'exp_csv_1',
      format: 'csv',
      createdAt: '2026-04-21T16:20:00.000Z',
      itemCount: 24,
      filePath: '/exports/events-demo.csv',
      params: { filters: { startDate: '2026-05-01', endDate: '2026-07-31' } },
      status: 'success',
    },
  },
]

let demoMatches: MatchWithEvents[] = [
  {
    match: {
      id: 'match_market',
      rawIdA: 'raw_market_1',
      rawIdB: 'raw_market_2',
      score: 0.93,
      reason: { title: 'similar', date: 'same', venue: 'same' },
      status: 'open',
      createdAt: yesterdayIso,
      createdBy: 'demo',
    },
    eventA: matchEvent('raw_market_1'),
    eventB: matchEvent('raw_market_2'),
    sourceA: { name: 'Downtown Prince George' },
    sourceB: { name: 'Tourism Prince George' },
  },
  {
    match: {
      id: 'match_theatre',
      rawIdA: 'raw_ig_theatre',
      rawIdB: 'raw_family_festival',
      score: 0.62,
      reason: { title: 'weak', date: 'nearby', venue: 'different' },
      status: 'rejected',
      createdAt: '2026-04-21T19:30:00.000Z',
      createdBy: 'demo',
    },
    eventA: matchEvent('raw_ig_theatre'),
    eventB: matchEvent('raw_family_festival'),
    sourceA: { name: 'Instagram Review Feed' },
    sourceB: { name: 'Tourism Prince George' },
  },
]

export function installDemoApiMock() {
  if (installed || typeof window === 'undefined' || !isDemoMode()) {
    return
  }

  installed = true
  const originalFetch = window.fetch.bind(window)

  window.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = requestUrl(input)

    if (url && shouldHandleDemoRequest(url)) {
      try {
        return await handleDemoRequest(url, input, init)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Demo API error'
        return jsonResponse({ error: message }, { status: 500 })
      }
    }

    return originalFetch(input, init)
  }) as typeof window.fetch
}

async function handleDemoRequest(url: URL, input: FetchInput, init?: FetchInit) {
  const endpoint = url.pathname.replace(/^\/api/, '') || '/'
  const method = requestMethod(input, init)
  const body = await requestJson(input, init)

  if (method === 'GET' && endpoint === '/sources') {
    return jsonResponse({ sources: demoSources })
  }

  if (method === 'POST' && endpoint === '/sources/sync') {
    return jsonResponse({
      message: 'Demo modules synced',
      stats: { availableModules: 5, created: 0, updated: 5, deactivated: 0 },
      availableModules: demoSources.map((source) => ({
        key: source.moduleKey,
        label: source.name,
        baseUrl: source.baseUrl,
      })),
    })
  }

  if (method === 'POST' && endpoint === '/sources') {
    const data = asRecord(body)
    const source = createSource(data)
    demoSources = [source, ...demoSources]
    return jsonResponse({ source })
  }

  const sourceMatch = endpoint.match(/^\/sources\/([^/]+)$/)
  if (sourceMatch) {
    const sourceId = decodeURIComponent(sourceMatch[1])
    const source = sourceById(sourceId)

    if (method === 'GET') {
      return jsonResponse({ source })
    }

    if (method === 'PUT') {
      const data = asRecord(body)
      demoSources = demoSources.map((item) =>
        item.id === sourceId ? { ...item, ...data, updatedAt: nowIso } as Source : item
      )
      return jsonResponse({ source: sourceById(sourceId) })
    }

    if (method === 'DELETE') {
      demoSources = demoSources.filter((item) => item.id !== sourceId)
      return jsonResponse({ message: 'Demo source deleted' })
    }
  }

  if (method === 'GET' && endpoint === '/events/raw') {
    return jsonResponse(rawEventsResponse(url.searchParams))
  }

  const rawEventMatch = endpoint.match(/^\/events\/raw\/([^/]+)$/)
  if (rawEventMatch) {
    const rawId = decodeURIComponent(rawEventMatch[1])

    if (method === 'GET') {
      return jsonResponse({ event: demoRawEvents.find((item) => item.event.id === rawId) })
    }

    if (method === 'DELETE') {
      demoRawEvents = demoRawEvents.filter((item) => item.event.id !== rawId)
      return jsonResponse({ message: 'Demo raw event deleted', deletedId: rawId })
    }
  }

  if (method === 'DELETE' && endpoint === '/events/raw') {
    const ids = Array.isArray(asRecord(body).ids) ? asRecord(body).ids : []
    demoRawEvents = demoRawEvents.filter((item) => !ids.includes(item.event.id))
    return jsonResponse({ message: 'Demo raw events deleted', deletedIds: ids })
  }

  if (method === 'GET' && endpoint === '/events/canonical') {
    return jsonResponse(canonicalEventsResponse(url.searchParams))
  }

  const canonicalEventMatch = endpoint.match(/^\/events\/canonical\/([^/]+)$/)
  if (canonicalEventMatch) {
    const eventId = decodeURIComponent(canonicalEventMatch[1])
    const event = demoCanonicalEvents.find((item) => item.id === eventId)

    if (method === 'GET') {
      return jsonResponse({ event, rawEvents: demoRawEvents.filter((item) => event?.mergedFromRawIds.includes(item.event.id)) })
    }

    if (method === 'DELETE') {
      demoCanonicalEvents = demoCanonicalEvents.filter((item) => item.id !== eventId)
      return jsonResponse({ message: 'Demo canonical event deleted', deletedId: eventId })
    }
  }

  if (method === 'DELETE' && endpoint === '/events/canonical') {
    const ids = Array.isArray(asRecord(body).ids) ? asRecord(body).ids : []
    demoCanonicalEvents = demoCanonicalEvents.filter((item) => !ids.includes(item.id))
    return jsonResponse({ message: 'Demo canonical events deleted', deletedIds: ids })
  }

  if (method === 'GET' && endpoint === '/runs') {
    const page = numericParam(url.searchParams, 'page', 1)
    const limit = numericParam(url.searchParams, 'limit', 20)
    const paged = paginate(demoRuns(), page, limit)
    return jsonResponse({ runs: paged.items, pagination: paged.pagination })
  }

  const runDetailMatch = endpoint.match(/^\/runs\/([^/]+)$/)
  if (runDetailMatch && method === 'GET') {
    return jsonResponse({ run: runDetails(decodeURIComponent(runDetailMatch[1])) })
  }

  const runScrapeMatch = endpoint.match(/^\/runs\/scrape\/([^/]+)$/)
  if (runScrapeMatch && method === 'POST') {
    const source = demoSources.find((item) => item.moduleKey === decodeURIComponent(runScrapeMatch[1])) ?? demoSources[0]
    const run = createRun(source, 'success')
    return jsonResponse({ message: 'Demo scrape completed', run, source })
  }

  const runTestMatch = endpoint.match(/^\/runs\/test\/([^/]+)$/)
  if (runTestMatch && method === 'POST') {
    const source = demoSources.find((item) => item.moduleKey === decodeURIComponent(runTestMatch[1])) ?? demoSources[0]
    const run = createRun(source, 'success')
    return jsonResponse({ message: 'Demo test scrape completed', run, source })
  }

  const cancelRunMatch = endpoint.match(/^\/runs\/([^/]+)\/cancel$/)
  if (cancelRunMatch && method === 'POST') {
    return jsonResponse({ message: 'Demo run cancellation acknowledged' })
  }

  if (method === 'GET' && endpoint === '/matches') {
    const status = url.searchParams.get('status')
    const matches = status ? demoMatches.filter((item) => item.match.status === status) : demoMatches
    return jsonResponse({ matches })
  }

  const matchDetailMatch = endpoint.match(/^\/matches\/([^/]+)$/)
  if (matchDetailMatch && method === 'GET') {
    const match = demoMatches.find((item) => item.match.id === decodeURIComponent(matchDetailMatch[1])) ?? demoMatches[0]
    return jsonResponse(match)
  }

  const matchStatusMatch = endpoint.match(/^\/matches\/([^/]+)\/status$/)
  if (matchStatusMatch && method === 'PUT') {
    const matchId = decodeURIComponent(matchStatusMatch[1])
    const status = asRecord(body).status as Match['status'] | undefined
    demoMatches = demoMatches.map((item) =>
      item.match.id === matchId && status ? { ...item, match: { ...item.match, status } } : item
    )
    return jsonResponse({ match: demoMatches.find((item) => item.match.id === matchId)?.match })
  }

  if (method === 'POST' && endpoint === '/matches/merge') {
    return jsonResponse({ message: 'Demo match merged into a canonical event', canonicalId: 'can_market' })
  }

  if (method === 'POST' && endpoint === '/queue/match/trigger') {
    return jsonResponse({ message: 'Demo duplicate matching queued', jobId: nextId('job_match') })
  }

  if (method === 'GET' && endpoint === '/exports') {
    return jsonResponse({ exports: demoExports })
  }

  if (method === 'POST' && endpoint === '/exports') {
    const data = asRecord(body)
    const exportRow: ExportWithSchedule = {
      export: {
        id: nextId('exp'),
        format: data.format === 'wp-rest' ? 'wp-rest' : data.format === 'json' ? 'json' : data.format === 'ics' ? 'ics' : 'csv',
        createdAt: new Date().toISOString(),
        itemCount: Array.isArray(asRecord(data.filters).ids) ? asRecord(data.filters).ids.length : demoCanonicalEvents.length,
        params: data,
        status: 'success',
      },
    }
    demoExports = [exportRow, ...demoExports]
    return jsonResponse({ message: 'Demo export created', export: exportRow.export })
  }

  const exportCancelMatch = endpoint.match(/^\/exports\/([^/]+)\/cancel$/)
  if (exportCancelMatch && method === 'POST') {
    return jsonResponse({ message: 'Demo export cancelled' })
  }

  const exportDownloadMatch = endpoint.match(/^\/exports\/([^/]+)\/download$/)
  if (exportDownloadMatch && method === 'GET') {
    return new Response('title,startDatetime,venueName\nDowntown Summer Night Market,2026-05-08T18:00:00-07:00,Canada Games Plaza\n', {
      headers: { 'Content-Type': 'text/csv' },
    })
  }

  if (method === 'GET' && endpoint === '/system-settings') {
    return jsonResponse({ settings: demoSystemSettings })
  }

  if (method === 'PATCH' && endpoint === '/system-settings') {
    demoSystemSettings = { ...demoSystemSettings, ...asRecord(body), updatedAt: nowIso } as SystemSettings
    return jsonResponse({ settings: demoSystemSettings })
  }

  if (method === 'POST' && endpoint === '/system-settings/cleanup-duplicates') {
    return jsonResponse({
      success: true,
      message: 'Demo duplicate cleanup complete',
      eventsRawDeleted: 1,
      eventSeriesDeleted: 0,
      duplicatesFound: [{ url: 'https://downtownpg.com/events/night-market', title: 'Downtown Summer Night Market', count: 2 }],
    })
  }

  if (method === 'GET' && endpoint === '/system-settings/openrouter-models') {
    return jsonResponse({
      models: [
        { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', contextLength: 1048576 },
        { id: 'anthropic/claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', contextLength: 200000 },
      ],
    })
  }

  if (method === 'GET' && endpoint === '/schedules') {
    return jsonResponse({ schedules: demoSchedules })
  }

  if (method === 'POST' && endpoint === '/schedules') {
    const data = asRecord(body)
    const schedule: Schedule = {
      id: nextId('sch'),
      scheduleType: data.scheduleType === 'wordpress_export' ? 'wordpress_export' : data.scheduleType === 'instagram_scrape' ? 'instagram_scrape' : 'scrape',
      sourceId: typeof data.sourceId === 'string' ? data.sourceId : null,
      wordpressSettingsId: typeof data.wordpressSettingsId === 'string' ? data.wordpressSettingsId : null,
      cron: typeof data.cron === 'string' ? data.cron : '0 8 * * *',
      timezone: typeof data.timezone === 'string' ? data.timezone : 'America/Vancouver',
      active: data.active !== false,
      config: data.config,
      createdAt: nowIso,
      updatedAt: nowIso,
    }
    const source = schedule.sourceId ? sourceById(schedule.sourceId) : null
    const wordpressSettings = schedule.wordpressSettingsId
      ? demoWordPressSettings.find((setting) => setting.id === schedule.wordpressSettingsId) ?? null
      : null
    demoSchedules = [{
      schedule,
      source: source ? { id: source.id, name: source.name, moduleKey: source.moduleKey } : null,
      wordpressSettings: wordpressSettings ? { id: wordpressSettings.id, name: wordpressSettings.name, siteUrl: wordpressSettings.siteUrl } : null,
    }, ...demoSchedules]
    return jsonResponse({ schedule })
  }

  const scheduleMatch = endpoint.match(/^\/schedules\/([^/]+)(?:\/trigger)?$/)
  if (scheduleMatch) {
    const scheduleId = decodeURIComponent(scheduleMatch[1])

    if (endpoint.endsWith('/trigger') && method === 'POST') {
      return jsonResponse({ message: 'Demo schedule triggered', scheduleId })
    }

    if (method === 'PUT') {
      demoSchedules = demoSchedules.map((row) =>
        row.schedule.id === scheduleId
          ? { ...row, schedule: { ...row.schedule, ...asRecord(body), updatedAt: nowIso } as Schedule }
          : row
      )
      return jsonResponse({ schedule: demoSchedules.find((row) => row.schedule.id === scheduleId)?.schedule })
    }

    if (method === 'DELETE') {
      demoSchedules = demoSchedules.filter((row) => row.schedule.id !== scheduleId)
      return jsonResponse({})
    }
  }

  if (method === 'GET' && endpoint === '/wordpress/sources') {
    return jsonResponse({ sources: demoSources })
  }

  if (method === 'GET' && endpoint === '/wordpress/settings') {
    return jsonResponse({ settings: demoWordPressSettings })
  }

  if (method === 'POST' && endpoint === '/wordpress/settings') {
    const data = asRecord(body)
    const setting = createWordPressSetting(data)
    demoWordPressSettings = [setting, ...demoWordPressSettings]
    return jsonResponse({ setting, message: 'Demo WordPress setting created' })
  }

  const wordpressCategoriesMatch = endpoint.match(/^\/wordpress\/settings\/([^/]+)\/categories$/)
  if (wordpressCategoriesMatch && method === 'GET') {
    return jsonResponse({ categories: wordpressCategories })
  }

  const wordpressTestMatch = endpoint.match(/^\/wordpress\/settings\/([^/]+)\/test$/)
  if (wordpressTestMatch && method === 'POST') {
    return jsonResponse({ success: true })
  }

  const wordpressSettingMatch = endpoint.match(/^\/wordpress\/settings\/([^/]+)$/)
  if (wordpressSettingMatch) {
    const settingId = decodeURIComponent(wordpressSettingMatch[1])

    if (method === 'PUT') {
      demoWordPressSettings = demoWordPressSettings.map((setting) =>
        setting.id === settingId ? { ...setting, ...asRecord(body), updatedAt: nowIso } as WordPressSettings : setting
      )
      return jsonResponse({ setting: demoWordPressSettings.find((setting) => setting.id === settingId), message: 'Demo WordPress setting updated' })
    }

    if (method === 'DELETE') {
      demoWordPressSettings = demoWordPressSettings.filter((setting) => setting.id !== settingId)
      return jsonResponse({ message: 'Demo WordPress setting deleted' })
    }
  }

  if (method === 'POST' && endpoint === '/wordpress/upload') {
    return jsonResponse({ message: 'Demo WordPress upload complete', results: [{ action: 'created', eventId: 'can_market' }] })
  }

  if (method === 'GET' && endpoint === '/instagram-sources') {
    return jsonResponse({ sources: demoInstagramSources })
  }

  if (method === 'POST' && endpoint === '/instagram-sources') {
    const source = createInstagramSource(asRecord(body))
    demoInstagramSources = [source, ...demoInstagramSources]
    return jsonResponse({ source })
  }

  if (method === 'POST' && endpoint === '/instagram-sources/trigger-all-active') {
    const jobs = demoInstagramSources.filter((source) => source.active).map((source) => scrapeJob(source))
    return jsonResponse({
      message: 'Demo Instagram scrape jobs queued',
      accountsQueued: jobs.length,
      postLimit: numericBody(body, 'postLimit'),
      batchSize: numericBody(body, 'batchSize'),
      parentRunId: 'run_ig_batch',
      jobs,
    })
  }

  if (method === 'POST' && endpoint === '/instagram-sources/jobs/status') {
    const ids = asRecord(body).jobIds
    const jobIds = Array.isArray(ids) ? ids.map(String) : []
    const jobs: InstagramScrapeJobStatus[] = jobIds.map((jobId, index) => ({
      jobId,
      state: index % 3 === 0 ? 'active' : 'completed',
      progress: index % 3 === 0 ? 67 : 100,
      attemptsMade: 1,
      finishedOn: index % 3 === 0 ? null : Date.now() - 2000,
      processedOn: Date.now() - 7000,
      timestamp: Date.now(),
    }))
    return jsonResponse({ jobs })
  }

  if (method === 'POST' && endpoint === '/instagram-sources/jobs/cancel') {
    const ids = asRecord(body).jobIds
    const jobIds = Array.isArray(ids) ? ids.map(String) : []
    return jsonResponse({ results: jobIds.map((jobId) => ({ jobId, state: 'waiting', action: 'cancel_requested' })) })
  }

  if (method === 'POST' && endpoint === '/instagram-sources/bulk-import') {
    return jsonResponse({ created: 2, skipped: 1 })
  }

  const instagramSessionMatch = endpoint.match(/^\/instagram-sources\/sessions\/([^/]+)$/)
  if (instagramSessionMatch) {
    const username = decodeURIComponent(instagramSessionMatch[1])

    if (method === 'GET') {
      return jsonResponse({
        session: {
          id: `session_${username}`,
          username,
          uploadedAt: yesterdayIso,
          expiresAt: '2026-07-22T17:00:00.000Z',
          lastUsedAt: yesterdayIso,
          isValid: true,
        },
      })
    }

    if (method === 'DELETE') {
      return jsonResponse({ message: 'Demo session deleted' })
    }
  }

  if (method === 'POST' && endpoint === '/instagram-sources/sessions') {
    return jsonResponse({
      message: 'Demo Instagram session uploaded',
      session: { id: nextId('session'), username: String(asRecord(body).username ?? 'demo'), uploadedAt: nowIso, isValid: true },
    })
  }

  const instagramSourceTriggerMatch = endpoint.match(/^\/instagram-sources\/([^/]+)\/trigger$/)
  if (instagramSourceTriggerMatch && method === 'POST') {
    const source = demoInstagramSources.find((item) => item.id === decodeURIComponent(instagramSourceTriggerMatch[1])) ?? demoInstagramSources[0]
    const job = scrapeJob(source)
    return jsonResponse({
      message: 'Demo Instagram scrape queued',
      accountId: source.id,
      username: source.instagramUsername,
      runId: job.runId,
      jobId: job.jobId,
      jobs: [job],
      stats: { attempted: 12, created: 3, updated: 2, skippedExisting: 7, missingAccounts: 0 },
    })
  }

  const instagramSourceMatch = endpoint.match(/^\/instagram-sources\/([^/]+)$/)
  if (instagramSourceMatch) {
    const accountId = decodeURIComponent(instagramSourceMatch[1])

    if (method === 'GET') {
      return jsonResponse({ source: demoInstagramSources.find((source) => source.id === accountId) })
    }

    if (method === 'PATCH') {
      demoInstagramSources = demoInstagramSources.map((source) =>
        source.id === accountId ? { ...source, ...asRecord(body), updatedAt: nowIso } as InstagramSource : source
      )
      return jsonResponse({ source: demoInstagramSources.find((source) => source.id === accountId) })
    }

    if (method === 'DELETE') {
      demoInstagramSources = demoInstagramSources.filter((source) => source.id !== accountId)
      return jsonResponse({ message: 'Demo Instagram source deleted' })
    }
  }

  const apifySnapshotMatch = endpoint.match(/^\/instagram-apify\/run-snapshot\/([^/]+)$/)
  if (apifySnapshotMatch && method === 'GET') {
    return jsonResponse({
      success: true,
      runId: decodeURIComponent(apifySnapshotMatch[1]),
      posts: demoRawEvents.filter((item) => item.source.sourceType === 'instagram').map((item) => item.event.raw),
      input: { username: ['downtownpg', 'unbc'] },
    })
  }

  const apifyImportMatch = endpoint.match(/^\/instagram-apify\/run\/([^/]+)\/import$/)
  if (apifyImportMatch && method === 'POST') {
    return jsonResponse({
      success: true,
      runId: decodeURIComponent(apifyImportMatch[1]),
      stats: { attempted: 12, created: 4, skippedExisting: 8, missingAccounts: 0 },
      message: 'Demo Apify run imported: 4 created, 8 skipped',
    })
  }

  if (method === 'GET' && endpoint === '/instagram-review/queue') {
    return jsonResponse(instagramReviewQueue(url.searchParams))
  }

  if (method === 'GET' && endpoint === '/instagram-review/stats') {
    return jsonResponse(instagramReviewStats())
  }

  if (method === 'GET' && endpoint === '/instagram-review/accounts') {
    return jsonResponse({ accounts: instagramAccounts() })
  }

  if (method === 'POST' && endpoint === '/instagram-review/extract-missing') {
    return jsonResponse(bulkExtractResponse())
  }

  if (method === 'POST' && endpoint === '/instagram-review/ai-classify/bulk') {
    return jsonResponse(bulkAiClassifyResponse())
  }

  const instagramClassifyMatch = endpoint.match(/^\/instagram-review\/([^/]+)\/classify$/)
  if (instagramClassifyMatch && method === 'POST') {
    const postId = decodeURIComponent(instagramClassifyMatch[1])
    const isEventPoster = Boolean(asRecord(body).isEventPoster)
    demoRawEvents = demoRawEvents.map((item) =>
      item.event.id === postId ? { ...item, event: { ...item.event, isEventPoster, classificationConfidence: 0.91 } } : item
    )
    return jsonResponse({ message: 'Demo post classified', post: demoRawEvents.find((item) => item.event.id === postId)?.event })
  }

  const instagramExtractMatch = endpoint.match(/^\/instagram-review\/([^/]+)\/extract$/)
  if (instagramExtractMatch && method === 'POST') {
    return jsonResponse({ success: true, message: 'Demo event extraction complete', extraction: { provider: 'demo' }, eventsCreated: 1 })
  }

  const instagramAiClassifyMatch = endpoint.match(/^\/instagram-review\/([^/]+)\/ai-classify$/)
  if (instagramAiClassifyMatch && method === 'POST') {
    return jsonResponse({
      message: 'Demo AI classification complete',
      classification: { isEventPoster: true, confidence: 0.89, reasoning: 'Date, venue, and call-to-action detected', cues: ['date', 'venue'], shouldExtractEvents: true },
      post: demoRawEvents.find((item) => item.event.id === decodeURIComponent(instagramAiClassifyMatch[1]))?.event,
    })
  }

  if (method === 'GET' && endpoint === '/instagram-settings') {
    return jsonResponse({ settings: demoInstagramSettings })
  }

  if (method === 'PATCH' && endpoint === '/instagram-settings') {
    demoInstagramSettings = { ...demoInstagramSettings, ...asRecord(body), updatedAt: nowIso } as InstagramSettingsDemo
    return jsonResponse({ settings: demoInstagramSettings })
  }

  if (method === 'DELETE' && endpoint === '/instagram-settings/apify-token') {
    demoInstagramSettings = { ...demoInstagramSettings, hasApifyToken: false, updatedAt: nowIso }
    return jsonResponse({ message: 'Demo Apify token removed' })
  }

  if (method === 'DELETE' && endpoint === '/instagram-settings/gemini-key') {
    demoInstagramSettings = { ...demoInstagramSettings, hasGeminiKey: false, updatedAt: nowIso }
    return jsonResponse({ message: 'Demo Gemini key removed' })
  }

  if (method === 'DELETE' && endpoint === '/instagram-settings/claude-key') {
    demoInstagramSettings = { ...demoInstagramSettings, hasClaudeKey: false, updatedAt: nowIso }
    return jsonResponse({ message: 'Demo Claude key removed' })
  }

  if (method === 'POST' && endpoint === '/instagram-classify/backlog') {
    return jsonResponse({ processed: 8, classified: 8 })
  }

  if (method === 'GET' && endpoint === '/backups/list') {
    return jsonResponse({ backups: demoBackups })
  }

  if (method === 'POST' && endpoint === '/backups/export') {
    const backup: BackupBundle = {
      filename: `eventscrape-demo-${new Date().toISOString().slice(0, 10)}.zip`,
      size: 5100000,
      createdAt: new Date().toISOString(),
      manifest: {
        createdAt: new Date().toISOString(),
        includeDatabase: true,
        includeInstagramData: true,
        includeImages: false,
        counts: { instagramSources: 4, instagramAccounts: 4, instagramSessions: 2, instagramEvents: 38, instagramImages: 0 },
      },
    }
    demoBackups = [backup, ...demoBackups]
    return jsonResponse({ filename: backup.filename })
  }

  if (method === 'POST' && endpoint === '/backups/import') {
    return jsonResponse({ restored: { database: true, instagramData: true, images: false }, restarting: false })
  }

  const backupDeleteMatch = endpoint.match(/^\/backups\/([^/]+)$/)
  if (backupDeleteMatch && method === 'DELETE') {
    const filename = decodeURIComponent(backupDeleteMatch[1])
    demoBackups = demoBackups.filter((backup) => backup.filename !== filename)
    return jsonResponse({ message: 'Demo backup deleted' })
  }

  const backupDownloadMatch = endpoint.match(/^\/backups\/download\/([^/]+)$/)
  if (backupDownloadMatch && method === 'GET') {
    return new Response('Demo backup downloads are simulated in the browser.\n', {
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  const logsHistoryMatch = endpoint.match(/^\/logs\/history\/([^/]+)$/)
  if (logsHistoryMatch && method === 'GET') {
    const runId = decodeURIComponent(logsHistoryMatch[1])
    return jsonResponse({
      logs: [
        logEntry(runId, 30, 'Demo scraper initialized'),
        logEntry(runId, 30, 'Fetched source calendar fixture'),
        logEntry(runId, 30, 'Normalized 7 event candidates'),
        logEntry(runId, 40, 'Skipped duplicate by URL hash'),
      ],
    })
  }

  return jsonResponse({ error: `Demo API route not implemented: ${method} ${endpoint}` }, { status: 404 })
}

function shouldHandleDemoRequest(url: URL) {
  return isDemoMode() && (url.pathname === '/api' || url.pathname.startsWith('/api/'))
}

function requestUrl(input: FetchInput) {
  if (typeof window === 'undefined') {
    return null
  }

  if (typeof input === 'string') {
    return new URL(input, window.location.origin)
  }

  if (input instanceof URL) {
    return input
  }

  return new URL(input.url, window.location.origin)
}

function requestMethod(input: FetchInput, init?: FetchInit) {
  const initMethod = init?.method
  if (initMethod) {
    return initMethod.toUpperCase()
  }

  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.method.toUpperCase()
  }

  return 'GET'
}

async function requestJson(input: FetchInput, init?: FetchInit): Promise<unknown> {
  const body = init?.body

  if (typeof body === 'string' && body.length > 0) {
    return JSON.parse(body)
  }

  if (body instanceof FormData) {
    return Object.fromEntries(body.entries())
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return Object.fromEntries(body.entries())
  }

  if (!body && typeof Request !== 'undefined' && input instanceof Request) {
    const text = await input.clone().text()
    return text ? JSON.parse(text) : null
  }

  return null
}

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  })
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function numericParam(params: URLSearchParams, key: string, fallback: number) {
  const value = params.get(key)
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function numericBody(body: unknown, key: string) {
  const value = asRecord(body)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nextId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
}

function emptySummary(): RunChildSummary {
  return { total: 0, success: 0, failed: 0, pending: 0, running: 0, queued: 0 }
}

function paginate<T>(items: T[], page: number, limit: number) {
  const safeLimit = Math.max(1, limit)
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * safeLimit
  const pageItems = items.slice(start, start + safeLimit)
  const totalPages = Math.max(1, Math.ceil(items.length / safeLimit))

  return {
    items: pageItems,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: items.length,
      totalPages,
      hasNext: safePage < totalPages,
      hasPrev: safePage > 1,
    },
  }
}

function rawEventsResponse(params: URLSearchParams) {
  let items = [...demoRawEvents]
  const sourceId = params.get('sourceId')
  const sourceType = params.get('sourceType')
  const city = params.get('city')
  const category = params.get('category')
  const search = params.get('search')?.toLowerCase()

  if (sourceId) {
    items = items.filter((item) => item.event.sourceId === sourceId)
  }

  if (sourceType) {
    items = items.filter((item) => item.source.sourceType === sourceType)
  }

  if (city) {
    items = items.filter((item) => item.event.city?.toLowerCase() === city.toLowerCase())
  }

  if (category) {
    items = items.filter((item) => item.event.category?.toLowerCase() === category.toLowerCase())
  }

  if (search) {
    items = items.filter((item) =>
      [item.event.title, item.event.descriptionHtml, item.event.venueName, item.event.organizer]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(search))
    )
  }

  if (params.get('missingFields') === 'true') {
    items = items.filter((item) => !item.event.descriptionHtml || !item.event.venueName || !item.event.city)
  }

  if (params.get('hasSeries') === 'true') {
    items = items.filter((item) => Array.isArray(item.event.raw?.seriesDates) && item.event.raw.seriesDates.length > 1)
  }

  const sortBy = params.get('sortBy') ?? 'startDatetime'
  const sortOrder = params.get('sortOrder') === 'asc' ? 1 : -1
  items.sort((a, b) => {
    const aValue = sortValue(a, sortBy)
    const bValue = sortValue(b, sortBy)
    return aValue.localeCompare(bValue) * sortOrder
  })

  const paged = paginate(items, numericParam(params, 'page', 1), numericParam(params, 'limit', 20))
  return { events: paged.items, pagination: paged.pagination }
}

function canonicalEventsResponse(params: URLSearchParams) {
  let items = [...demoCanonicalEvents]
  const search = params.get('search')?.toLowerCase()
  const status = params.get('status')

  if (status) {
    items = items.filter((item) => item.status === status)
  }

  if (search) {
    items = items.filter((item) =>
      [item.title, item.descriptionHtml, item.venueName, item.organizer]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(search))
    )
  }

  const paged = paginate(items, numericParam(params, 'page', 1), numericParam(params, 'limit', 20))
  return { events: paged.items, pagination: paged.pagination }
}

function sortValue(item: EventWithSource, sortBy: string) {
  if (sortBy === 'source') {
    return item.source.name
  }

  const value = item.event[sortBy as keyof typeof item.event]
  return typeof value === 'string' ? value : ''
}

function createSource(data: Record<string, unknown>): Source {
  const name = typeof data.name === 'string' ? data.name : 'Demo Source'
  const baseUrl = typeof data.baseUrl === 'string' ? data.baseUrl : 'https://example.org/events'
  const moduleKey = typeof data.moduleKey === 'string' ? data.moduleKey : name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

  return {
    id: nextId('src'),
    name,
    baseUrl,
    moduleKey,
    sourceType: 'website',
    active: data.active !== false,
    defaultTimezone: typeof data.defaultTimezone === 'string' ? data.defaultTimezone : 'America/Vancouver',
    notes: typeof data.notes === 'string' ? data.notes : '',
    rateLimitPerMin: typeof data.rateLimitPerMin === 'number' ? data.rateLimitPerMin : 10,
    createdAt: nowIso,
    updatedAt: nowIso,
  } satisfies Source
}

function createInstagramSource(data: Record<string, unknown>): InstagramSource {
  const name = typeof data.name === 'string' ? data.name : 'Demo Instagram Account'
  const instagramUsername = typeof data.instagramUsername === 'string' ? data.instagramUsername.replace(/^@/, '') : 'demoaccount'
  const classificationMode = data.classificationMode === 'auto' ? 'auto' : 'manual'
  const instagramScraperType = data.instagramScraperType === 'instagram-private-api' ? 'instagram-private-api' : 'apify'

  return {
    id: nextId('ig'),
    name,
    instagramUsername,
    classificationMode,
    instagramScraperType,
    active: data.active !== false,
    defaultTimezone: typeof data.defaultTimezone === 'string' ? data.defaultTimezone : 'America/Vancouver',
    notes: typeof data.notes === 'string' ? data.notes : '',
    createdAt: nowIso,
    updatedAt: nowIso,
    postsCount: 0,
    eventCount: 0,
  } satisfies InstagramSource
}

function createWordPressSetting(data: Record<string, unknown>): WordPressSettings {
  return {
    id: nextId('wp'),
    name: typeof data.name === 'string' ? data.name : 'Demo WordPress',
    siteUrl: typeof data.siteUrl === 'string' ? data.siteUrl : 'https://events.example.org',
    username: typeof data.username === 'string' ? data.username : 'events-admin',
    active: data.active !== false,
    sourceCategoryMappings: asRecord(data.sourceCategoryMappings) as Record<string, number>,
    includeMedia: data.includeMedia !== false,
    createdAt: nowIso,
    updatedAt: nowIso,
  }
}

function createRun(source: Source, status: Run['status']): Run {
  return {
    id: nextId('run'),
    sourceId: source.id,
    startedAt: new Date(Date.now() - 42000).toISOString(),
    finishedAt: new Date().toISOString(),
    status,
    pagesCrawled: source.sourceType === 'instagram' ? 12 : 8,
    eventsFound: source.sourceType === 'instagram' ? 4 : 7,
  }
}

function demoRuns() {
  const children: RunListItem['children'] = [
    {
      run: {
        id: 'run_ig_child_1',
        sourceId: 'src_instagram',
        parentRunId: 'run_ig_batch',
        startedAt: '2026-04-22T15:00:05.000Z',
        finishedAt: '2026-04-22T15:02:10.000Z',
        status: 'success',
        pagesCrawled: 12,
        eventsFound: 4,
      },
      source: runSource(sourceById('src_instagram')),
    },
    {
      run: {
        id: 'run_ig_child_2',
        sourceId: 'src_instagram',
        parentRunId: 'run_ig_batch',
        startedAt: '2026-04-22T15:01:05.000Z',
        finishedAt: '2026-04-22T15:03:20.000Z',
        status: 'success',
        pagesCrawled: 12,
        eventsFound: 5,
      },
      source: runSource(sourceById('src_instagram')),
    },
    {
      run: {
        id: 'run_ig_child_3',
        sourceId: 'src_instagram',
        parentRunId: 'run_ig_batch',
        startedAt: '2026-04-22T15:02:05.000Z',
        finishedAt: '2026-04-22T15:04:45.000Z',
        status: 'error',
        pagesCrawled: 12,
        eventsFound: 2,
        errorsJsonb: { message: 'Demo account rate-limited after 12 posts.' },
      },
      source: runSource(sourceById('src_instagram')),
    },
  ]

  return demoRunsBase.map((item) =>
    item.run.id === 'run_ig_batch' ? { ...item, children } : item
  )
}

function runDetails(runId: string): RunWithSourceAndEvents {
  const runItem = demoRuns().flatMap((item) => [item, ...item.children.map((child) => ({
    run: child.run,
    source: child.source,
    children: [],
    summary: emptySummary(),
  }))]).find((item) => item.run.id === runId) ?? demoRuns()[0]

  const events = demoRawEvents
    .filter((item) => item.event.runId === runItem.run.id || runItem.run.id === 'run_ig_batch')
    .map(eventSummary)

  return {
    run: runItem.run,
    source: runItem.source,
    events,
    children: runItem.children,
  }
}

function matchEvent(eventId: string): MatchWithEvents['eventA'] {
  const item = demoRawEvents.find((candidate) => candidate.event.id === eventId) ?? demoRawEvents[0]
  return {
    id: item.event.id,
    title: item.event.title,
    startDatetime: item.event.startDatetime,
    city: item.event.city,
    venueName: item.event.venueName,
    url: item.event.url,
  }
}

function scrapeJob(source: InstagramSource): InstagramScrapeJob {
  return {
    accountId: source.id,
    username: source.instagramUsername,
    jobId: nextId('ig_job'),
    runId: nextId('run_ig'),
  }
}

function instagramAccounts(): InstagramAccount[] {
  return demoInstagramSources.map((source) => ({
    id: source.id,
    name: source.name,
    instagramUsername: source.instagramUsername,
    active: source.active,
  }))
}

function instagramReviewQueue(params: URLSearchParams): InstagramReviewQueueResponse {
  const accountId = params.get('accountId')
  const filter = params.get('filter') ?? 'pending'
  let posts = demoRawEvents
    .filter((item) => item.source.sourceType === 'instagram')
    .map(instagramReviewItem)

  if (accountId) {
    posts = posts.filter((item) => item.event.instagramAccountId === accountId)
  }

  if (filter === 'pending') {
    posts = posts.filter((item) => item.event.isEventPoster === null || item.event.isEventPoster === undefined)
  } else if (filter === 'event') {
    posts = posts.filter((item) => item.event.isEventPoster === true)
  } else if (filter === 'not-event') {
    posts = posts.filter((item) => item.event.isEventPoster === false)
  } else if (filter === 'needs-extraction') {
    posts = posts.filter((item) => item.event.isEventPoster === true && !Array.isArray(item.event.raw?.events))
  }

  const paged = paginate(posts, numericParam(params, 'page', 1), numericParam(params, 'limit', 20))
  return { posts: paged.items, pagination: paged.pagination }
}

function instagramReviewItem(item: EventWithSource): InstagramEventWithSource {
  const account = demoInstagramSources.find((source) => source.id === item.event.instagramAccountId) ?? null
  return {
    event: item.event,
    source: {
      id: item.source.id,
      name: item.source.name,
      moduleKey: item.source.moduleKey,
      instagramUsername: account?.instagramUsername ?? null,
    },
    account: account
      ? {
          id: account.id,
          name: account.name,
          instagramUsername: account.instagramUsername,
          classificationMode: account.classificationMode,
          active: account.active,
        }
      : null,
  }
}

function instagramReviewStats(): InstagramReviewStats {
  const posts = demoRawEvents.filter((item) => item.source.sourceType === 'instagram')
  return {
    unclassified: posts.filter((item) => item.event.isEventPoster === null || item.event.isEventPoster === undefined).length,
    markedAsEvent: posts.filter((item) => item.event.isEventPoster === true).length,
    markedAsNotEvent: posts.filter((item) => item.event.isEventPoster === false).length,
    needsExtraction: posts.filter((item) => item.event.isEventPoster === true && !Array.isArray(item.event.raw?.events)).length,
    total: posts.length,
  }
}

function bulkExtractResponse(): InstagramReviewBulkExtractResponse {
  return {
    success: true,
    message: 'Demo extraction completed',
    processed: 3,
    successful: 3,
    failed: 0,
    remaining: 0,
    results: [
      { id: 'raw_ig_unbc', status: 'success', eventsCreated: 1 },
      { id: 'raw_ig_theatre', status: 'success', eventsCreated: 1 },
    ],
  }
}

function bulkAiClassifyResponse(): InstagramReviewBulkAiClassifyResponse {
  return {
    success: true,
    message: 'Demo AI classification completed',
    processed: 3,
    successful: 3,
    failed: 0,
    remaining: 0,
    results: [
      { id: 'raw_ig_unbc', status: 'success', isEventPoster: true, confidence: 0.88 },
      { id: 'raw_ig_downtown', status: 'success', isEventPoster: false, confidence: 0.82 },
    ],
  }
}

function logEntry(runId: string, level: number, msg: string) {
  return {
    id: nextId('log'),
    timestamp: Date.now(),
    level,
    msg,
    runId,
    source: 'demo',
    raw: msg,
  }
}
