import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API URL for fetching settings
const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

// Load the prompt (reuse the Gemini prompt as it's model-agnostic)
const PROMPT_PATH = path.join(__dirname, 'gemini-prompt.md');
let EXTRACTION_PROMPT: string;

const CLASSIFY_PROMPT_PATH = path.join(__dirname, 'gemini-classify-prompt.md');
let CLASSIFY_PROMPT: string;

// Default model if not specified
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.0-flash-exp';

async function loadPrompt() {
  if (!EXTRACTION_PROMPT) {
    // Try to fetch prompt from database first
    try {
      const response = await fetch(`${API_BASE_URL}/api/instagram-settings/keys`);
      if (response.ok) {
        const data = await response.json();
        if (data.geminiPrompt && data.geminiPrompt.trim() !== '') {
          EXTRACTION_PROMPT = data.geminiPrompt;
          console.log('[OpenRouter] Using custom prompt from database');
          return EXTRACTION_PROMPT;
        }
      }
    } catch (error) {
      console.warn('[OpenRouter] Failed to fetch prompt from API, using default from file:', error);
    }

    // Fallback to file-based prompt
    EXTRACTION_PROMPT = await fs.readFile(PROMPT_PATH, 'utf-8');
    console.log('[OpenRouter] Using default prompt from file');
  }
  return EXTRACTION_PROMPT;
}

async function loadClassificationPrompt() {
  if (!CLASSIFY_PROMPT) {
    CLASSIFY_PROMPT = await fs.readFile(CLASSIFY_PROMPT_PATH, 'utf-8');
    console.log('[OpenRouter] Using classification prompt from file');
  }
  return CLASSIFY_PROMPT;
}

export interface OpenRouterEvent {
  title: string;
  description?: string | null;
  startDate: string;
  startTime?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  timezone?: string | null;
  occurrenceType?: 'single' | 'multi_day' | 'recurring' | 'all_day' | 'virtual';
  recurrenceType?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
  seriesDates?: Array<{ start: string; end: string }> | null;
  venue?: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    region?: string | null;
    country?: string | null;
  } | null;
  organizer?: string | null;
  category?: string | null;
  price?: string | null;
  tags?: string[] | null;
  registrationUrl?: string | null;
  contactInfo?: {
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  } | null;
  additionalInfo?: string | null;
}

export interface OpenRouterClassificationResult {
  isEventPoster: boolean;
  confidence?: number | null;
  reasoning?: string | null;
  cues?: string[] | null;
  shouldExtractEvents?: boolean;
}

export interface OpenRouterExtractionResult {
  events: OpenRouterEvent[];
  classification?: OpenRouterClassificationResult;
  extractionConfidence?: {
    overall?: number;
    notes?: string;
  };
}

export class OpenRouterExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenRouterExtractionError';
  }
}

export class OpenRouterApiKeyMissing extends OpenRouterExtractionError {
  constructor(message = 'OpenRouter API key is not configured') {
    super(message);
    this.name = 'OpenRouterApiKeyMissing';
  }
}

/**
 * Clean response text by removing markdown code fences
 */
function cleanResponseText(rawText: string): string {
  if (!rawText) return '';
  // Remove markdown code fences like ```json or ```
  return rawText
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

/**
 * Parse JSON from cleaned response text
 */
function parseJsonFromText<T>(rawText: string): T {
  const cleaned = cleanResponseText(rawText);

  if (!cleaned) {
    throw new OpenRouterExtractionError('OpenRouter response did not include any JSON content');
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    // Try to extract JSON object using regex
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]) as T;
      } catch (e) {
        throw new OpenRouterExtractionError('Failed to parse OpenRouter response as JSON');
      }
    }
    throw new OpenRouterExtractionError(`Failed to parse OpenRouter response as JSON: ${error}`);
  }
}

/**
 * Extract event data from an image using OpenRouter API
 */
