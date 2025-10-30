export interface GeminiEvent {
    title: string;
    description?: string | null;
    startDate: string;
    startTime?: string | null;
    endDate?: string | null;
    endTime?: string | null;
    timezone?: string | null;
    occurrenceType?: 'single' | 'multi_day' | 'recurring' | 'all_day' | 'virtual';
    recurrenceType?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
    seriesDates?: Array<{
        start: string;
        end: string;
    }> | null;
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
export interface GeminiClassificationResult {
    isEventPoster: boolean;
    confidence?: number | null;
    reasoning?: string | null;
    cues?: string[] | null;
    shouldExtractEvents?: boolean;
}
export interface GeminiExtractionResult {
    events: GeminiEvent[];
    classification?: GeminiClassificationResult;
    extractionConfidence?: {
        overall?: number;
        notes?: string;
    };
}
export declare class GeminiExtractionError extends Error {
    constructor(message: string);
}
export declare class GeminiClientUnavailable extends GeminiExtractionError {
    constructor(message?: string);
}
export declare class GeminiApiKeyMissing extends GeminiExtractionError {
    constructor(message?: string);
}
/**
 * Extract event data from an image using Gemini Vision API
 */
export declare function extractEventFromImage(imageBuffer: Buffer, mimeType: string, apiKey: string, options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
}): Promise<GeminiExtractionResult>;
/**
 * Classify whether an image is an event poster using Gemini Vision API
 */
export declare function classifyEventFromImage(imageBuffer: Buffer, mimeType: string, apiKey: string, options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
}): Promise<GeminiClassificationResult>;
/**
 * Extract event data from a file path
 */
export declare function extractEventFromImageFile(imagePath: string, apiKey: string, options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
}): Promise<GeminiExtractionResult>;
/**
 * Classify whether a file path corresponds to an event poster
 */
export declare function classifyEventFromImageFile(imagePath: string, apiKey: string, options?: {
    caption?: string | null;
    postTimestamp?: Date | null;
}): Promise<GeminiClassificationResult>;
//# sourceMappingURL=gemini-extractor.d.ts.map
