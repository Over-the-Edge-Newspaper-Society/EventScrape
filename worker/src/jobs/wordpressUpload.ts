import { makeFunctionReference } from 'convex/server';
import { convex } from '../lib/convex.js';
import { JobShim } from '../types.js';

// WordPress export job. Self-hosted Convex won't run scheduled "use node" actions
// in the background, so the schedule enqueues this job and the worker invokes the
// action via DIRECT HTTP (which works), in chunks to stay well under action time
// limits. payload: { settingsId, eventIds: string[], status }.
const uploadRef = makeFunctionReference<'action'>('wordpressUpload:uploadEvents');
const CHUNK = 25;

export async function handleWordpressJob(job: JobShim<any>): Promise<void> {
  const { settingsId, eventIds, status } = job.data as {
    settingsId: string;
    eventIds: string[];
    status?: 'publish' | 'draft' | 'pending';
  };
  if (!settingsId || !Array.isArray(eventIds) || eventIds.length === 0) {
    job.log('WordPress export: nothing to publish');
    return;
  }

  job.log(`WordPress export: ${eventIds.length} events as ${status ?? 'draft'} (chunks of ${CHUNK})`);
  let uploaded = 0;
  let failed = 0;
  for (let i = 0; i < eventIds.length; i += CHUNK) {
    const batch = eventIds.slice(i, i + CHUNK);
    try {
      const res: any = await convex.action(uploadRef, { settingsId, eventIds: batch, status });
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
}
