import type { ScraperModule, RunContext, RawEvent } from '../../types.js'
import { mapAiEventToCore, type WrapperMeta } from './ai-event-core.js'

// AI Poster Import module: expects JSON pasted/uploaded via the Admin UI or /api/uploads
// The JSON format should be:
// {
//   "events": [
//     {
//       "title": string,
//       "description"?: string,
//       "startDate"?: string,   // e.g., 2025-09-01 or Sep 1, 2025
//       "startTime"?: string,   // e.g., 19:30
//       "endDate"?: string,
//       "endTime"?: string,
//       "timezone"?: string,    // e.g., America/Vancouver
//       "organizer"?: string,
//       "category"?: string,
//       "price"?: string,
//       "tags"?: string[],
//       "registrationUrl"?: string,
//       "imageUrl"?: string,
//       "venue"?: {
//         "name"?: string,
//         "address"?: string,
//         "city"?: string,
//         "region"?: string,
//         "country"?: string
//       }
//     }
//   ],
//   "extractionConfidence"?: { overall?: number, notes?: string }
// }

const DEFAULT_TZ = 'America/Vancouver'
const INCLUDE_ADDITIONAL_INFO_IN_DESCRIPTION =
  process.env.AI_POSTER_INCLUDE_ADDITIONAL_INFO === 'true'
const INCLUDE_CONFIDENCE_IN_DESCRIPTION =
  process.env.AI_POSTER_INCLUDE_CONFIDENCE === 'true'
const INCLUDE_CATEGORY_IN_RAW =
  process.env.AI_POSTER_INCLUDE_CATEGORY === 'true'

const aiPosterImport: ScraperModule = {
  key: 'ai_poster_import',
  label: 'AI Poster Import',
  startUrls: [],
  mode: 'upload',
  paginationType: 'none',
  // Using 'csv' tag is how the current Admin UI detects "upload mode" availability
  integrationTags: ['csv'],
  uploadConfig: {
    supportedFormats: ['json'],
    instructions:
      'Use the Poster Import prompt to extract events into JSON, then upload/paste the JSON here.',
  },

  async run(ctx: RunContext): Promise<RawEvent[]> {
    const { logger, jobData } = ctx

    // Upload-only module: expect an uploaded JSON payload
    if (jobData?.uploadedFile) {
      const file = jobData.uploadedFile
      if (file.format !== 'json') {
        logger.error(`AI Poster Import only supports JSON uploads, got: ${file.format}`)
        throw new Error(`Unsupported file format: ${file.format}`)
      }
      if (!file.content) {
        logger.error('Uploaded JSON file content is empty')
        throw new Error('Uploaded JSON content is required')
      }
      return this.processUpload!(file.content, 'json', logger)
    }

    logger.warn('AI Poster Import run invoked without uploadedFile; returning no events')
    return []
  },

  async processUpload(content: string, format: 'json', logger: any): Promise<RawEvent[]> {
    if (format !== 'json') {
      throw new Error('AI Poster Import only supports JSON format')
    }

    let data: any
    try {
      data = JSON.parse(content)
    } catch (e: any) {
      logger.error(`Failed parsing JSON: ${e?.message || e}`)
      throw e
    }

    const normalizedEvents = normalizeUploadPayload(data, logger)
    if (!normalizedEvents.length) {
      logger.warn('No events found in uploaded payload')
      return []
    }

    const events: RawEvent[] = []
    const seenConfidenceLogs = new Set<string>()
    const seenNoteLogs = new Set<string>()

    for (const { event: posterEvent, extractionConfidence, wrapperMeta } of normalizedEvents) {
      try {
        if (!posterEvent?.title || typeof posterEvent.title !== 'string') {
          logger.warn('Skipping entry without a valid title')
          continue
        }

        const tz = posterEvent.timezone || DEFAULT_TZ
        const core = mapAiEventToCore(posterEvent, {
          defaultTimezone: tz,
          extractionConfidence,
          wrapperMeta: wrapperMeta as WrapperMeta | undefined,
          fallbackLocation: {
            city: 'Prince George',
            region: 'BC',
            country: 'Canada',
          },
          includeAdditionalInfoInDescription: resolveDescriptionOption(
            posterEvent,
            'includeAdditionalInfoInDescription',
            INCLUDE_ADDITIONAL_INFO_IN_DESCRIPTION,
          ),
          includeConfidenceInDescription: resolveDescriptionOption(
            posterEvent,
            'includeConfidenceInDescription',
            INCLUDE_CONFIDENCE_IN_DESCRIPTION,
          ),
          includeCategoryInTags: true,
        })

        const eventUrl = wrapperMeta?.post?.url
          || posterEvent.registrationUrl
          || generateSyntheticUrl(posterEvent.title)

        const sourceEventId = createSourceEventId(posterEvent.title, posterEvent.startDate, wrapperMeta)

        const rawEvent: RawEvent = {
          sourceEventId,
          title: core.title,
          descriptionHtml: core.descriptionHtml,
          start: core.startIso,
          end: core.endIso,
          venueName: core.venueName,
          venueAddress: core.venueAddress,
          city: core.city || 'Prince George',
          region: core.region || 'BC',
          country: core.country || 'Canada',
          organizer: core.organizer,
          category: INCLUDE_CATEGORY_IN_RAW ? (posterEvent.category || undefined) : undefined,
          price: core.price,
          tags: core.tags,
          url: eventUrl,
          imageUrl: core.imageUrl,
          raw: {
            source: 'ai_poster_extraction',
            originalData: posterEvent,
            extractionConfidence: extractionConfidence,
            extractedAt: new Date().toISOString(),
            extractionNotes: extractionConfidence?.notes,
            massPosterMeta: wrapperMeta,
          },
        }

        events.push(rawEvent)
        logger.info(`Processed poster event: ${posterEvent.title}`)

        if (extractionConfidence?.overall != null) {
          const key = `confidence:${extractionConfidence.overall}`
          if (!seenConfidenceLogs.has(key)) {
            try {
              const pct = (Number(extractionConfidence.overall) * 100).toFixed(0)
              logger.info(`Extraction confidence: ${pct}%`)
            } catch {}
            seenConfidenceLogs.add(key)
          }
        }

        if (extractionConfidence?.notes) {
          const noteKey = `note:${extractionConfidence.notes}`
          if (!seenNoteLogs.has(noteKey)) {
            logger.info(`Extraction notes: ${extractionConfidence.notes}`)
            seenNoteLogs.add(noteKey)
          }
        }
      } catch (err: any) {
        logger.error(`Failed to process poster event: ${err?.message || err}`)
      }
    }

    return events
  },
}

