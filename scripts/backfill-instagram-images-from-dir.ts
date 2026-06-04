/**
 * Backfill Instagram poster images into Convex storage from a local directory
 * (e.g. extracted from a backup bundle's instagram_images/ folder).
 *
 * Matches eventsRaw rows by localImagePath -> <dir>/<localImagePath>, uploads the
 * file to Convex storage, and patches localImageStorageId/ContentType/Size.
 *
 * Usage:
 *   set -a && source .env.local && set +a
 *   IMAGES_DIR=/tmp/eventscrape-img-restore/instagram_images \
 *     npx tsx scripts/backfill-instagram-images-from-dir.ts [limit]
 */
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { readFile, access } from "fs/promises";
import path from "path";

const url =
  process.env.CONVEX_URL || process.env.CONVEX_SELF_HOSTED_URL || "http://127.0.0.1:3210";
const IMAGES_DIR = process.env.IMAGES_DIR || "/tmp/eventscrape-img-restore/instagram_images";
const LIMIT = process.argv[2] ? parseInt(process.argv[2], 10) : Infinity;

const convex = new ConvexHttpClient(url);
const countPage = makeFunctionReference<"query">("migration:countPage");
const generateUploadUrl = makeFunctionReference<"mutation">("storage:generateUploadUrl");
const patchBatch = makeFunctionReference<"mutation">("migration:patchBatch");

function contentTypeFor(name: string): string {
  const ext = (name.split(".").pop() || "jpg").toLowerCase();
  return ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
}

async function exists(p: string) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const candidates: any[] = [];
  let cursor: string | null = null;
  do {
    const res: any = await convex.query(countPage, {
      table: "eventsRaw",
      paginationOpts: { numItems: 500, cursor },
    });
    for (const row of res.page) {
      if (row.localImagePath && !row.localImageStorageId) candidates.push(row);
    }
    cursor = res.isDone ? null : res.continueCursor;
  } while (cursor);

  const targets = candidates.slice(0, LIMIT);
  console.log(`Images dir: ${IMAGES_DIR}`);
  console.log(`${candidates.length} rows need backfill; processing ${targets.length}`);

  let ok = 0;
  let missing = 0;
  let failed = 0;
  let patches: Array<{ id: string; patch: any }> = [];

  for (const row of targets) {
    const file = path.join(IMAGES_DIR, row.localImagePath);
    if (!(await exists(file))) {
      missing++;
      continue;
    }
    try {
      const bytes = await readFile(file);
      const contentType = contentTypeFor(row.localImagePath);
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
        patch: {
          localImageStorageId: storageId,
          localImageContentType: contentType,
          localImageSize: bytes.length,
        },
      });
      ok++;
      if (patches.length >= 50) {
        await convex.mutation(patchBatch, { table: "eventsRaw", patches });
        patches = [];
      }
      if ((ok + failed + missing) % 100 === 0) {
        console.log(`  ${ok} uploaded, ${missing} missing, ${failed} failed (of ${targets.length})`);
      }
    } catch (e) {
      failed++;
    }
  }
  if (patches.length) await convex.mutation(patchBatch, { table: "eventsRaw", patches });

  console.log(`\nDone. Uploaded ${ok}, missing-file ${missing}, failed ${failed}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
