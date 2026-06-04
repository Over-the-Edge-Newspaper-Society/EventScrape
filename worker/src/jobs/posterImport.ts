import crypto from 'crypto';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { DateTime } from 'luxon';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { makeFunctionReference } from 'convex/server';
import {
  convex,
  appendRunLog,
  downloadFromConvexStorage,
} from '../lib/convex.js';
import aiPosterImport from '../modules/ai_poster_import/index.js';
import type { JobShim, RawEvent } from '../types.js';

// Poster Import worker job. Ports apps/api/src/routes/poster-import.ts:
//   - image-ai path: download the poster image from Convex storage, AI-extract
//     events (Gemini/Claude/OpenRouter, same prompts/SDK calls as the original
//     route), then feed the {events,...} payload through the ai_poster_import
//     module's processUpload to map them into RawEvents.
//   - content path: parse the pasted CSV/JSON content with the same module.
// Extracted events are written to events_raw via posterImport:insertEvent, and
// the run is finished success/error. The poster image already lives in Convex
// storage (the admin uploaded it before enqueue), so no re-store is needed.

type AIProvider = 'gemini' | 'claude' | 'openrouter';

// --- Convex function references (worker talks to Convex by name) ------------
const getPosterJobRef = makeFunctionReference<'query'>('posterImport:getPosterJob');
const insertEventRef = makeFunctionReference<'mutation'>('posterImport:insertEvent');
const markRunRunningRef = makeFunctionReference<'mutation'>('worker:markRunRunning');
const finishRunRef = makeFunctionReference<'mutation'>('worker:finishRun');

// Prompts live next to the worker's instagram module (the original API route
// resolved the Claude prompt from there too); the gemini prompt is shared.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IG_DIR = path.resolve(__dirname, '../modules/instagram');
const GEMINI_PROMPT_PATH = path.join(IG_DIR, 'gemini-prompt.md');
const CLAUDE_PROMPT_PATH = path.join(IG_DIR, 'claude-prompt.md');
let geminiPromptCache: string | null = null;
let claudePromptCache: string | null = null;

async function loadGeminiPrompt(): Promise<string> {
  if (geminiPromptCache !== null) return geminiPromptCache;
  try {
    geminiPromptCache = await fs.readFile(GEMINI_PROMPT_PATH, 'utf-8');
  } catch {
    geminiPromptCache = '';
  }
  return geminiPromptCache;
}
async function loadClaudePrompt(): Promise<string> {
  if (claudePromptCache !== null) return claudePromptCache;
  try {
    claudePromptCache = await fs.readFile(CLAUDE_PROMPT_PATH, 'utf-8');
  } catch {
    claudePromptCache = '';
  }
  return claudePromptCache;
}

// --- JSON-from-text helpers (mirrors the original route) --------------------
function cleanResponseText(rawText: string): string {
  if (!rawText) return '';
  return rawText.replace(/```json/gi, '```').replace(/```/g, '').trim();
}
function parseJsonFromText<T>(rawText: string, providerName: string): T {
  const cleaned = cleanResponseText(rawText);
  if (!cleaned) throw new Error(`${providerName} response did not include any JSON content`);
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]) as T;
    throw new Error(`Failed to parse ${providerName} response as JSON`);
  }
}

function contextSection(pictureDateIso?: string): string | undefined {
  if (!pictureDateIso) return undefined;
  return (
    `Poster photo capture date:\n` +
    `- The photo of this poster was taken on ${pictureDateIso}.\n` +
    `- When the poster only shows month/day (no year), infer the year relative to this date, preferring upcoming dates unless the poster clearly indicates an earlier year.`
  );
}

// --- Provider-specific extraction (same SDK calls as the original route) ----
async function extractWithGemini(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  pictureDateIso?: string,
): Promise<{ events: any[]; extractionConfidence?: any }> {
  const prompt = await loadGeminiPrompt();
  const genAI = new GoogleGenerativeAI(apiKey);
  const modelId = process.env.GEMINI_MODEL_ID || 'gemini-2.0-flash-exp';
  const model = genAI.getGenerativeModel({ model: modelId });

  const parts: any[] = [
    { inlineData: { data: imageBuffer.toString('base64'), mimeType } },
    { text: prompt },
  ];
  const ctxText = contextSection(pictureDateIso);
  if (ctxText) parts.push({ text: `Additional context:\n${ctxText}` });

  const result = await model.generateContent(parts);
  const text = result.response.text();
  if (!text) throw new Error('Gemini response did not include text output');
  const parsed = parseJsonFromText<{ events: any[]; extractionConfidence?: any }>(text, 'Gemini');
  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error('Gemini response JSON is missing events array');
  }
  return parsed;
}