export default aiPosterImport


function normalizeUploadPayload(data: any, logger: any): {
  event: any
  extractionConfidence?: any
  wrapperMeta?: {
    club?: {
      id?: number | string
      name?: string
      username?: string
      profileUrl?: string
      platform?: string
    }
    post?: {
      dbId?: string
      postId?: number | string
      postInstagramId?: string
      url?: string
      caption?: string
      imageUrl?: string
      timestamp?: string
    }
  }
}[] {
  if (!data) return []

  if (Array.isArray(data.events)) {
    return data.events.map((event: any) => ({
      event,
      extractionConfidence: data.extractionConfidence,
    }))
  }

  if (Array.isArray(data)) {
    const normalized: {
      event: any
      extractionConfidence?: any
      wrapperMeta?: any
    }[] = []

    for (const clubEntry of data) {
      if (!clubEntry || typeof clubEntry !== 'object') continue

      const clubMeta = {
        id: clubEntry.club_id ?? clubEntry.clubId,
        name: clubEntry.club_name ?? clubEntry.clubName,
        username: clubEntry.club_username ?? clubEntry.clubUsername,
        profileUrl: clubEntry.club_profile_url ?? clubEntry.clubProfileUrl,
        platform: clubEntry.platform,
      }

      if (!Array.isArray(clubEntry.events)) continue

      for (const eventWrapper of clubEntry.events) {
        if (!eventWrapper || typeof eventWrapper !== 'object') continue

        const postMeta = {
          dbId: eventWrapper.db_id,
          postId: eventWrapper.post_id,
          postInstagramId: eventWrapper.post_instagram_id,
          url: eventWrapper.post_url || eventWrapper.url,
          caption: eventWrapper.post_caption,
          imageUrl: eventWrapper.post_image_url,
          timestamp: eventWrapper.post_timestamp,
        }

        const payload = eventWrapper.payload
        const payloadEvents: any[] = Array.isArray(payload?.events) ? payload.events : []

        if (!payloadEvents.length) {
          logger?.warn?.('Skipping club event wrapper without payload events')
          continue
        }

        const extractionConfidence = payload?.extractionConfidence
          || (eventWrapper.extraction_confidence != null
            ? { overall: eventWrapper.extraction_confidence }
            : undefined)

        for (const payloadEvent of payloadEvents) {
          if (!payloadEvent || typeof payloadEvent !== 'object') continue

          const mergedEvent = {
            ...payloadEvent,
          }

          if (!mergedEvent.organizer && clubMeta.name) {
            mergedEvent.organizer = clubMeta.name
          }
          if (!mergedEvent.imageUrl && postMeta.imageUrl) {
            mergedEvent.imageUrl = postMeta.imageUrl
          }

          normalized.push({
            event: mergedEvent,
            extractionConfidence,
            wrapperMeta: {
              club: clubMeta,
              post: postMeta,
            },
          })
        }
      }
    }

    return normalized
  }

  throw new Error('Invalid JSON: expected an object with events[] or an array of club entries')
}

function createSourceEventId(title: string, startDate: string | undefined, wrapperMeta?: {
  post?: {
    postInstagramId?: string
    postId?: number | string
    dbId?: string
  }
}): string {
  const base = slugify(title) || 'event'
  const tokens: string[] = [base]

  const post = wrapperMeta?.post
  if (post?.postInstagramId) tokens.push(slugify(String(post.postInstagramId)))
  else if (post?.postId != null) tokens.push(slugify(String(post.postId)))
  else if (post?.dbId) tokens.push(slugify(String(post.dbId)))
  else if (startDate) tokens.push(slugify(String(startDate)))
  else tokens.push('undated')

  return `ai_poster_${tokens.filter(Boolean).join('_')}`
}

function slugify(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

function generateSyntheticUrl(title: string): string {
  return `https://ai-import.local/event/${slugify(title)}-${Date.now()}`
}

function resolveDescriptionOption(
  event: any,
  key: 'includeAdditionalInfoInDescription' | 'includeConfidenceInDescription',
  defaultValue: boolean,
): boolean {
  const directValue = event?.[key]
  if (typeof directValue === 'boolean') return directValue

  const descriptionOptions = event?.descriptionOptions
  if (descriptionOptions && typeof descriptionOptions[key] === 'boolean') {
    return descriptionOptions[key]
  }

  return defaultValue
}
