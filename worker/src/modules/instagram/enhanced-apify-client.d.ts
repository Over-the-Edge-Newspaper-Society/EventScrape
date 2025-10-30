/**
 * Enhanced Apify Client for EventScrape
 * Features:
 * - Node.js runner with REST fallback
 * - Batch processing for multiple accounts
 * - Run snapshot import
 * - Runtime diagnostics
 * - Key-value store access
 */
export interface ApifyPost {
    id: string;
    caption?: string;
    timestamp: Date;
    imageUrl?: string;
    videoUrl?: string;
    isVideo: boolean;
    permalink: string;
    username?: string;
    ownerUsername?: string;
}
export interface ApifyRunInfo {
    id: string;
    status: string;
    defaultDatasetId?: string;
    defaultKeyValueStoreId?: string;
    startedAt: string;
    finishedAt?: string;
}
export interface RuntimeInfo {
    preferNode: boolean;
    nodeAvailable: boolean;
    nodeFailed: boolean;
    usingNode: boolean;
    lastRunner?: 'node' | 'rest';
}
export declare class ApifyClientError extends Error {
    constructor(message: string);
}
export declare class ApifyRunTimeoutError extends ApifyClientError {
    constructor(message: string);
}
export declare class ApifyNodeRunnerError extends ApifyClientError {
    shouldFallback: boolean;
    constructor(message: string, shouldFallback?: boolean);
}
export declare class EnhancedApifyClient {
    private client;
    private apiToken;
    private actorId;
    private baseUrl;
    private defaultTimeout;
    private runnerPath;
    private nodeCommand;
    private nodeTimeoutBuffer;
    private preferNode;
    private nodeAvailable;
    private nodeFailed;
    private lastRunner?;
    constructor(apiToken: string, actorId?: string, options?: {
        baseUrl?: string;
        defaultTimeout?: number;
        useNodeRunner?: boolean;
        nodeRunnerPath?: string;
        nodeCommand?: string;
    });
    /**
     * Run actor and collect results with automatic Node/REST fallback
     */
    runAndCollect(runInput: Record<string, any>, options?: {
        pollInterval?: number;
        timeoutSeconds?: number;
        datasetLimit?: number;
    }): Promise<any[]>;
    /**
     * Run via Node.js runner for better reliability
     */
    private runAndCollectViaNode;
    /**
     * Run via REST API with polling
     */
    private runAndCollectViaRest;
    /**
     * Get dataset items with pagination
     */
    getDatasetItems(datasetId: string, limit?: number): Promise<any[]>;
    /**
     * Get key-value store record (e.g., INPUT)
     */
    getKeyValueRecord(storeId: string, recordKey?: string): Promise<any>;
    /**
     * Get run details
     */
    getRun(runId: string): Promise<ApifyRunInfo>;
    /**
     * Fetch posts from run snapshot (for importing existing runs)
     */
    fetchRunSnapshot(runId: string, limit?: number): Promise<{
        input: any;
        items: any[];
        posts: ApifyPost[];
    }>;
    /**
     * Batch process multiple usernames in one or more Apify runs
     */
    fetchPostsBatch(usernames: string[], limitPerUsername: number, knownIdsMap?: Map<string, Set<string>>, batchSizeOverride?: number): Promise<Map<string, ApifyPost[]>>;
    /**
     * Process a chunk of usernames
     */
    private processChunk;
    /**
     * Convert raw Apify items to posts
     */
    convertItemsToPosts(items: any[], limit?: number): ApifyPost[];
    /**
     * Convert single Apify item to post
     */
    private convertItemToPost;
    /**
     * Extract username from Apify item
     */
    private extractUsernameFromItem;
    /**
     * Test Apify fetch with a single URL
     */
    testFetch(url: string, limit?: number): Promise<{
        input: any;
        items: any[];
        posts: ApifyPost[];
        runner: string;
    }>;
    /**
     * Get runtime diagnostics
     */
    getRuntimeInfo(): RuntimeInfo;
    /**
     * Check if should use Node runner
     */
    private shouldUseNodeRunner;
    /**
     * Close client
     */
    close(): void;
}
/**
 * Create an enhanced Apify client instance
 */
export declare function createEnhancedApifyClient(apiToken: string, actorId?: string): Promise<EnhancedApifyClient>;
//# sourceMappingURL=enhanced-apify-client.d.ts.map
