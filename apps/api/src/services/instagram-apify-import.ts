import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import axios from 'axios'
import { v4 as uuidv4 } from 'uuid'
import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { eventsRaw, instagramAccounts, runs } from '../db/schema.js'
import type { ApifyPost } from '../../../../worker/src/modules/instagram/enhanced-apify-client.js'
import { INSTAGRAM_SOURCE_ID, DOWNLOAD_DIR as DEFAULT_DOWNLOAD_DIR } from '../routes/instagram-review/constants.js'

const INSTAGRAM_IMAGES_DIR = process.env.INSTAGRAM_IMAGES_DIR || DEFAULT_DOWNLOAD_DIR || '/data/instagram_images'

if (!fs.existsSync(INSTAGRAM_IMAGES_DIR)) {
  fs.mkdirSync(INSTAGRAM_IMAGES_DIR, { recursive: true })
}

export interface ImportStats {
  attempted: number
  created: number
  updated: number
  skippedExisting: number
  missingAccounts: number
}

export interface ImportOptions {
  apifyRunId?: string
  parentRunId?: string
  metadata?: Record<string, unknown>
  sourceLabel?: string
}

export interface ImportResult {
  runId: string
  stats: ImportStats
  message: string
}

function getUsername(post: ApifyPost): string | null {
  return post.username || post.ownerUsername || null
}

async function downloadInstagramImage(imageUrl: string, postId: string): Promise<string | null> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'stream',
      timeout: 30000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Referer: 'https://www.instagram.com/',
        'Sec-Fetch-Dest': 'image',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        'sec-ch-ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      },
    })

    const urlPath = new URL(imageUrl).pathname
    const ext = path.extname(urlPath) || '.jpg'
    const filename = `${postId}${ext}`
    const filepath = path.join(INSTAGRAM_IMAGES_DIR, filename)

    await pipeline(response.data, fs.createWriteStream(filepath))

    return filename
  } catch (error: any) {
    console.error(`Failed to download image for post ${postId}:`, error.message)
    return null
  }
}

export async function importInstagramPostsFromApify(
  posts: ApifyPost[],
  options: ImportOptions = {}
): Promise<ImportResult> {
  const stats: ImportStats = {
    attempted: posts.length,
    created: 0,
    updated: 0,
    skippedExisting: 0,
    missingAccounts: 0,
  }

  const metadata: Record<string, unknown> = {
    importStrategy: 'apify_direct',
    ...(options.metadata || {}),
  }
  if (options.apifyRunId) {
    metadata.apifyRunId = options.apifyRunId
  }

  const [runRecord] = await db
    .insert(runs)
    .values({
      id: uuidv4(),
      sourceId: INSTAGRAM_SOURCE_ID,
      status: 'running',
      parentRunId: options.parentRunId ?? null,
      metadata,
    })
    .returning()

  if (posts.length === 0) {
    await db
      .update(runs)
      .set({
        status: 'partial',
        finishedAt: new Date(),
        eventsFound: 0,
      })
      .where(eq(runs.id, runRecord.id))

    return {
      runId: runRecord.id,
      stats,
      message: 'No posts were imported.',
    }
  }

  const usernames = Array.from(
    new Set(
      posts
        .map((post) => getUsername(post))
        .filter((username): username is string => Boolean(username))
    )
  )

  const accounts = usernames.length
    ? await db
        .select()
        .from(instagramAccounts)
        .where(inArray(instagramAccounts.instagramUsername, usernames))
    : []

  const accountMap = new Map(accounts.map((account) => [account.instagramUsername, account]))

  const postIds = Array.from(new Set(posts.map((post) => post.id).filter(Boolean)))

  const existing = postIds.length
    ? await db
        .select({
          id: eventsRaw.id,
          instagramPostId: eventsRaw.instagramPostId,
          localImagePath: eventsRaw.localImagePath,
        })
        .from(eventsRaw)
        .where(inArray(eventsRaw.instagramPostId, postIds))
    : []

  const existingMap = new Map(existing.map((row) => [row.instagramPostId!, row]))

  for (const post of posts) {
    const username = getUsername(post)

    if (!username) {
      stats.missingAccounts++
      continue
    }

    const account = accountMap.get(username)
    if (!account) {
      stats.missingAccounts++
      continue
    }

    const existingPost = existingMap.get(post.id)
    const imageUrl = post.imageUrl

    if (existingPost) {
      if (!existingPost.localImagePath && imageUrl) {
        const localImagePath = await downloadInstagramImage(imageUrl, post.id)
        if (localImagePath) {
          await db
            .update(eventsRaw)
            .set({ localImagePath })
            .where(eq(eventsRaw.id, existingPost.id))
          stats.updated++
        }
      }

      stats.skippedExisting++
      continue
    }

    let localImagePath: string | null = null
    if (imageUrl) {
      localImagePath = await downloadInstagramImage(imageUrl, post.id)
    }

    const timestamp = post.timestamp instanceof Date ? post.timestamp : new Date(post.timestamp)
    const permalink = post.permalink || `https://instagram.com/p/${post.id}/`

    const rawData = {
      ...post,
      _meta: {
        importedAt: new Date().toISOString(),
        apifyRunId: options.apifyRunId ?? null,
        importer: 'apify_direct',
      },
    }

    await db.insert(eventsRaw).values({
      sourceId: INSTAGRAM_SOURCE_ID,
      runId: runRecord.id,
      sourceEventId: post.id,
      title: post.caption?.slice(0, 200) || 'Instagram Post',
      descriptionHtml: post.caption || '',
      startDatetime: timestamp,
      timezone: account.defaultTimezone || 'America/Vancouver',
      url: permalink,
      imageUrl: post.imageUrl,
      localImagePath,
      raw: JSON.stringify(rawData),
      contentHash: post.id,
      instagramAccountId: account.id,
      instagramPostId: post.id,
      instagramCaption: post.caption,
    })

    stats.created++
  }

  await db
    .update(runs)
    .set({
      status: stats.created > 0 ? 'success' : 'partial',
      finishedAt: new Date(),
      eventsFound: stats.created,
    })
    .where(eq(runs.id, runRecord.id))

  const sourceLabel = options.sourceLabel || (options.apifyRunId ? `Apify run ${options.apifyRunId}` : 'Apify')

  const message =
    stats.created > 0
      ? `Imported ${stats.created} new post${stats.created === 1 ? '' : 's'} from ${sourceLabel}.${
          stats.updated > 0 ? ` Updated ${stats.updated} existing post${stats.updated === 1 ? '' : 's'} with images.` : ''
        }`
      : stats.updated > 0
        ? `Updated ${stats.updated} existing post${stats.updated === 1 ? '' : 's'} with images.`
        : stats.skippedExisting > 0
          ? 'No new posts imported; all posts already exist.'
          : stats.missingAccounts > 0
            ? 'Skipped posts because matching accounts were not found.'
            : 'No posts were imported.'

  return {
    runId: runRecord.id,
    stats,
    message,
  }
}