async function extractWithClaude(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  pictureDateIso?: string,
): Promise<{ events: any[]; extractionConfidence?: any }> {
  const prompt = await loadClaudePrompt();
  const client = new Anthropic({ apiKey });
  const modelId = process.env.CLAUDE_MODEL_ID || 'claude-sonnet-4-5';

  const content: Anthropic.MessageParam['content'] = [
    {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
        data: imageBuffer.toString('base64'),
      },
    },
    { type: 'text', text: prompt },
  ];
  const ctxText = contextSection(pictureDateIso);
  if (ctxText) content.push({ type: 'text', text: `Additional context:\n${ctxText}` });

  const message = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });
  const textContent = message.content.find((b) => b.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('Claude response did not include text output');
  }
  const parsed = parseJsonFromText<{ events: any[]; extractionConfidence?: any }>(
    textContent.text,
    'Claude',
  );
  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error('Claude response JSON is missing events array');
  }
  return parsed;
}

async function extractWithOpenRouter(
  imageBuffer: Buffer,
  mimeType: string,
  apiKey: string,
  model: string,
  pictureDateIso?: string,
): Promise<{ events: any[]; extractionConfidence?: any }> {
  const prompt = await loadGeminiPrompt(); // model-agnostic, reused as in original
  const client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey,
    defaultHeaders: { 'HTTP-Referer': 'https://eventscrape.local', 'X-Title': 'EventScrape' },
  });
  const imageUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;
  const textParts = [prompt];
  const ctxText = contextSection(pictureDateIso);
  if (ctxText) textParts.push(`\n\n${ctxText}`);

  const completion = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: textParts.join('') },
        ],
      },
    ],
  });
  const responseText = completion.choices[0]?.message?.content;
  if (!responseText) throw new Error('OpenRouter response did not include text output');
  const parsed = parseJsonFromText<{ events: any[]; extractionConfidence?: any }>(
    responseText,
    'OpenRouter',
  );
  if (!parsed || !Array.isArray(parsed.events)) {
    throw new Error('OpenRouter response JSON is missing events array');
  }
  return parsed;
}

interface PosterSettings {
  aiProvider: AIProvider;
  geminiApiKey: string | null;
  claudeApiKey: string | null;
  openrouterApiKey: string | null;
  openrouterModel: string | null;
}

async function extractPosterEventsFromImage(
  imageBuffer: Buffer,
  mimeType: string,
  settings: PosterSettings,
  pictureDateIso?: string,
): Promise<{ events: any[]; extractionConfidence?: any; aiProvider: AIProvider }> {
  const provider = settings.aiProvider;
  if (provider === 'claude') {
    const apiKey = settings.claudeApiKey || process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error('Claude API key not configured');
    const r = await extractWithClaude(imageBuffer, mimeType, apiKey, pictureDateIso);
    return { ...r, aiProvider: provider };
  }
  if (provider === 'openrouter') {
    const apiKey = settings.openrouterApiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OpenRouter API key not configured');
    const model = settings.openrouterModel || 'google/gemini-2.0-flash-exp';
    const r = await extractWithOpenRouter(imageBuffer, mimeType, apiKey, model, pictureDateIso);
    return { ...r, aiProvider: provider };
  }
  const apiKey = settings.geminiApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key not configured');
  const r = await extractWithGemini(imageBuffer, mimeType, apiKey, pictureDateIso);
  return { ...r, aiProvider: provider };
}

