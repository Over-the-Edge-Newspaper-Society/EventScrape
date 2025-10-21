import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Load the Gemini prompt
const GEMINI_PROMPT_PATH = path.join(__dirname, 'gemini-prompt.md');
let GEMINI_PROMPT;
async function loadPrompt() {
    if (!GEMINI_PROMPT) {
        GEMINI_PROMPT = await fs.readFile(GEMINI_PROMPT_PATH, 'utf-8');
    }
    return GEMINI_PROMPT;
}
const GEMINI_MODEL_ID = process.env.GEMINI_MODEL_ID || 'gemini-2.0-flash-exp';
export class GeminiExtractionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GeminiExtractionError';
    }
}
export class GeminiClientUnavailable extends GeminiExtractionError {
    constructor(message = 'Gemini SDK is not available') {
        super(message);
        this.name = 'GeminiClientUnavailable';
    }
}
export class GeminiApiKeyMissing extends GeminiExtractionError {
    constructor(message = 'Gemini API key is not configured') {
        super(message);
        this.name = 'GeminiApiKeyMissing';
    }
}
/**
 * Clean Gemini response text by removing markdown code fences
 */
function cleanResponseText(rawText) {
    if (!rawText)
        return '';
    // Remove markdown code fences like ```json or ```
    return rawText
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .trim();
}
/**
 * Parse JSON from cleaned response text
 */
function parseJsonFromText(rawText) {
    const cleaned = cleanResponseText(rawText);
    if (!cleaned) {
        throw new GeminiExtractionError('Gemini response did not include any JSON content');
    }
    try {
        return JSON.parse(cleaned);
    }
    catch (error) {
        // Try to extract JSON object using regex
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[0]);
            }
            catch (e) {
                throw new GeminiExtractionError('Failed to parse Gemini response as JSON');
            }
        }
        throw new GeminiExtractionError(`Failed to parse Gemini response as JSON: ${error}`);
    }
}
/**
 * Extract event data from an image using Gemini Vision API
 */
export async function extractEventFromImage(imageBuffer, mimeType, apiKey, options) {
    if (!apiKey) {
        throw new GeminiApiKeyMissing();
    }
    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_ID });
        const prompt = await loadPrompt();
        // Build the parts for the request
        const parts = [
            {
                inlineData: {
                    data: imageBuffer.toString('base64'),
                    mimeType,
                },
            },
            { text: prompt },
        ];
        // Add context sections if provided
        const contextSections = [];
        if (options?.postTimestamp) {
            const timestamp = options.postTimestamp.toISOString().split('.')[0];
            contextSections.push(`Instagram post publication details:\n` +
                `- Published on ${timestamp}.\n` +
                `- Treat events as upcoming relative to this date unless the poster clearly indicates an earlier year.`);
        }
        if (options?.caption) {
            contextSections.push(`Instagram caption (additional context):\n${options.caption}`);
        }
        if (contextSections.length > 0) {
            parts.push({ text: `Additional context:\n${contextSections.join('\n\n')}` });
        }
        // Call Gemini API
        const result = await model.generateContent(parts);
        const response = result.response;
        const text = response.text();
        if (!text) {
            throw new GeminiExtractionError('Gemini response did not include text output');
        }
        return parseJsonFromText(text);
    }
    catch (error) {
        if (error instanceof GeminiExtractionError) {
            throw error;
        }
        throw new GeminiExtractionError(`Gemini API error: ${error.message || error}`);
    }
}
/**
 * Extract event data from a file path
 */
export async function extractEventFromImageFile(imagePath, apiKey, options) {
    const imageBuffer = await fs.readFile(imagePath);
    // Determine MIME type from extension
    const ext = path.extname(imagePath).toLowerCase();
    const mimeTypeMap = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
    };
    const mimeType = mimeTypeMap[ext] || 'image/jpeg';
    return extractEventFromImage(imageBuffer, mimeType, apiKey, options);
}
//# sourceMappingURL=gemini-extractor.js.map