export async function extractEventFromImage(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
    model?: string;
  }
): Promise<OpenRouterExtractionResult> {
  if (!apiKey) {
    throw new OpenRouterApiKeyMissing();
  }

  try {
    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://eventscrape.local',
        'X-Title': 'EventScrape',
      },
    });

    const prompt = await loadPrompt();
    const modelId = options?.model || DEFAULT_OPENROUTER_MODEL;

    // Build the content array for the request
    const base64Data = imageBuffer.toString('base64');
    const imageUrl = `data:${mimeType};base64,${base64Data}`;

    const textParts: string[] = [prompt];

    // Add context sections if provided
    if (options?.postTimestamp) {
      const timestamp = options.postTimestamp.toISOString().split('.')[0];
      textParts.push(
        `\n\nInstagram post publication details:\n` +
        `- Published on ${timestamp}.\n` +
        `- Treat events as upcoming relative to this date unless the poster clearly indicates an earlier year.`
      );
    }

    if (options?.caption) {
      textParts.push(`\n\nInstagram caption (additional context):\n${options.caption}`);
    }

    // Call OpenRouter API (OpenAI-compatible)
    const completion = await client.chat.completions.create({
      model: modelId,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
            {
              type: 'text',
              text: textParts.join(''),
            },
          ],
        },
      ],
    });

    // Extract text from response
    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new OpenRouterExtractionError('OpenRouter response did not include text output');
    }

    return parseJsonFromText<OpenRouterExtractionResult>(responseText);
  } catch (error: any) {
    if (error instanceof OpenRouterExtractionError) {
      throw error;
    }
    throw new OpenRouterExtractionError(`OpenRouter API error: ${error.message || error}`);
  }
}

/**
 * Classify whether an image represents an event poster using OpenRouter API
 */
export async function classifyEventFromImage(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
    model?: string;
  }
): Promise<OpenRouterClassificationResult> {
  if (!apiKey) {
    throw new OpenRouterApiKeyMissing();
  }

  try {
    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://eventscrape.local',
        'X-Title': 'EventScrape',
      },
    });

    const prompt = await loadClassificationPrompt();
    const modelId = options?.model || DEFAULT_OPENROUTER_MODEL;

    const base64Data = imageBuffer.toString('base64');
    const imageUrl = `data:${mimeType};base64,${base64Data}`;

    const textParts: string[] = [prompt];

    if (options?.postTimestamp) {
      const timestamp = options.postTimestamp.toISOString().split('.')[0];
      textParts.push(
        `\n\nInstagram post publication details:\n` +
        `- Published on ${timestamp}.\n` +
        `- Treat potential events as upcoming relative to this date unless the poster clearly indicates an earlier year.`
      );
    }

    if (options?.caption) {
      textParts.push(`\n\nInstagram caption (additional context):\n${options.caption}`);
    }

    const completion = await client.chat.completions.create({
      model: modelId,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: imageUrl },
            },
            {
              type: 'text',
              text: textParts.join(''),
            },
          ],
        },
      ],
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new OpenRouterExtractionError('OpenRouter response did not include text output');
    }

    const classification = parseJsonFromText<OpenRouterClassificationResult>(responseText);

    if (typeof classification.isEventPoster !== 'boolean') {
      throw new OpenRouterExtractionError('OpenRouter classification response missing isEventPoster field');
    }

    if (typeof classification.confidence === 'number') {
      const clamped = Math.max(0, Math.min(1, classification.confidence));
      classification.confidence = Number.isFinite(clamped) ? clamped : null;
    }

    if (!Array.isArray(classification.cues)) {
      classification.cues = classification.cues == null ? [] : [String(classification.cues)];
    }

    return classification;
  } catch (error: any) {
    if (error instanceof OpenRouterExtractionError) {
      throw error;
    }
    throw new OpenRouterExtractionError(`OpenRouter API error: ${error.message || error}`);
  }
}

/**
 * Extract event data from a file path
 */
export async function extractEventFromImageFile(
  imagePath: string,
  apiKey: string,
  options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
    model?: string;
  }
): Promise<OpenRouterExtractionResult> {
  const imageBuffer = await fs.readFile(imagePath);

  // Determine MIME type from extension
  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const mimeType = mimeTypeMap[ext] || 'image/jpeg';

  return extractEventFromImage(imageBuffer, mimeType, apiKey, options);
}

/**
 * Classify whether a file path corresponds to an event poster
 */
export async function classifyEventFromImageFile(
  imagePath: string,
  apiKey: string,
  options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
    model?: string;
  }
): Promise<OpenRouterClassificationResult> {
  const imageBuffer = await fs.readFile(imagePath);

  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  const mimeType = mimeTypeMap[ext] || 'image/jpeg';

  return classifyEventFromImage(imageBuffer, mimeType, apiKey, options);
}
