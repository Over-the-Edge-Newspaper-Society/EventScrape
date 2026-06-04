import axios from 'axios';
import { makeFunctionReference } from 'convex/server';
import {
  convex,
  workerApi,
  uploadToConvexStorage,
  appendRunLog,
} from '../lib/convex.js';
import { createEnhancedApifyClient } from '../modules/instagram/enhanced-apify-client.js';
import type { JobShim } from '../types.js';

// Convex run worker job for "import an Apify run into events" (ports the old
// POST /api/instagram-apify/run/:runId/import route, which used the API's
// importInstagramPostsFromApify service). Reuses the worker's EnhancedApifyClient
// to read the run snapshot, then attributes each post to an instagramAccounts row
// (by username), uploads its image to Convex storage, and upserts the post.
// Tracks attempted / created / skippedExisting / missingAccounts for parity.

// resolveAccountByUsername lives in convex/instagramApifyQueue.ts; reference it
// by name (the worker stays decoupled from convex/_generated).
const resolveAccountByUsername = makeFunctionReference<'query'>(
  'instagramApifyQueue:resolveAccountByUsername',
);

interface ApifyImportPayload {
  apifyRunId: string;
  limit?: number;
}

function postUsername(post: any): string | null {
  return post.username || post.ownerUsername || null;
}

function contentTypeForUrl(imageUrl: string): { ext: string; contentType: string } {
  const clean = imageUrl.split('?')[0];
  const ext = (clean.split('.').pop() || 'jpg').toLowerCase();
  const contentType =
    ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { ext, contentType };
}

async function downloadImageBytes(imageUrl: string): Promise<Buffer> {
  const response = await axios.get(imageUrl, {
    responseType: 'arraybuffer',
    timeout: 30000,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      Referer: 'https://www.instagram.com/',
    },
  });
  return Buffer.from(response.data);
}

export async function handleApifyImportJob(job: JobShim<any>): Promise<void> {
  const payload = (job.data || {}) as ApifyImportPayload;
  const apifyRunId = payload.apifyRunId;
  const limit = payload.limit ?? 50;

  if (!apifyRunId) {
    throw new Error('apifyImport job missing apifyRunId in payload');
  }

  job.log(`Starting Apify run import for run ${apifyRunId} (limit ${limit})`);

  // 1. Apify token + client.
  const config = await workerApi.getInstagramConfig();
  const apifyApiToken = config?.apifyApiToken;
  if (!apifyApiToken) {
    throw new Error('Apify API token not configured');
  }
  const client = await createEnhancedApifyClient(
    apifyApiToken,
    config?.apifyActorId || undefined,
  );

  // 2. Read the run snapshot.
  const snapshot = await client.fetchRunSnapshot(apifyRunId, limit);
  const posts = snapshot.posts ?? [];
  job.log(`Fetched ${posts.length} posts from Apify run ${apifyRunId}`);

  // 3. Create a run to attribute the imported posts to (parity with the old
  //    service, which inserted a runs row before importing).
  const runId = (await workerApi.createInstagramRun({
    metadata: {
      importStrategy: 'apify_direct',
      importMethod: 'apify_run_import',
      apifyRunId,
      apifyRunInput: snapshot.input ?? null,
    },
  })) as string;

  const stats = {
    attempted: posts.length,
    created: 0,
    skippedExisting: 0,
    missingAccounts: 0,
  };

  // Cache account lookups by username within this run, plus the set of post ids
  // already stored for that account (used to distinguish created vs
  // skippedExisting, since upsertInstagramPost patches existing rows silently).
  const accountCache = new Map<string, any>();
  const knownIdsCache = new Map<string, Set<string>>();

  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    const username = postUsername(post);

    if (!username) {
      stats.missingAccounts++;
      continue;
    }

    let account = accountCache.get(username);
    if (account === undefined) {
      account = await convex.query(resolveAccountByUsername, { username });
      accountCache.set(username, account);
    }
    if (!account) {
      stats.missingAccounts++;
      continue;
    }

    // Skip posts already imported for this account (parity with the old
    // service's skippedExisting). Cache the known-id set per account.
    let knownIds = knownIdsCache.get(username);
    if (!knownIds) {
      const ids = (await workerApi.getKnownInstagramPostIds({
        accountId: account._id,
      })) as string[];
      knownIds = new Set(ids);
      knownIdsCache.set(username, knownIds);
    }
    if (knownIds.has(post.id)) {
      stats.skippedExisting++;
      continue;
    }

    // 4. Download + upload the image to Convex storage (best-effort).
    let localImageStorageId: string | undefined;
    let localImageContentType: string | undefined;
    let localImageSize: number | undefined;
    const imageUrl: string | undefined = post.imageUrl;
    if (imageUrl) {
      try {
        const bytes = await downloadImageBytes(imageUrl);
        const { contentType } = contentTypeForUrl(imageUrl);
        const uploaded = await uploadToConvexStorage(bytes, contentType);
        localImageStorageId = uploaded.storageId as any;
        localImageContentType = contentType;
        localImageSize = uploaded.size;
      } catch (err: any) {
        job.log(`Failed to fetch/upload image for post ${post.id}: ${err.message}`);
      }
    }

    // 5. Upsert the post. upsertInstagramPost dedups by sourceEventKey
    //    (source + postId), so re-importing an existing post is a no-op patch;
    //    we count those as skippedExisting for parity with the old import.
    const timestamp =
      post.timestamp instanceof Date
        ? post.timestamp
        : new Date(post.timestamp);
    const startDatetime = Number.isNaN(timestamp.getTime())
      ? Date.now()
      : timestamp.getTime();
    const permalink = post.permalink || `https://instagram.com/p/${post.id}/`;

    try {
      const ownerUsername = post.ownerUsername || username;
      await workerApi.upsertInstagramPost({
        runId,
        accountId: account._id,
        postId: post.id,
        title: (post.caption || '').slice(0, 200) || 'Instagram Post',
        descriptionHtml: post.caption || '',
        startDatetime,
        timezone: account.defaultTimezone || 'America/Vancouver',
        url: permalink,
        imageUrl: post.imageUrl,
        caption: post.caption,
        localImageStorageId,
        localImageContentType,
        localImageSize,
        raw: {
          ...post,
          instagram: {
            timestamp: new Date(startDatetime).toISOString(),
            postId: post.id,
            caption: post.caption,
            imageUrl: post.imageUrl,
            permalink: post.permalink,
            isVideo: post.isVideo || false,
            scrapedAccount: username,
            ownerUsername,
            isCollaborative: ownerUsername !== username,
          },
          _meta: {
            importedAt: new Date().toISOString(),
            apifyRunId,
            importer: 'apify_direct',
          },
        },
      });
      stats.created++;
      knownIds.add(post.id);
    } catch (err: any) {
      // Existing posts were already filtered out above, so a throw here is a
      // genuine write failure for this post; log and continue.
      job.log(`Failed to import post ${post.id}: ${err.message}`);
    }

    if ((i + 1) % 10 === 0) {
      job.log(`Processed ${i + 1}/${posts.length} posts`);
    }
  }

  // 6. Finish the run.
  await workerApi.finishRun({
    runId,
    status: stats.created > 0 ? 'success' : 'partial',
    eventsFound: stats.created,
  });

  const message = `Apify import (run ${apifyRunId}): attempted ${stats.attempted}, created ${stats.created}, skippedExisting ${stats.skippedExisting}, missingAccounts ${stats.missingAccounts}`;
  job.log(message);
  await appendRunLog(runId, 30, message, 'apifyImport');
}
