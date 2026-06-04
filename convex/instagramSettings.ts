import { v } from "convex/values";
import { GenericQueryCtx } from "convex/server";
import { mutation, query } from "./_generated/server";
import { DataModel, Doc } from "./_generated/dataModel";
import { aiProvider, instagramScraperType } from "./schema";

type Ctx = GenericQueryCtx<DataModel>;

// Ports apps/api/src/routes/instagram-settings.ts.
// instagramSettings is a singleton (the original keyed it by a fixed UUID).
// In Convex we treat "the single row" as the singleton; create on first write.
//
// NOTE: the original GET also merged in global AI keys/provider from
// systemSettings and substituted a default Gemini prompt read from
// apps/api/src/assets/gemini-prompt.md. File I/O isn't available here, so the
// default-prompt fallback is left to the caller / actions phase. We still merge
// the systemSettings global AI provider + key presence to preserve the
// has*Key / aiProvider semantics.

async function getSingleton(ctx: Ctx): Promise<Doc<"instagramSettings"> | null> {
  return await ctx.db.query("instagramSettings").first();
}

async function getGlobalSettings(ctx: Ctx): Promise<Doc<"systemSettings"> | null> {
  return await ctx.db.query("systemSettings").first();
}

function shapeSettings(
  settings: Doc<"instagramSettings"> | null,
  global: Doc<"systemSettings"> | null,
) {
  if (!settings) return null;
  return {
    id: settings._id,
    apifyActorId: settings.apifyActorId,
    apifyResultsLimit: settings.apifyResultsLimit,
    fetchDelayMinutes: settings.fetchDelayMinutes,
    autoExtractNewPosts: settings.autoExtractNewPosts,
    autoClassifyWithAi: settings.autoClassifyWithAi,
    aiProvider: global?.aiProvider ?? settings.aiProvider ?? "gemini",
    // geminiPrompt default-from-disk fallback handled outside Convex.
    geminiPrompt: settings.geminiPrompt ?? null,
    claudePrompt: settings.claudePrompt ?? null,
    // Mask secrets — only expose presence, mirroring the original `has*` fields.
    hasApifyToken: !!settings.apifyApiToken,
    hasGeminiKey: !!(global?.geminiApiKey || settings.geminiApiKey),
    hasClaudeKey: !!(global?.claudeApiKey || settings.claudeApiKey),
    defaultScraperType: settings.defaultScraperType,
    allowPerAccountOverride: settings.allowPerAccountOverride,
    createdAt: settings.createdAt,
    updatedAt: settings.updatedAt,
  };
}

// GET /api/instagram-settings — returns the singleton (secrets masked) or null.
export const get = query({
  args: {},
  returns: v.union(v.object({ settings: v.any() }), v.null()),
  handler: async (ctx) => {
    const settings = await getSingleton(ctx);
    if (!settings) return null;
    const global = await getGlobalSettings(ctx);
    return { settings: shapeSettings(settings, global) };
  },
});

