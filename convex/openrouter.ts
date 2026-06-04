import { action } from "./_generated/server";
import { v } from "convex/values";

// Convex action (short, bounded external fetch). Ports the old
// /system-settings/openrouter-models route: list vision-capable models from
// openrouter.ai (the public models endpoint needs no auth).

const FALLBACK = [
  { id: "google/gemini-2.0-flash-exp", name: "Google: Gemini 2.0 Flash (Experimental)" },
  { id: "anthropic/claude-sonnet-4", name: "Anthropic: Claude Sonnet 4" },
  { id: "openai/gpt-4o", name: "OpenAI: GPT-4o" },
  { id: "openai/gpt-4o-mini", name: "OpenAI: GPT-4o Mini" },
];

export const listVisionModels = action({
  args: {},
  returns: v.object({ models: v.array(v.any()) }),
  handler: async () => {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`OpenRouter API returned ${res.status}`);
      const data = (await res.json()) as { data: any[] };
      const vision = data.data
        .filter((m) => (m.architecture?.input_modalities || []).includes("image"))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        .map((m) => ({
          id: m.id,
          name: m.name,
          description: m.description,
          contextLength: m.context_length,
          pricing: m.pricing,
        }));
      return { models: vision };
    } catch (err) {
      console.error("[openrouter] failed to fetch models:", (err as Error).message);
      return { models: FALLBACK };
    }
  },
});
