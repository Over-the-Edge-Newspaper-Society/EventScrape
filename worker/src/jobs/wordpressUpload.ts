import { makeFunctionReference } from 'convex/server';
import { convex } from '../lib/convex.js';
import { JobShim } from '../types.js';

// WordPress export job. Self-hosted Convex won't run scheduled "use node" actions
// in the background, so the schedule enqueues this job and the worker invokes the
// action via DIRECT HTTP (which works), in chunks to stay well under action time
// limits. payload: { settingsId, eventIds: string[], status }.
const uploadRef = makeFunctionReference<'action'>('wordpressUpload:uploadEvents');
const markCompleteRef = makeFunctionReference<'mutation'>('exports:markComplete');
const markErrorRef = makeFunctionReference<'mutation'>('exports:markError');
const CHUNK = 25;

export async function handleWordpressJob(job: JobShim<any>): Promise<void> {
  const { settingsId, eventIds, status, exportId, updateIfExists } = job.data as {
    settingsId: string;
    eventIds: string[];
    status?: 'publish' | 'draft' | 'pending';
    exportId?: string;
    updateIfExists?: boolean;
  };
  if (!settingsId || !Array.isArray(eventIds) || eventIds.length === 0) {
    job.log('WordPress export: nothing to publish');
    if (exportId) await convex.mutation(markCompleteRef, { id: exportId, itemCount: 0 }).catch(() => {});
    return;
  }

  job.log(`WordPress export: ${eventIds.length} events as ${status ?? 'draft'} (chunks of ${CHUNK})`);
  let uploaded = 0;
  let failed = 0;
  for (let i = 0; i < eventIds.length; i += CHUNK) {
    const batch = eventIds.slice(i, i + CHUNK);
    try {
      const res: any = await convex.action(uploadRef, { settingsId, eventIds: batch, status, updateIfExists });
      // res.message: "Uploaded N events, M failed"
      const m = /Uploaded (\d+) events?, (\d+) failed/.exec(res?.message || '');
      if (m) {
        uploaded += Number(m[1]);
        failed += Number(m[2]);
      }
      job.log(`  batch ${Math.floor(i / CHUNK) + 1}: ${res?.message ?? 'done'}`);
    } catch (err) {
      failed += batch.length;
      job.log(`  batch ${Math.floor(i / CHUNK) + 1} failed: ${(err as Error).message}`);
    }
  }
  job.log(`WordPress export complete: ${uploaded} uploaded, ${failed} failed`);

  // Update the Export History record (created by the schedule trigger).
  if (exportId) {
    try {
      if (uploaded === 0 && failed > 0) {
        await convex.mutation(markErrorRef, { id: exportId, errorMessage: `All ${failed} uploads failed` });
      } else {
        await convex.mutation(markCompleteRef, { id: exportId, itemCount: uploaded });
      }
    } catch (err) {
      job.log(`Failed to update export record: ${(err as Error).message}`);
    }
  }
}