// Best-effort mime type from the leading bytes of the downloaded buffer.
function detectMimeType(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  if (buf.length >= 3 && buf.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  return 'image/jpeg';
}

function toMs(iso?: string): number | undefined {
  if (!iso) return undefined;
  const dt = DateTime.fromISO(iso);
  if (dt.isValid) return dt.toMillis();
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function contentHashFor(ev: RawEvent): string {
  const input = [
    ev.title,
    ev.descriptionHtml || '',
    ev.start || '',
    ev.venueName || '',
    ev.organizer || '',
    ev.url || '',
  ].join('|');
  return crypto.createHash('sha256').update(input).digest('hex');
}

export async function handlePosterImportJob(job: JobShim<any>): Promise<void> {
  const payload = (job.data || {}) as {
    runId: string;
    sourceId: string;
    content?: string;
    imageStorageId?: string;
    testMode?: boolean;
    pictureDateIso?: string;
  };
  const runId = payload.runId;
  if (!runId) throw new Error('posterImport job missing runId');

  // Logger adapter for the ai_poster_import module (expects info/warn/error).
  const moduleLogger = {
    info: (m: string) => job.log(m),
    warn: (m: string) => job.log(`WARN: ${m}`),
    error: (m: string) => job.log(`ERROR: ${m}`),
    debug: (_m: string) => {},
  };

  let tempFile: string | null = null;

  try {
    const jobCtx: any = await convex.query(getPosterJobRef, { runId });
    if (!jobCtx) throw new Error(`Poster run ${runId} not found`);
    const sourceId = payload.sourceId || jobCtx.source?.id;
    if (!sourceId) throw new Error('Poster source not resolved');

    await convex.mutation(markRunRunningRef, { runId });

    // Build the JSON payload the ai_poster_import module expects. For an image
    // job we AI-extract first; for a content job we pass the pasted content
    // straight through.
    let moduleContent: string;

    if (payload.imageStorageId) {
      job.log(`Downloading poster image ${payload.imageStorageId} from Convex storage...`);
      const imageBuffer = await downloadFromConvexStorage(payload.imageStorageId);
      const mimeType = detectMimeType(imageBuffer);

      // Persist to a temp file (parity with the original disk write; some image
      // tooling expects a path). The canonical image already lives in Convex
      // storage, so we only need it transiently here.
      const ext =
        mimeType === 'image/png'
          ? '.png'
          : mimeType === 'image/webp'
            ? '.webp'
            : mimeType === 'image/gif'
              ? '.gif'
              : '.jpg';
      tempFile = path.join(os.tmpdir(), `poster_${runId}${ext}`);
      await fs.writeFile(tempFile, imageBuffer);

      job.log(`Extracting events with ${jobCtx.settings.aiProvider.toUpperCase()}...`);
      const { events, extractionConfidence, aiProvider } = await extractPosterEventsFromImage(
        imageBuffer,
        mimeType,
        jobCtx.settings as PosterSettings,
        payload.pictureDateIso,
      );
      job.log(`AI (${aiProvider}) extracted ${events.length} event(s)`);

      moduleContent = JSON.stringify({ events, extractionConfidence, aiProvider });
    } else if (payload.content) {
      moduleContent = payload.content;
    } else {
      throw new Error('Poster job has neither imageStorageId nor content');
    }

    // Reuse the ai_poster_import module to map the JSON payload into RawEvents.
    const rawEvents: RawEvent[] = await aiPosterImport.processUpload!(
      moduleContent,
      'json',
      moduleLogger,
    );
    job.log(`Mapped ${rawEvents.length} raw event(s)`);

    let saved = 0;
    for (const ev of rawEvents) {
      const startMs = toMs(ev.start);
      if (startMs === undefined) {
        job.log(`Skipping "${ev.title}" — unparseable start date`);
        continue;
      }
      try {
        await convex.mutation(insertEventRef, {
          runId,
          sourceId,
          sourceEventId: ev.sourceEventId,
          title: ev.title,
          descriptionHtml: ev.descriptionHtml,
          startDatetime: startMs,
          endDatetime: toMs(ev.end),
          timezone: undefined,
          venueName: ev.venueName,
          venueAddress: ev.venueAddress,
          city: ev.city,
          region: ev.region,
          country: ev.country,
          organizer: ev.organizer,
          category: ev.category,
          price: ev.price,
          tags: ev.tags,
          url: ev.url,
          imageUrl: ev.imageUrl,
          localImageStorageId: payload.imageStorageId,
          raw: ev.raw ?? {},
          contentHash: contentHashFor(ev),
        });
        saved++;
      } catch (err) {
        job.log(`Failed to save "${ev.title}": ${(err as Error).message}`);
      }
    }

    await convex.mutation(finishRunRef, {
      runId,
      status: 'success',
      eventsFound: saved,
      pagesCrawled: 0,
    });
    job.log(`Poster import complete: ${saved} event(s) saved`);
  } catch (error) {
    const message = (error as Error).message || String(error);
    await appendRunLog(runId, 50, `Poster import failed: ${message}`, 'posterImport');
    await convex
      .mutation(finishRunRef, { runId, status: 'error', errors: { error: message } })
      .catch(() => undefined);
    throw error;
  } finally {
    if (tempFile) {
      await fs.unlink(tempFile).catch(() => undefined);
    }
  }
}