// PATCH /api/instagram-settings — update the singleton (create if missing).
// Global AI provider/keys are mirrored into systemSettings as the original did.
export const update = mutation({
  args: {
    apifyApiToken: v.optional(v.string()),
    geminiApiKey: v.optional(v.string()),
    claudeApiKey: v.optional(v.string()),
    aiProvider: v.optional(aiProvider),
    geminiPrompt: v.optional(v.string()),
    claudePrompt: v.optional(v.string()),
    apifyActorId: v.optional(v.string()),
    apifyResultsLimit: v.optional(v.number()),
    fetchDelayMinutes: v.optional(v.number()),
    autoExtractNewPosts: v.optional(v.boolean()),
    autoClassifyWithAi: v.optional(v.boolean()),
    defaultScraperType: v.optional(instagramScraperType),
    allowPerAccountOverride: v.optional(v.boolean()),
  },
  returns: v.object({ settings: v.any() }),
  handler: async (ctx, args) => {
    const now = Date.now();

    const patch: Record<string, unknown> = { updatedAt: now };
    if (args.apifyApiToken !== undefined) patch.apifyApiToken = args.apifyApiToken;
    if (args.geminiApiKey !== undefined) patch.geminiApiKey = args.geminiApiKey;
    if (args.claudeApiKey !== undefined) patch.claudeApiKey = args.claudeApiKey;
    if (args.aiProvider !== undefined) patch.aiProvider = args.aiProvider;
    if (args.geminiPrompt !== undefined) patch.geminiPrompt = args.geminiPrompt;
    if (args.claudePrompt !== undefined) patch.claudePrompt = args.claudePrompt;
    if (args.apifyActorId !== undefined) patch.apifyActorId = args.apifyActorId;
    if (args.apifyResultsLimit !== undefined) patch.apifyResultsLimit = args.apifyResultsLimit;
    if (args.fetchDelayMinutes !== undefined) patch.fetchDelayMinutes = args.fetchDelayMinutes;
    if (args.autoExtractNewPosts !== undefined)
      patch.autoExtractNewPosts = args.autoExtractNewPosts;
    if (args.autoClassifyWithAi !== undefined) patch.autoClassifyWithAi = args.autoClassifyWithAi;
    if (args.defaultScraperType !== undefined) patch.defaultScraperType = args.defaultScraperType;
    if (args.allowPerAccountOverride !== undefined)
      patch.allowPerAccountOverride = args.allowPerAccountOverride;

    // Mirror global AI updates into systemSettings (create if missing).
    const globalUpdates: Record<string, unknown> = {};
    if (args.aiProvider !== undefined) globalUpdates.aiProvider = args.aiProvider;
    if (args.geminiApiKey !== undefined) globalUpdates.geminiApiKey = args.geminiApiKey;
    if (args.claudeApiKey !== undefined) globalUpdates.claudeApiKey = args.claudeApiKey;
    if (Object.keys(globalUpdates).length > 0) {
      const global = await getGlobalSettings(ctx);
      if (global) {
        await ctx.db.patch(global._id, { ...globalUpdates, updatedAt: now });
      } else {
        await ctx.db.insert("systemSettings", {
          posterImportEnabled: false,
          aiProvider: (globalUpdates.aiProvider as Doc<"systemSettings">["aiProvider"]) ?? undefined,
          geminiApiKey: (globalUpdates.geminiApiKey as string) ?? undefined,
          claudeApiKey: (globalUpdates.claudeApiKey as string) ?? undefined,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    let settings = await getSingleton(ctx);
    if (settings) {
      await ctx.db.patch(settings._id, patch);
      settings = await ctx.db.get(settings._id);
    } else {
      const id = await ctx.db.insert("instagramSettings", {
        apifyApiToken: args.apifyApiToken,
        geminiApiKey: args.geminiApiKey,
        claudeApiKey: args.claudeApiKey,
        aiProvider: args.aiProvider,
        geminiPrompt: args.geminiPrompt,
        claudePrompt: args.claudePrompt,
        apifyActorId: args.apifyActorId,
        apifyResultsLimit: args.apifyResultsLimit,
        fetchDelayMinutes: args.fetchDelayMinutes,
        autoExtractNewPosts: args.autoExtractNewPosts,
        autoClassifyWithAi: args.autoClassifyWithAi,
        defaultScraperType: args.defaultScraperType,
        allowPerAccountOverride: args.allowPerAccountOverride,
        createdAt: now,
        updatedAt: now,
      });
      settings = await ctx.db.get(id);
    }

    const global = await getGlobalSettings(ctx);
    return { settings: shapeSettings(settings, global) };
  },
});

// DELETE /api/instagram-settings/apify-token — clear the Apify token.
export const clearApifyToken = mutation({
  args: {},
  returns: v.object({ message: v.string() }),
  handler: async (ctx) => {
    const settings = await getSingleton(ctx);
    if (settings) {
      await ctx.db.patch(settings._id, { apifyApiToken: undefined, updatedAt: Date.now() });
    }
    return { message: "Apify token removed successfully" };
  },
});

// DELETE /api/instagram-settings/gemini-key — clear Gemini key (ig + global).
export const clearGeminiKey = mutation({
  args: {},
  returns: v.object({ message: v.string() }),
  handler: async (ctx) => {
    const now = Date.now();
    const global = await getGlobalSettings(ctx);
    if (global) await ctx.db.patch(global._id, { geminiApiKey: undefined, updatedAt: now });
    const settings = await getSingleton(ctx);
    if (settings) await ctx.db.patch(settings._id, { geminiApiKey: undefined, updatedAt: now });
    return { message: "Gemini API key removed successfully" };
  },
});

// DELETE /api/instagram-settings/claude-key — clear Claude key (ig + global).
export const clearClaudeKey = mutation({
  args: {},
  returns: v.object({ message: v.string() }),
  handler: async (ctx) => {
    const now = Date.now();
    const global = await getGlobalSettings(ctx);
    if (global) await ctx.db.patch(global._id, { claudeApiKey: undefined, updatedAt: now });
    const settings = await getSingleton(ctx);
    if (settings) await ctx.db.patch(settings._id, { claudeApiKey: undefined, updatedAt: now });
    return { message: "Claude API key removed successfully" };
  },
});

// GET /api/instagram-settings/keys — UNMASKED keys for worker/internal use.
// Kept for the worker; resolves global keys first, then ig-level fallbacks.
export const getKeys = query({
  args: {},
  returns: v.object({
    apifyApiToken: v.union(v.string(), v.null()),
    geminiApiKey: v.union(v.string(), v.null()),
    claudeApiKey: v.union(v.string(), v.null()),
    geminiPrompt: v.union(v.string(), v.null()),
    claudePrompt: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const settings = await getSingleton(ctx);
    const global = await getGlobalSettings(ctx);
    return {
      apifyApiToken: settings?.apifyApiToken ?? null,
      geminiApiKey: global?.geminiApiKey ?? settings?.geminiApiKey ?? null,
      claudeApiKey: global?.claudeApiKey ?? settings?.claudeApiKey ?? null,
      geminiPrompt: settings?.geminiPrompt ?? null,
      claudePrompt: settings?.claudePrompt ?? null,
    };
  },
});
