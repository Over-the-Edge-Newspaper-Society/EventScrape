/**
 * Enhanced Apify Client for EventScrape
 * Features:
 * - Node.js runner with REST fallback
 * - Batch processing for multiple accounts
 * - Run snapshot import
 * - Runtime diagnostics
 * - Key-value store access
 */
import { ApifyClient as ApifySDK } from 'apify-client';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Environment configuration
const DEFAULT_APIFY_ACTOR_ID = process.env.APIFY_ACTOR_ID || 'apify/instagram-profile-scraper';
const APIFY_BATCH_SIZE = parseInt(process.env.APIFY_BATCH_SIZE || '8', 10);
const APIFY_RUN_TIMEOUT_SECONDS = parseInt(process.env.APIFY_RUN_TIMEOUT_SECONDS || '180', 10);
const APIFY_USE_NODE_CLIENT = process.env.APIFY_USE_NODE_CLIENT !== 'false'; // default true
const APIFY_NODE_COMMAND = process.env.APIFY_NODE_COMMAND || 'node';
const APIFY_NODE_TIMEOUT_BUFFER_SECONDS = parseInt(process.env.APIFY_NODE_TIMEOUT_BUFFER_SECONDS || '30', 10);
export class ApifyClientError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ApifyClientError';
    }
}
export class ApifyRunTimeoutError extends ApifyClientError {
    constructor(message) {
        super(message);
        this.name = 'ApifyRunTimeoutError';
    }
}
export class ApifyNodeRunnerError extends ApifyClientError {
    shouldFallback;
    constructor(message, shouldFallback = false) {
        super(message);
        this.name = 'ApifyNodeRunnerError';
        this.shouldFallback = shouldFallback;
    }
}
export class EnhancedApifyClient {
    client;
    apiToken;
    actorId;
    baseUrl;
    defaultTimeout;
    runnerPath;
    nodeCommand;
    nodeTimeoutBuffer;
    preferNode;
    nodeAvailable = false;
    nodeFailed = false;
    lastRunner;
    constructor(apiToken, actorId = DEFAULT_APIFY_ACTOR_ID, options = {}) {
        if (!apiToken) {
            throw new ApifyClientError('Apify API token is required');
        }
        if (!actorId) {
            throw new ApifyClientError('Apify actor ID is required');
        }
        this.apiToken = apiToken;
        this.actorId = actorId;
        this.baseUrl = options.baseUrl || 'https://api.apify.com/v2';
        this.defaultTimeout = Math.max(options.defaultTimeout || 30, 1);
        this.client = new ApifySDK({
            token: apiToken,
            ...(options.baseUrl && { baseUrl: options.baseUrl }),
        });
        // Node runner configuration
        const defaultRunnerPath = path.join(__dirname, 'apify-node-runner', 'runner.mjs');
        this.runnerPath = options.nodeRunnerPath || process.env.APIFY_NODE_RUNNER_PATH || defaultRunnerPath;
        this.nodeCommand = options.nodeCommand || APIFY_NODE_COMMAND;
        this.nodeTimeoutBuffer = APIFY_NODE_TIMEOUT_BUFFER_SECONDS;
        this.preferNode = options.useNodeRunner ?? APIFY_USE_NODE_CLIENT;
        // Check if Node runner is available
        if (this.preferNode && fs.existsSync(this.runnerPath)) {
            this.nodeAvailable = true;
        }
    }
    /**
     * Run actor and collect results with automatic Node/REST fallback
     */
    async runAndCollect(runInput, options = {}) {
        const timeoutSeconds = Math.max(options.timeoutSeconds || APIFY_RUN_TIMEOUT_SECONDS, 1);
        if (this.shouldUseNodeRunner()) {
            try {
                return await this.runAndCollectViaNode(runInput, timeoutSeconds, options.datasetLimit);
            }
            catch (error) {
                if (error instanceof ApifyNodeRunnerError && error.shouldFallback) {
                    this.nodeAvailable = false;
                    this.nodeFailed = true;
                    // Fall through to REST
                }
                else {
                    throw error;
                }
            }
        }
        return this.runAndCollectViaRest(runInput, options.pollInterval || 5, timeoutSeconds, options.datasetLimit);
    }
    /**
     * Run via Node.js runner for better reliability
     */
    async runAndCollectViaNode(runInput, timeoutSeconds, datasetLimit) {
        if (!this.nodeAvailable) {
            throw new ApifyNodeRunnerError('Apify Node runner is not available', true);
        }
        const args = [
            this.runnerPath,
            '--token', this.apiToken,
            '--actor', this.actorId,
            '--timeoutSecs', this.defaultTimeout.toString(),
            '--waitSecs', timeoutSeconds.toString(),
        ];
        if (datasetLimit !== undefined) {
            args.push('--limit', datasetLimit.toString());
        }
        if (this.baseUrl !== 'https://api.apify.com/v2') {
            args.push('--base-url', this.baseUrl);
        }
        return new Promise((resolve, reject) => {
            const child = spawn(this.nodeCommand, args, {
                timeout: (timeoutSeconds + this.nodeTimeoutBuffer) * 1000,
            });
            let stdout = '';
            let stderr = '';
            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('error', (error) => {
                if (error.code === 'ENOENT') {
                    reject(new ApifyNodeRunnerError(`Node command '${this.nodeCommand}' was not found`, true));
                }
                else {
                    reject(new ApifyNodeRunnerError(error.message, true));
                }
            });
            child.on('close', (code) => {
                if (code !== 0) {
                    const message = stderr || stdout || 'Unknown error from Apify Node runner';
                    const lowerMessage = message.toLowerCase();
                    if (lowerMessage.includes('cannot find module') || lowerMessage.includes('err_module_not_found')) {
                        reject(new ApifyNodeRunnerError('Apify Node runner dependencies are missing. Run: cd worker/src/modules/instagram/apify-node-runner && npm install', true));
                    }
                    else {
                        // Try to parse error JSON
                        try {
                            const errorPayload = JSON.parse(message);
                            const errorMsg = errorPayload.message || message;
                            reject(new ApifyClientError(`Apify Node runner failed: ${errorMsg}`));
                        }
                        catch {
                            reject(new ApifyClientError(`Apify Node runner failed: ${message}`));
                        }
                    }
                    return;
                }
                if (!stdout.trim()) {
                    this.lastRunner = 'node';
                    resolve([]);
                    return;
                }
                try {
                    const items = JSON.parse(stdout);
                    if (!Array.isArray(items)) {
                        reject(new ApifyClientError('Apify Node runner produced unexpected output format'));
                        return;
                    }
                    this.lastRunner = 'node';
                    resolve(items);
                }
                catch (error) {
                    reject(new ApifyNodeRunnerError('Apify Node runner returned malformed JSON output', true));
                }
            });
            // Send input via stdin
            child.stdin.write(JSON.stringify(runInput));
            child.stdin.end();
        });
    }
    /**
     * Run via REST API with polling
     */
    async runAndCollectViaRest(runInput, pollInterval, timeoutSeconds, datasetLimit) {
        const run = await this.client.actor(this.actorId).call(runInput);
        const runId = run.id;
        if (!runId) {
            throw new ApifyClientError('Apify run response did not include an ID');
        }
        const deadline = Date.now() + timeoutSeconds * 1000;
        let status = run.status;
        while (!['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
            if (Date.now() > deadline) {
                throw new ApifyRunTimeoutError('Apify run did not finish before timeout');
            }
            await new Promise(resolve => setTimeout(resolve, Math.max(pollInterval, 1) * 1000));
            const updatedRun = await this.client.run(runId).get();
            status = updatedRun?.status || status;
        }
        if (status !== 'SUCCEEDED') {
            throw new ApifyClientError(`Apify run ended with status ${status}`);
        }
        const runDetails = await this.client.run(runId).get();
        const datasetId = runDetails?.defaultDatasetId;
        if (!datasetId) {
            this.lastRunner = 'rest';
            return [];
        }
        const items = await this.getDatasetItems(datasetId, datasetLimit);
        this.lastRunner = 'rest';
        return items;
    }
    /**
     * Get dataset items with pagination
     */
    async getDatasetItems(datasetId, limit) {
        const dataset = this.client.dataset(datasetId);
        const items = [];
        let offset = 0;
        const pageSize = 500;
        while (true) {
            const response = await dataset.listItems({
                limit: pageSize,
                offset,
                clean: true,
            });
            const batch = response.items || [];
            if (batch.length === 0)
                break;
            items.push(...batch);
            offset += batch.length;
            if (limit !== undefined && items.length >= limit) {
                break;
            }
            if (offset >= (response.total || 0)) {
                break;
            }
        }
        return limit !== undefined ? items.slice(0, limit) : items;
    }
    /**
     * Get key-value store record (e.g., INPUT)
     */
    async getKeyValueRecord(storeId, recordKey = 'INPUT') {
        try {
            const record = await this.client.keyValueStore(storeId).getRecord(recordKey);
            return record?.value || {};
        }
        catch (error) {
            if (error.message?.includes('404') || error.message?.includes('not found')) {
                return {};
            }
            throw new ApifyClientError(`Failed to read key-value record: ${error.message}`);
        }
    }
    /**
     * Get run details
     */
    async getRun(runId) {
        try {
            const run = await this.client.run(runId).get();
            if (!run) {
                throw new ApifyClientError(`Run ${runId} not found`);
            }
            return {
                id: run.id,
                status: run.status,
                defaultDatasetId: run.defaultDatasetId || '',
                defaultKeyValueStoreId: run.defaultKeyValueStoreId || '',
                startedAt: run.startedAt?.toISOString() || '',
                finishedAt: run.finishedAt?.toISOString() || '',
            };
        }
        catch (error) {
            throw new ApifyClientError(`Failed to get run: ${error.message}`);
        }
    }
    /**
     * Fetch posts from run snapshot (for importing existing runs)
     */
    async fetchRunSnapshot(runId, limit) {
        const run = await this.getRun(runId);
        if (!run.defaultDatasetId) {
            throw new ApifyClientError('Apify run did not expose a dataset of items');
        }
        const rawItems = await this.getDatasetItems(run.defaultDatasetId, limit);
        // Get run input if available
        let runInput = {};
        if (run.defaultKeyValueStoreId) {
            try {
                runInput = await this.getKeyValueRecord(run.defaultKeyValueStoreId, 'INPUT');
            }
            catch {
                // Input not available, continue
            }
        }
        // Convert items to posts
        const posts = this.convertItemsToPosts(rawItems, limit);
        return {
            input: runInput,
            items: rawItems,
            posts,
        };
    }
    /**
     * Batch process multiple usernames in one or more Apify runs
     */
    async fetchPostsBatch(usernames, limitPerUsername, knownIdsMap = new Map()) {
        if (usernames.length === 0) {
            return new Map();
        }
        const postsByUser = new Map();
        usernames.forEach(username => postsByUser.set(username, []));
        const batchSize = Math.max(APIFY_BATCH_SIZE, 1);
        const chunks = [];
        for (let i = 0; i < usernames.length; i += batchSize) {
            chunks.push(usernames.slice(i, i + batchSize));
        }
        for (const chunk of chunks) {
            await this.processChunk(chunk, limitPerUsername, knownIdsMap, postsByUser);
        }
        // Sort and limit posts for each user
        postsByUser.forEach((posts, username) => {
            posts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
            postsByUser.set(username, posts.slice(0, limitPerUsername));
        });
        return postsByUser;
    }
    /**
     * Process a chunk of usernames
     */
    async processChunk(chunk, limitPerUsername, knownIdsMap, postsByUser) {
        const chunkLimit = Math.max(limitPerUsername * chunk.length, limitPerUsername);
        const directUrls = chunk.map(username => `https://www.instagram.com/${username}/`);
        const runInput = {
            directUrls,
            username: chunk,
            resultsLimit: chunkLimit,
            maxItems: chunkLimit,
            skipPinnedPosts: false,
        };
        let items;
        try {
            items = await this.runAndCollect(runInput, {
                datasetLimit: chunkLimit,
                timeoutSeconds: APIFY_RUN_TIMEOUT_SECONDS,
            });
        }
        catch (error) {
            // If batch fails and we have multiple users, try splitting
            if (chunk.length > 1 && !(error instanceof ApifyRunTimeoutError)) {
                const mid = Math.floor(chunk.length / 2);
                await this.processChunk(chunk.slice(0, mid), limitPerUsername, knownIdsMap, postsByUser);
                await this.processChunk(chunk.slice(mid), limitPerUsername, knownIdsMap, postsByUser);
                return;
            }
            throw error;
        }
        const consecutiveKnown = new Map();
        chunk.forEach(username => consecutiveKnown.set(username, 0));
        for (const item of items) {
            const username = this.extractUsernameFromItem(item);
            if (!username || !postsByUser.has(username))
                continue;
            const userPosts = postsByUser.get(username);
            if (userPosts.length >= limitPerUsername)
                continue;
            const shortcode = item.shortCode || item.shortcode || item.id;
            if (!shortcode)
                continue;
            // Check known posts
            const knownIds = knownIdsMap.get(username);
            if (knownIds && knownIds.has(shortcode)) {
                const count = (consecutiveKnown.get(username) || 0) + 1;
                consecutiveKnown.set(username, count);
                if (count >= 2)
                    continue; // Skip after 2 consecutive known
                continue;
            }
            consecutiveKnown.set(username, 0);
            // Convert to post
            const post = this.convertItemToPost(item, username);
            if (post) {
                userPosts.push(post);
            }
        }
    }
    /**
     * Convert raw Apify items to posts
     */
    convertItemsToPosts(items, limit) {
        const posts = [];
        for (const item of items) {
            const username = this.extractUsernameFromItem(item);
            const post = this.convertItemToPost(item, username);
            if (post) {
                posts.push(post);
            }
            if (limit && posts.length >= limit)
                break;
        }
        posts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        return limit ? posts.slice(0, limit) : posts;
    }
    /**
     * Convert single Apify item to post
     */
    convertItemToPost(item, username) {
        const shortcode = item.shortCode || item.shortcode || item.id;
        if (!shortcode)
            return null;
        const timestampValue = item.timestamp || item.takenAtTimestamp;
        let timestamp = new Date();
        if (typeof timestampValue === 'string') {
            timestamp = new Date(timestampValue);
        }
        else if (typeof timestampValue === 'number') {
            timestamp = new Date(timestampValue * 1000);
        }
        const caption = item.caption || '';
        let imageUrl = item.displayUrl || item.display_url || item.thumbnailUrl;
        if (!imageUrl && item.images && Array.isArray(item.images) && item.images.length > 0) {
            const first = item.images[0];
            if (typeof first === 'object') {
                imageUrl = first.url || first.displayUrl;
            }
        }
        const productType = (item.productType || item.type || '').toLowerCase();
        const pathSegment = productType.includes('reel') ? 'reel' : 'p';
        const permalink = item.url || item.permalink || `https://www.instagram.com/${pathSegment}/${shortcode}/`;
        return {
            id: shortcode,
            caption,
            timestamp,
            imageUrl: imageUrl || undefined,
            videoUrl: item.videoUrl || undefined,
            isVideo: item.type === 'Video' || !!item.videoUrl,
            permalink,
            username,
            ownerUsername: item.ownerUsername || item.owner_username || username,
        };
    }
    /**
     * Extract username from Apify item
     */
    extractUsernameFromItem(item) {
        let username = item.ownerUsername || item.owner_username;
        if (username)
            return username;
        const inputUrl = item.inputUrl || item.input_url;
        if (inputUrl && inputUrl.includes('instagram.com')) {
            try {
                const parts = inputUrl.trim().replace(/\/+$/, '').split('/');
                return parts[parts.length - 1] || undefined;
            }
            catch {
                return undefined;
            }
        }
        return undefined;
    }
    /**
     * Test Apify fetch with a single URL
     */
    async testFetch(url, limit = 10) {
        if (!url) {
            throw new ApifyClientError('Instagram URL is required');
        }
        const runInput = {
            directUrls: [url],
            resultsLimit: limit,
            maxItems: limit,
            skipPinnedPosts: false,
        };
        const rawItems = await this.runAndCollect(runInput, {
            datasetLimit: limit,
            timeoutSeconds: APIFY_RUN_TIMEOUT_SECONDS,
        });
        const posts = this.convertItemsToPosts(rawItems, limit);
        const runnerMode = this.lastRunner || 'rest';
        return {
            input: runInput,
            items: rawItems,
            posts,
            runner: runnerMode,
        };
    }
    /**
     * Get runtime diagnostics
     */
    getRuntimeInfo() {
        return {
            preferNode: this.preferNode,
            nodeAvailable: this.nodeAvailable,
            nodeFailed: this.nodeFailed,
            usingNode: this.shouldUseNodeRunner(),
            lastRunner: this.lastRunner,
        };
    }
    /**
     * Check if should use Node runner
     */
    shouldUseNodeRunner() {
        return this.preferNode && !this.nodeFailed && this.nodeAvailable;
    }
    /**
     * Close client
     */
    close() {
        // Nothing to close for now
    }
}
/**
 * Create an enhanced Apify client instance
 */
export async function createEnhancedApifyClient(apiToken, actorId) {
    if (!apiToken) {
        throw new ApifyClientError('Apify API token is required. Set APIFY_API_TOKEN environment variable.');
    }
    return new EnhancedApifyClient(apiToken, actorId);
}
//# sourceMappingURL=enhanced-apify-client.js.map