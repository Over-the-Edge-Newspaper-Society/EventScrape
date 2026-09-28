/** One precedence rule for UI, ingestion and explicit review jobs. */
export function resolveInstagramAiSettings(
  instagram: { aiProvider?: string; geminiApiKey?: string; claudeApiKey?: string } | null,
  global: { aiProvider?: string; geminiApiKey?: string; claudeApiKey?: string; openrouterApiKey?: string; openrouterModel?: string } | null,
) {
  return {
    aiProvider: global?.aiProvider ?? instagram?.aiProvider ?? 'gemini',
    geminiApiKey: global?.geminiApiKey ?? instagram?.geminiApiKey ?? null,
    claudeApiKey: global?.claudeApiKey ?? instagram?.claudeApiKey ?? null,
    openrouterApiKey: global?.openrouterApiKey ?? null,
    openrouterModel: global?.openrouterModel ?? null,
  };
}
