import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: Object.fromEntries(['getInstagramConfig','getInstagramAccount','getKnownInstagramPostIds','markRunRunning','getRunMetadata','mergeRunMetadata','upsertInstagramPost','insertExtractedEvent','finishRun','touchInstagramAccount','refreshInstagramBatchRun'].map(k => [k,vi.fn()])),
  fetchPosts: vi.fn(), download: vi.fn(), upload: vi.fn(),
  gemini: { classifyEventFromImageFile: vi.fn(), extractEventFromImageFile: vi.fn() },
  claude: { classifyEventFromImageFile: vi.fn(), extractEventFromImageFile: vi.fn() },
  openrouter: { classifyEventFromImageFile: vi.fn(), extractEventFromImageFile: vi.fn() },
}));
vi.mock('../../lib/convex.js', () => ({workerApi:mocks.api, uploadToConvexStorage:mocks.upload}));
vi.mock('fs/promises', () => ({readFile:async () => Buffer.from('fixture')}));
vi.mock('./gemini-extractor.js', () => mocks.gemini);
vi.mock('./claude-extractor.js', () => mocks.claude);
vi.mock('./openrouter-extractor.js', () => mocks.openrouter);
vi.mock('./apify-scraper.js', () => ({
  createApifyScraper:async () => ({fetchRecentPosts:mocks.fetchPosts, downloadImage:mocks.download}),
  ApifyRateLimitError:class extends Error {}, ApifyAuthError:class extends Error {},
}));
import { handleInstagramScrapeJob } from './instagram-job.js';
import { resolveProvider } from './ai-provider.js';
import { ApifyClientError } from './enhanced-apify-client.js';

const settings = {aiProvider:'openrouter',openrouterApiKey:'fixture',openrouterModel:'model/vision',apifyApiToken:'fixture',defaultScraperType:'apify',allowPerAccountOverride:false,autoClassifyWithAi:true,autoExtractNewPosts:true};
const job = () => ({id:'job',data:{accountId:'account',runId:'run',postLimit:2}, log:vi.fn(),updateProgress:vi.fn()});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('USE_ENHANCED_APIFY_CLIENT','false');
  mocks.api.getInstagramConfig.mockResolvedValue(settings);
  mocks.api.getInstagramAccount.mockResolvedValue({_id:'account',instagramUsername:'fixture',classificationMode:'auto',defaultTimezone:'America/Vancouver'});
  mocks.api.getRunMetadata.mockResolvedValue({});
  mocks.api.mergeRunMetadata.mockImplementation(async ({patch})=>patch);
  mocks.api.getKnownInstagramPostIds.mockResolvedValue([]);
  mocks.fetchPosts.mockResolvedValue([{id:'poster',caption:'An event',imageUrl:'https://example.com/poster.jpg',timestamp:new Date('2026-09-28T12:00:00Z'),permalink:'https://instagram.com/p/fixture/'}]);
  mocks.download.mockResolvedValue('poster.jpg');
  mocks.upload.mockResolvedValue({storageId:'stored',size:7});
  for(const provider of [mocks.gemini,mocks.claude,mocks.openrouter]) {
    provider.classifyEventFromImageFile.mockResolvedValue({isEventPoster:true,confidence:0.95});
    provider.extractEventFromImageFile.mockResolvedValue({events:[{title:'Fixture event',startDate:'2026-10-01',startTime:'17:00:00'}]});
  }
});

afterEach(() => vi.unstubAllEnvs());

