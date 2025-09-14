import type { ScraperModule, RunContext, RawEvent } from '../../types.js'
import { DateTime } from 'luxon'

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

    if (!data || !Array.isArray(data.events)) {
      throw new Error('Invalid JSON: expected an "events" array')
    }

    const events: RawEvent[] = []
    const extractionNotes = data.extractionConfidence?.notes || ''

    for (const posterEvent of data.events) {
      try {
        if (!posterEvent?.title || typeof posterEvent.title !== 'string') {
          logger.warn('Skipping entry without a valid title')
          continue
        }

        const tz = posterEvent.timezone || DEFAULT_TZ
        const startIso = constructIsoDateTime(posterEvent.startDate, posterEvent.startTime, tz)
        const endIso = posterEvent.endDate || posterEvent.endTime
          ? constructIsoDateTime(posterEvent.endDate || posterEvent.startDate, posterEvent.endTime || posterEvent.startTime, tz)
          : undefined

        const eventUrl = posterEvent.registrationUrl || generateSyntheticUrl(posterEvent.title)
        const sourceEventId = `ai_poster_${slugify(posterEvent.title)}_${posterEvent.startDate || 'undated'}`

        const venue = posterEvent.venue || {}
        const tags: string[] = Array.isArray(posterEvent.tags) ? [...posterEvent.tags] : []
        if (posterEvent.category) {
          const cat = String(posterEvent.category).toLowerCase()
          if (!tags.includes(cat)) tags.push(cat)
        }

        const rawEvent: RawEvent = {
          sourceEventId,
          title: posterEvent.title,
          descriptionHtml: formatDescriptionHtml(posterEvent, data?.extractionConfidence),
          start: startIso,
          end: endIso,
          venueName: venue.name || undefined,
          venueAddress: venue.address || undefined,
          city: venue.city || 'Prince George',
          region: venue.region || 'BC',
          country: venue.country || 'Canada',
          organizer: posterEvent.organizer || undefined,
          category: posterEvent.category || 'Community',
          price: posterEvent.price || undefined,
          tags: tags.length ? tags : undefined,
          url: eventUrl,
          imageUrl: posterEvent.imageUrl || undefined,
          raw: {
            source: 'ai_poster_extraction',
            originalData: posterEvent,
            extractionConfidence: data.extractionConfidence,
            extractedAt: new Date().toISOString(),
            extractionNotes,
          },
        }

        events.push(rawEvent)
        logger.info(`Processed poster event: ${posterEvent.title}`)
      } catch (err: any) {
        logger.error(`Failed to process poster event: ${err?.message || err}`)
      }
    }

    if (data.extractionConfidence?.overall) {
      try {
        const pct = (Number(data.extractionConfidence.overall) * 100).toFixed(0)
        logger.info(`Extraction confidence: ${pct}%`)
      } catch {}
    }
    if (extractionNotes) logger.info(`Extraction notes: ${extractionNotes}`)

    return events
  },
}

export default aiPosterImport

function constructIsoDateTime(date: string | undefined, time: string | undefined, timezone: string): string {
  // Default to today if no date
  let base = (date && typeof date === 'string') ? date.trim() : DateTime.now().setZone(timezone).toISODate()!

  // Try ISO first
  let dt = DateTime.fromISO(base, { zone: timezone })
  if (!dt.isValid) {
    const fmts = ['MM/dd/yyyy', 'dd/MM/yyyy', 'MMM d, yyyy', 'MMMM d, yyyy']
    for (const f of fmts) {
      dt = DateTime.fromFormat(base, f, { zone: timezone })
      if (dt.isValid) break
    }
    if (!dt.isValid) {
      const js = new Date(base)
      if (!isNaN(js.getTime())) {
        dt = DateTime.fromJSDate(js, { zone: timezone })
      }
    }
  }
  if (!dt.isValid) throw new Error(`Unparseable date: ${date}`)

  if (time) {
    // Support HH:mm and h:mm a formats
    let t = DateTime.fromFormat(time, 'H:mm', { zone: timezone })
    if (!t.isValid) t = DateTime.fromFormat(time, 'h:mm a', { zone: timezone })
    if (t.isValid) dt = dt.set({ hour: t.hour, minute: t.minute })
  }
  return dt.toISO()!
}

function slugify(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

function generateSyntheticUrl(title: string): string {
  return `https://ai-import.local/event/${slugify(title)}-${Date.now()}`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatDescriptionHtml(posterEvent: any, extractionConfidence?: any): string | undefined {
  const parts: string[] = []

  if (posterEvent.description) parts.push(`<p>${escapeHtml(String(posterEvent.description))}</p>`)

  const contact = posterEvent.contactInfo
  if (contact && (contact.phone || contact.email || contact.website)) {
    parts.push('<h4>Contact Information</h4>')
    parts.push('<ul>')
    if (contact.phone) parts.push(`<li>Phone: ${escapeHtml(String(contact.phone))}</li>`)
    if (contact.email) parts.push(`<li>Email: <a href="mailto:${escapeHtml(String(contact.email))}">${escapeHtml(String(contact.email))}</a></li>`)
    if (contact.website) parts.push(`<li>Website: <a href="${escapeHtml(String(contact.website))}" target="_blank">${escapeHtml(String(contact.website))}</a></li>`)
    parts.push('</ul>')
  }

  if (posterEvent.additionalInfo) {
    parts.push(`<p><strong>Additional Information:</strong> ${escapeHtml(String(posterEvent.additionalInfo))}</p>`)
  }

  if (extractionConfidence?.overall != null) {
    try {
      const pct = (Number(extractionConfidence.overall) * 100).toFixed(0)
      parts.push(`<p><em>Extraction confidence: ${pct}%</em></p>`)
    } catch {}
  }

  return parts.length ? parts.join('\n') : undefined
}

