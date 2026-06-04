/**
 * Best-effort backfill of Instagram poster images into Convex storage.
 *
 * The original local image files were lost (the instagram_images volume was not
 * persisted), and the migration never populated localImageStorageId. This script
 * re-downloads each post's stored CDN imageUrl and uploads it to Convex storage,
 * then patches localImageStorageId/ContentType/Size onto the row.
 *
 * Instagram CDN URLs expire, so expect partial success — recent posts are more
 * likely to succeed. Going forward, the worker uploads images at scrape time, so
 * this is a one-off recovery for pre-existing rows.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   npx tsx scripts/backfill-instagram-images.ts [limit]
 */
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const url =
  process.env.CONVEX_URL || process.env.CONVEX_SELF_HOSTED_URL || "http://127.0.0.1:3210";
const convex = new ConvexHttpClient(url);

const countPage = makeFunctionReference<"query">("migration:countPage");
const generateUploadUrl = makeFunctionReference<"mutation">("storage:generateUploadUrl");
const patchBatch = makeFunctionReference<"mutation">("migration:patchBatch");

const LIMIT = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;

function imageUrlOf(row: any): string | undefined {
  return row.imageUrl || row?.raw?.instagram?.imageUrl || undefined;
}
function contentTypeFor(u: string): string {
  const ext = (u.split("?")[0].split(".").pop() || "jpg").toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

async function main() {
  // Page through all eventsRaw and collect candidates.
  const candidates: any[] = [];
  let cursor: string | null = null;
  do {
    const res: any = await convex.query(countPage, {
      table: "eventsRaw",
      paginationOpts: { numItems: 500, cursor },
    });
    for (const row of res.page) {
      if (row.localImagePath && !row.localImageStorageId && imageUrlOf(row)) {
        candidates.push(row);
      }
    }
    cursor = res.isDone ? null : res.continueCursor;
  } while (cursor);

  const targets = candidates.slice(0, LIMIT);
  console.log(`Found ${candidates.length} rows needing image backfill; processing ${targets.length}`);

  let ok = 0;
  let failed = 0;
  const patches: Array<{ id: string; patch: any }> = [];

  for (const row of targets) {
    const cdn = imageUrlOf(row)!;
    try {
      const resp = await fetch(cdn);
      if (!resp.ok) {
        failed++;
        continue;
      }
      const bytes = Buffer.from(await resp.arrayBuffer());
      const contentType = resp.headers.get("content-type") || contentTypeFor(cdn);
      const uploadUrl = (await convex.mutation(generateUploadUrl, {})) as string;
      const up = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body: bytes,
      });
      if (!up.ok) {
        failed++;
        continue;
      }
      const { storageId } = (await up.json()) as { storageId: string };
      patches.push({
        id: row._id,
        patch: { localImageStorageId: storageId, localImageContentType: contentType, localImageSize: bytes.length },
      });
      ok++;
      // Flush in batches of 50.
      if (patches.length >= 50) {
        await convex.mutation(patchBatch, { table: "eventsRaw", patches: patches.splice(0) });
      }
      if ((ok + failed) % 25 === 0) console.log(`  ${ok} uploaded, ${failed} failed (of ${targets.length})`);
    } catch {
      failed++;
    }
  }
  if (patches.length) await convex.mutation(patchBatch, { table: "eventsRaw", patches });

  console.log(`\nDone. Uploaded ${ok}, failed ${failed} (expired/unreachable CDN URLs).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