describe('Instagram ingestion and review boundary', () => {
  it('stages manual accounts without invoking AI or creating event records', async () => {
    mocks.api.getInstagramAccount.mockResolvedValue({_id:'account',instagramUsername:'fixture',classificationMode:'manual'});
    const result=await handleInstagramScrapeJob(job());
    expect((result as any)?.counters.pendingReview).toBe(1);
    expect(mocks.openrouter.classifyEventFromImageFile).not.toHaveBeenCalled();
    expect(mocks.openrouter.extractEventFromImageFile).not.toHaveBeenCalled();
    expect(mocks.api.insertExtractedEvent).not.toHaveBeenCalled();
    expect(mocks.api.upsertInstagramPost.mock.calls[0][0].isEventPoster).toBeUndefined();
    expect(mocks.api.finishRun).toHaveBeenCalledWith(expect.objectContaining({status:'success',eventsFound:0}));
  });
  for (const provider of ['gemini','claude','openrouter'] as const) {
    it(`uses ${provider} consistently for automatic classification and extraction`, async () => {
      mocks.api.getInstagramConfig.mockResolvedValue({...settings,aiProvider:provider,geminiApiKey:'gemini-fixture',claudeApiKey:'claude-fixture'});
      const result=await handleInstagramScrapeJob(job());
      expect(mocks[provider].classifyEventFromImageFile).toHaveBeenCalledOnce();
      expect(mocks[provider].extractEventFromImageFile).toHaveBeenCalledOnce();
      for(const other of ['gemini','claude','openrouter'] as const) if(other!==provider) expect(mocks[other].extractEventFromImageFile).not.toHaveBeenCalled();
      if(provider==='openrouter') expect(mocks.openrouter.extractEventFromImageFile.mock.calls[0][2].model).toBe('model/vision');
      expect(mocks.api.upsertInstagramPost.mock.calls[0][0].raw.classification[provider].method).toBe(`${provider}-auto`);
      expect((result as any)?.eventsCreated).toBe(1);
    });
  }
  it('does not hide an AI classification failure behind keyword classification', async () => {
    mocks.openrouter.classifyEventFromImageFile.mockRejectedValue(new Error('provider failed'));
    const result=await handleInstagramScrapeJob(job());
    expect(result?.status).toBe('partial');
    expect((result as any)?.counters.classificationFailures).toBe(1);
    expect((result as any)?.counters.pendingReview).toBe(1);
    expect(mocks.api.insertExtractedEvent).not.toHaveBeenCalled();
  });
  it('records extraction failures and keeps saved posts available for review', async () => {
    mocks.openrouter.extractEventFromImageFile.mockRejectedValue(new Error('provider failed'));
    const result=await handleInstagramScrapeJob(job());
    expect(result?.status).toBe('partial');
    expect((result as any)?.counters.extractionFailures).toBe(1);
    expect((result as any)?.counters.postsStored).toBe(1);
    expect(mocks.api.finishRun).toHaveBeenCalledWith(expect.objectContaining({status:'partial',errors:expect.objectContaining({warnings:expect.any(Array)})}));
  });
  it('surfaces durable image storage failure', async () => {
    mocks.upload.mockRejectedValue(new Error('storage unavailable'));
    const result=await handleInstagramScrapeJob(job());
    expect(result?.status).toBe('partial');
    expect((result as any)?.counters.storageFailures).toBe(1);
  });
  it('does not extract or report success when base-post persistence fails', async () => {
    mocks.api.upsertInstagramPost.mockRejectedValue(new Error('database unavailable'));
    const result=await handleInstagramScrapeJob(job());
    expect(result?.status).toBe('error');
    expect((result as any)?.counters.postFailures).toBe(1);
    expect(mocks.openrouter.extractEventFromImageFile).not.toHaveBeenCalled();
  });
  it('finalizes fatal scraper failures so runs do not remain running', async () => {
    mocks.fetchPosts.mockRejectedValue(new Error('scraper failed'));
    await expect(handleInstagramScrapeJob(job())).rejects.toThrow('scraper failed');
    expect(mocks.api.finishRun).toHaveBeenCalledWith(expect.objectContaining({status:'error'}));
  });
  it('reports quota exhaustion as a terminal failure without paid retries', async () => {
    mocks.fetchPosts.mockRejectedValue(new ApifyClientError('Monthly usage hard limit exceeded'));
    const result = await handleInstagramScrapeJob(job());
    expect(result).toMatchObject({status:'error',retryable:false});
    expect(mocks.api.finishRun).toHaveBeenCalledWith(expect.objectContaining({status:'error'}));
  });
  it('rejects an unknown provider and missing selected key instead of silently using Gemini', () => {
    expect(()=>resolveProvider({aiProvider:'unsupported'},{})).toThrow('Unsupported AI provider');
    expect(()=>resolveProvider({aiProvider:'openrouter',geminiApiKey:'present'},{})).toThrow('OpenRouter API key not configured');
    expect(resolveProvider({aiProvider:'claude'},{CLAUDE_API_KEY:'env-fixture'}).provider).toBe('claude');
  });
});
