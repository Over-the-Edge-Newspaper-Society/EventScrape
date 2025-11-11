import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// API URL for fetching settings
const API_BASE_URL = process.env.API_URL || 'http://localhost:3001';

// Load the Claude prompt
const CLAUDE_PROMPT_PATH = path.join(__dirname, 'claude-prompt.md');
let CLAUDE_PROMPT: string;

const CLAUDE_CLASSIFY_PROMPT_PATH = path.join(__dirname, 'claude-classify-prompt.md');
let CLAUDE_CLASSIFY_PROMPT: string;

async function loadPrompt() {
  if (!CLAUDE_PROMPT) {
    // Try to fetch prompt from database first
    try {
      const response = await fetch(`${API_BASE_URL}/api/instagram-settings/keys`);
      if (response.ok) {
        const data = await response.json();
        if (data.claudePrompt && data.claudePrompt.trim() !== '') {
          CLAUDE_PROMPT = data.claudePrompt;
          console.log('[Claude] Using custom prompt from database');
          return CLAUDE_PROMPT;
        }
      }
    } catch (error) {
      console.warn('[Claude] Failed to fetch prompt from API, using default from file:', error);
    }

    // Fallback to file-based prompt
    CLAUDE_PROMPT = await fs.readFile(CLAUDE_PROMPT_PATH, 'utf-8');
    console.log('[Claude] Using default prompt from file');
  }
  return CLAUDE_PROMPT;
}

async function loadClassificationPrompt() {
  if (!CLAUDE_CLASSIFY_PROMPT) {
    CLAUDE_CLASSIFY_PROMPT = await fs.readFile(CLAUDE_CLASSIFY_PROMPT_PATH, 'utf-8');
    console.log('[Claude] Using classification prompt from file');
  }
  return CLAUDE_CLASSIFY_PROMPT;
}

const CLAUDE_MODEL_ID = process.env.CLAUDE_MODEL_ID || 'claude-sonnet-4-5';

export interface ClaudeEvent {
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

export interface ClaudeClassificationResult {
  isEventPoster: boolean;
  confidence?: number | null;
  reasoning?: string | null;
  cues?: string[] | null;
  shouldExtractEvents?: boolean;
}

export interface ClaudeExtractionResult {
  events: ClaudeEvent[];
  classification?: ClaudeClassificationResult;
  extractionConfidence?: {
    overall?: number;
    notes?: string;
  };
}

export class ClaudeExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeExtractionError';
  }
}

export class ClaudeClientUnavailable extends ClaudeExtractionError {
  constructor(message = 'Claude SDK is not available') {
    super(message);
    this.name = 'ClaudeClientUnavailable';
  }
}

export class ClaudeApiKeyMissing extends ClaudeExtractionError {
  constructor(message = 'Claude API key is not configured') {
    super(message);
    this.name = 'ClaudeApiKeyMissing';
  }
}

/**
 * Clean Claude response text by removing markdown code fences
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
    throw new ClaudeExtractionError('Claude response did not include any JSON content');
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
        throw new ClaudeExtractionError('Failed to parse Claude response as JSON');
      }
    }
    throw new ClaudeExtractionError(`Failed to parse Claude response as JSON: ${error}`);
  }
}

/**
 * Extract event data from an image using Claude Vision API
 */
export async function extractEventFromImage(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
  }
): Promise<ClaudeExtractionResult> {
  if (!apiKey) {
    throw new ClaudeApiKeyMissing();
  }

  try {
    const client = new Anthropic({ apiKey });

    const prompt = await loadPrompt();

    // Build the content array for the request
    const content: Anthropic.MessageParam['content'] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: imageBuffer.toString('base64'),
        },
      },
      {
        type: 'text',
        text: prompt,
      },
    ];

    // Add context sections if provided
    const contextSections: string[] = [];

    if (options?.postTimestamp) {
      const timestamp = options.postTimestamp.toISOString().split('.')[0];
      contextSections.push(
        `Instagram post publication details:\n` +
        `- Published on ${timestamp}.\n` +
        `- Treat events as upcoming relative to this date unless the poster clearly indicates an earlier year.`
      );
    }

    if (options?.caption) {
      contextSections.push(`Instagram caption (additional context):\n${options.caption}`);
    }

    if (contextSections.length > 0) {
      content.push({
        type: 'text',
        text: `Additional context:\n${contextSections.join('\n\n')}`,
      });
    }

    // Call Claude API
    const message = await client.messages.create({
      model: CLAUDE_MODEL_ID,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });

    // Extract text from response
    const textContent = message.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new ClaudeExtractionError('Claude response did not include text output');
    }

    return parseJsonFromText<ClaudeExtractionResult>(textContent.text);
  } catch (error: any) {
    if (error instanceof ClaudeExtractionError) {
      throw error;
    }
    throw new ClaudeExtractionError(`Claude API error: ${error.message || error}`);
  }
}

/**
 * Classify whether an image represents an event poster using Claude Vision API
 */
export async function classifyEventFromImage(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
  }
): Promise<ClaudeClassificationResult> {
  if (!apiKey) {
    throw new ClaudeApiKeyMissing();
  }

  try {
    const client = new Anthropic({ apiKey });

    const prompt = await loadClassificationPrompt();

    const content: Anthropic.MessageParam['content'] = [
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: imageBuffer.toString('base64'),
        },
      },
      {
        type: 'text',
        text: prompt,
      },
    ];

    const contextSections: string[] = [];

    if (options?.postTimestamp) {
      const timestamp = options.postTimestamp.toISOString().split('.')[0];
      contextSections.push(
        `Instagram post publication details:\n` +
        `- Published on ${timestamp}.\n` +
        `- Treat potential events as upcoming relative to this date unless the poster clearly indicates an earlier year.`
      );
    }

    if (options?.caption) {
      contextSections.push(`Instagram caption (additional context):\n${options.caption}`);
    }

    if (contextSections.length > 0) {
      content.push({
        type: 'text',
        text: `Additional context:\n${contextSections.join('\n\n')}`,
      });
    }

    const message = await client.messages.create({
      model: CLAUDE_MODEL_ID,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content,
        },
      ],
    });

    const textContent = message.content.find((block) => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new ClaudeExtractionError('Claude response did not include text output');
    }

    const classification = parseJsonFromText<ClaudeClassificationResult>(textContent.text);

    if (typeof classification.isEventPoster !== 'boolean') {
      throw new ClaudeExtractionError('Claude classification response missing isEventPoster field');
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
    if (error instanceof ClaudeExtractionError) {
      throw error;
    }
    throw new ClaudeExtractionError(`Claude API error: ${error.message || error}`);
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
  }
): Promise<ClaudeExtractionResult> {
  const imageBuffer = await fs.readFile(imagePath);

  // Determine MIME type from extension
  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/jpeg', // Treat webp as jpeg for Claude API compatibility
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
  }
): Promise<ClaudeClassificationResult> {
  const imageBuffer = await fs.readFile(imagePath);

  const ext = path.extname(imagePath).toLowerCase();
  const mimeTypeMap: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/jpeg', // Treat webp as jpeg for Claude API compatibility
    '.gif': 'image/gif',
  };
  const mimeType = mimeTypeMap[ext] || 'image/jpeg';

  return classifyEventFromImage(imageBuffer, mimeType, apiKey, options);
}
