import type { InstagramEventWithSource } from '@/lib/api'

export type ExtractedEventDetails = {
  title?: string
  description?: string
  startDate?: string
  startTime?: string
  endDate?: string
  endTime?: string
  timezone?: string
  occurrenceType?: 'single' | 'multi_day' | 'recurring' | 'all_day' | 'virtual'
  recurrenceType?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
  seriesDates?: Array<{
    start?: string
    end?: string
  }>
  venue?: {
    name?: string
    address?: string
    city?: string
    region?: string
    country?: string
  }
  organizer?: string
  category?: string
  price?: string
  tags?: string[]
  url?: string
  registrationUrl?: string
  contactInfo?: {
    phone?: string
    email?: string
    website?: string
  }
  additionalInfo?: string
}

export const parseEventRaw = (raw: unknown) => {
  if (!raw) return undefined

  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  }

  if (typeof raw === 'object') {
    return raw as Record<string, unknown>
  }

  return undefined
}

const findFirstString = (data: unknown, paths: string[][]) => {
  if (!data || typeof data !== 'object') return undefined

  for (const path of paths) {
    let current: unknown = data
    for (const key of path) {
      if (current && typeof current === 'object' && key in (current as Record<string, unknown>)) {
        current = (current as Record<string, unknown>)[key]
      } else {
        current = undefined
        break
      }
    }

    if (typeof current === 'string' && current.trim().length > 0) {
      return current.trim()
    }
  }

  return undefined
}

export const deriveAccountDetails = (item: InstagramEventWithSource) => {
  const parsedRaw = parseEventRaw(item.event.raw)

  const accountUsername = item.account?.instagramUsername?.trim()
  const accountName = item.account?.name?.trim()
  const sourceUsername = item.source?.instagramUsername?.trim()
  const sourceName = item.source?.name?.trim()

  const username =
    accountUsername ||
    sourceUsername ||
    findFirstString(parsedRaw, [
      ['instagram', 'username'],
      ['instagram', 'author', 'username'],
      ['account', 'username'],
      ['profile', 'username'],
      ['post', 'username'],
      ['post', 'owner', 'username'],
      ['user', 'username'],
      ['owner', 'username'],
    ])

  const rawName = findFirstString(parsedRaw, [
    ['instagram', 'author', 'name'],
    ['instagram', 'author', 'fullName'],
    ['instagram', 'author', 'full_name'],
    ['account', 'name'],
    ['profile', 'name'],
    ['post', 'owner', 'full_name'],
    ['owner', 'full_name'],
    ['user', 'full_name'],
    ['organizer'],
  ])

  const displayName =
    (accountName && accountName.toLowerCase() !== 'instagram' ? accountName : undefined) ||
    (sourceName && sourceName.toLowerCase() !== 'instagram' ? sourceName : undefined) ||
    (rawName && rawName.toLowerCase() !== 'instagram' ? rawName : undefined)

  return {
    username,
    displayName,
  }
}

export const getExtractedEvents = (
  event: InstagramEventWithSource['event']
): ExtractedEventDetails[] => {
  const parsed = parseEventRaw(event.raw)
  if (!parsed) return []

  if (Array.isArray((parsed as Record<string, unknown>).events)) {
    return (parsed as { events: ExtractedEventDetails[] }).events
  }

  return []
}
