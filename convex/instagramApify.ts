"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
// Reuse the worker's EnhancedApifyClient (it relies on apify-client + Node
// builtins like child_process/fs, which is why this file is "use node").
import { createEnhancedApifyClient } from "../worker/src/modules/instagram/enhanced-apify-client.js";

// Ports GET /api/instagram-apify/run-snapshot/:runId. Reads an existing Apify
// run's dataset and returns its posts (no DB writes). `runId` is the APIFY run
// id. The enqueue mutation + account/config queries live in the default-runtime
// companion convex/instagramApifyQueue.ts (mutations can't be in "use node").
export const snapshot = action({
  args: {
    runId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    success: v.boolean(),
    runId: v.string(),
    posts: v.array(v.any()),
    input: v.any(),
  }),
  handler: async (ctx, args) => {
    const config = await ctx.runQuery(internal.instagramApifyQueue.getApifyConfig, {});
    if (!config?.apifyApiToken) {
      throw new Error("Apify API token not configured");
    }

    const client = await createEnhancedApifyClient(
      config.apifyApiToken,
      config.apifyActorId || undefined,
    );

    const result = await client.fetchRunSnapshot(args.runId, args.limit ?? 50);

    return {
      success: true,
      runId: args.runId,
      posts: result.posts ?? [],
      input: result.input ?? {},
    };
  },
});
