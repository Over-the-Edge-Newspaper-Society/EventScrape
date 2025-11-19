import { DateTime } from 'luxon'

export interface AiEventCore {
  title: string
  descriptionHtml?: string
  startIso: string
  endIso?: string
  timezone: string
  venueName?: string
  venueAddress?: string
  city?: string
  region?: string
  country?: string
  organizer?: string
  category?: string
  price?: string
  tags?: string[]
  imageUrl?: string
}

export interface WrapperMeta {
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

export interface AiEventCoreOptions {
  defaultTimezone: string
  extractionConfidence?: any
  wrapperMeta?: WrapperMeta
  fallbackLocation?: {
    city?: string
    region?: string
    country?: string
  }
  includeAdditionalInfoInDescription: boolean
  includeConfidenceInDescription: boolean
  includeCategoryInTags: boolean
}

/**
 * Shared mapper from AI poster-style event JSON into a normalized event core
 * (dates, venue, tags, HTML description). This is used by both the AI poster
 * import module and the Instagram AI extraction flow.
 */
export function mapAiEventToCore(event: any, options: AiEventCoreOptions): AiEventCore {
  if (!event || typeof event !== 'object') {
    throw new Error('Invalid AI event payload')
  }

  if (!event.title || typeof event.title !== 'string') {
    throw new Error('AI event is missing a valid title')
  }

  const tz = typeof event.timezone === 'string' && event.timezone.trim().length > 0
    ? event.timezone
    : options.defaultTimezone

  const startIso = constructIsoDateTime(event.startDate, event.startTime, tz)
  const endIso =
    event.endDate || event.endTime
      ? constructIsoDateTime(event.endDate || event.startDate, event.endTime || event.startTime, tz)
      : undefined

  const venue = event.venue || {}
  const tags: string[] = Array.isArray(event.tags) ? [...event.tags] : []

  if (options.includeCategoryInTags && event.category) {
    const cat = String(event.category).toLowerCase()
    if (!tags.includes(cat)) tags.push(cat)
  }

  const descriptionHtml = formatDescriptionHtml(event, options.extractionConfidence, {
    includeAdditionalInfoInDescription: options.includeAdditionalInfoInDescription,
    includeConfidenceInDescription: options.includeConfidenceInDescription,
  })

  const city =
    venue.city ??
    options.fallbackLocation?.city
  const region =
    venue.region ??
    options.fallbackLocation?.region
  const country =
    venue.country ??
    options.fallbackLocation?.country

  const organizer = event.organizer || options.wrapperMeta?.club?.name

  return {
    title: event.title,
    descriptionHtml,
    startIso,
    endIso,
    timezone: tz,
    venueName: venue.name || undefined,
    venueAddress: venue.address || undefined,
    city: city || undefined,
    region: region || undefined,
    country: country || undefined,
    organizer: organizer || undefined,
    category: event.category || undefined,
    price: event.price || undefined,
    tags: tags.length ? tags : undefined,
    imageUrl: event.imageUrl || options.wrapperMeta?.post?.imageUrl || undefined,
  }
}

function constructIsoDateTime(date: string | undefined, time: string | undefined, timezone: string): string {
  // Default to today if no date
  let base =
    date && typeof date === 'string'
      ? date.trim()
      : DateTime.now().setZone(timezone).toISODate()!

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatDescriptionHtml(
  posterEvent: any,
  extractionConfidence: any,
  options: {
    includeAdditionalInfoInDescription: boolean
    includeConfidenceInDescription: boolean
  },
): string | undefined {
  const parts: string[] = []

  if (posterEvent.description) parts.push(`<p>${escapeHtml(String(posterEvent.description))}</p>`)

  const contact = posterEvent.contactInfo
  if (contact && (contact.phone || contact.email || contact.website)) {
    parts.push('<h4>Contact Information</h4>')
    parts.push('<ul>')
    if (contact.phone) parts.push(`<li>Phone: ${escapeHtml(String(contact.phone))}</li>`)
    if (contact.email) {
      const email = escapeHtml(String(contact.email))
      parts.push(`<li>Email: <a href="mailto:${email}">${email}</a></li>`)
    }
    if (contact.website) {
      const website = escapeHtml(String(contact.website))
      parts.push(`<li>Website: <a href="${website}" target="_blank">${website}</a></li>`)
    }
    parts.push('</ul>')
  }

  if (options.includeAdditionalInfoInDescription && posterEvent.additionalInfo) {
    parts.push(
      `<p><strong>Additional Information:</strong> ${escapeHtml(
        String(posterEvent.additionalInfo),
      )}</p>`,
    )
  }

  if (options.includeConfidenceInDescription && extractionConfidence?.overall != null) {
    try {
      const pct = (Number(extractionConfidence.overall) * 100).toFixed(0)
      parts.push(`<p><em>Extraction confidence: ${pct}%</em></p>`)
    } catch {}
  }

  return parts.length ? parts.join('\n') : undefined
}

