import * as geminiExtractor from './gemini-extractor.js';
import * as claudeExtractor from './claude-extractor.js';
import * as openrouterExtractor from './openrouter-extractor.js';

export type AiProvider = 'gemini' | 'claude' | 'openrouter';
export interface AiSettings {
  aiProvider?: string | null;
  geminiApiKey?: string | null;
  claudeApiKey?: string | null;
  openrouterApiKey?: string | null;
  openrouterModel?: string | null;
}

export type ExtractorModule = {
  extractEventFromImageFile: (
    imagePath: string,
    apiKey: string,
    options?: { caption?: string | null; postTimestamp?: Date | null; model?: string },
  ) => Promise<any>;
  classifyEventFromImageFile: (
    imagePath: string,
    apiKey: string,
    options?: { caption?: string | null; postTimestamp?: Date | null; model?: string },
  ) => Promise<any>;
};

// Used by both ingestion and explicit review; never fall back to another provider.
export function resolveProvider(settings: AiSettings, env: NodeJS.ProcessEnv = process.env): {
  provider: AiProvider;
  apiKey: string;
  model?: string;
  module: ExtractorModule;
} {
  const provider = settings.aiProvider || 'gemini';

  if (provider === 'claude') {
    const apiKey = settings.claudeApiKey || env.CLAUDE_API_KEY || '';
    if (!apiKey) throw new Error('Claude API key not configured');
    return { provider, apiKey, module: claudeExtractor as unknown as ExtractorModule };
  }

  if (provider === 'openrouter') {
    const apiKey = settings.openrouterApiKey || env.OPENROUTER_API_KEY || '';
    const model = settings.openrouterModel || 'google/gemini-2.0-flash-exp';
    if (!apiKey) throw new Error('OpenRouter API key not configured');
    return { provider, apiKey, model, module: openrouterExtractor as unknown as ExtractorModule };
  }

  if (provider !== 'gemini') throw new Error(`Unsupported AI provider: ${provider}`);

  // gemini (default)
  const apiKey = settings.geminiApiKey || env.GEMINI_API_KEY || '';
  if (!apiKey) throw new Error('Gemini API key not configured');
  return { provider: 'gemini', apiKey, module: geminiExtractor as unknown as ExtractorModule };
}

