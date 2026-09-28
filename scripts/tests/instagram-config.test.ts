import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveInstagramAiSettings } from '../../convex/lib/instagramAiSettings';
import { getInstagramConfig, refreshInstagramBatchRun } from '../../convex/worker';
import { get } from '../../convex/instagramSettings';
import { queue } from '../../convex/instagramReview';

test('UI and ingestion share global provider/model/key precedence while masking UI secrets', async () => {
  const instagram = {aiProvider:'claude',claudeApiKey:'legacy-key',geminiApiKey:'legacy-gemini'};
  const global = {aiProvider:'openrouter',openrouterApiKey:'global-key',openrouterModel:'model/vision'};
  const ctx = {db:{query:(table:string)=>({first:async()=>table==='systemSettings'?global:instagram})}};
  const worker = await (getInstagramConfig as any)._handler(ctx,{});
  const { settings:ui } = await (get as any)._handler(ctx,{});
  assert.equal(worker.aiProvider,'openrouter');
  assert.equal(worker.openrouterApiKey,'global-key');
  assert.equal(worker.openrouterModel,'model/vision');
  assert.equal(ui.aiProvider,worker.aiProvider);
  assert.equal(ui.openrouterModel,worker.openrouterModel);
  assert.equal(ui.hasOpenrouterKey,true);
  assert.equal(ui.openrouterApiKey,undefined);
  assert.equal(ui.claudeApiKey,undefined);
});
test('legacy settings work without global settings', () => {
  assert.equal(resolveInstagramAiSettings({aiProvider:'claude',claudeApiKey:'fixture'},null).aiProvider,'claude');
  assert.equal(resolveInstagramAiSettings(null,null).aiProvider,'gemini');
});
test('batch stays running until every expected account has a terminal child', async () => {
  const children:any[] = [{status:'success',eventsFound:1}];
  const parent = {metadata:{batch:{total:2}}};
  let patch:any;
  const ctx = {db:{query:()=>({withIndex:()=>({collect:async()=>children})}),get:async()=>parent,patch:async(_id:string,p:any)=>{patch=p;}}};
  await (refreshInstagramBatchRun as any)._handler(ctx,{parentRunId:'parent'});
  assert.equal(patch.status,'running');
  assert.equal(patch.metadata.batch.pending,1);
  assert.equal(patch.finishedAt,undefined);
  children.push({status:'partial',eventsFound:0});
  await (refreshInstagramBatchRun as any)._handler(ctx,{parentRunId:'parent'});
  assert.equal(patch.status,'partial');
  assert.equal(patch.metadata.batch.pending,0);
  assert.equal(patch.metadata.batch.failed,1);
  assert.equal(typeof patch.finishedAt,'number');
});

// React review cards use a nullable classification; Convex stores missing values.
test('review queue serializes pending classification as null and preserves false', async () => {
  const rows:any = {sources:[{_id:'source',sourceType:'instagram'}],instagramAccounts:[],eventsRaw:[
    {_id:'pending',sourceId:'source',scrapedAt:2},
    {_id:'rejected',sourceId:'source',scrapedAt:1,isEventPoster:false},
  ]};
  const ctx = {db:{query:(table:string)=>({collect:async()=>rows[table],withIndex:()=>({collect:async()=>rows[table]})})}};
  const result = await (queue as any)._handler(ctx,{filter:'all'});
  assert.equal(result.posts[0].event.isEventPoster,null);
  assert.equal(result.posts[1].event.isEventPoster,false);
});
