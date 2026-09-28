import assert from 'node:assert/strict';
import {test} from 'node:test';
import {queue, getStats, jobProgress} from '../../convex/instagramReview';
import {getKnownInstagramPostIds} from '../../convex/worker';

function harness() {
  const rows:any = {sources:[{_id:'ig',sourceType:'instagram'},{_id:'website',sourceType:'website'}],instagramAccounts:[],eventsRaw:[
    {_id:'web',sourceId:'website',scrapedAt:99},
    {_id:'one',sourceId:'ig',instagramAccountId:'a',instagramPostId:'post-a',scrapedAt:3},
    {_id:'two',sourceId:'ig',instagramAccountId:'b',instagramPostId:'post-b',scrapedAt:2,isEventPoster:false},
    {_id:'three',sourceId:'ig',instagramAccountId:'a',scrapedAt:1,isEventPoster:true,localImagePath:'file.jpg'},
  ],jobs:[
    {_id:'ai-active',queue:'review',status:'running',createdAt:Date.now(),updatedAt:Date.now(),payload:{eventId:'one',mode:'classify',secret:'must-not-return'}},
    {_id:'ai-done',queue:'review',status:'success',createdAt:Date.now()-1,updatedAt:Date.now()-1,payload:{eventId:'two',mode:'extract'}},
    {_id:'old-error',queue:'review',status:'error',createdAt:1,updatedAt:1,payload:{}},
    {_id:'ig-job',queue:'instagramScrape',status:'queued',createdAt:1,updatedAt:1,payload:{}},
  ]};
  const ctx = {db:{query:(table:string)=>{
    let filtered=rows[table]; let indexed=false;
    const chain:any={
      withIndex:(name:string,fn:any)=>{indexed=true; const q:any={eq:(key:string,value:any)=>{filtered=filtered.filter((r:any)=>r[key]===value);return q}};fn?.(q);return chain;},
      collect:async()=>{assert.ok(indexed || table==='instagramAccounts','unbounded catalogue/job scan');return filtered;},
      order:()=>{filtered=[...filtered].sort((a:any,b:any)=>b.createdAt-a.createdAt);return chain;},
      take:async(n:number)=>{assert.ok(indexed);return filtered.slice(0,n)},
    };return chain;
  }},storage:{getUrl:async()=>null}};
  return {ctx,rows};
}
test('indexed review excludes website events and preserves filtering, sorting and pagination',async()=>{
  const {ctx}=harness();
  const all=await (queue as any)._handler(ctx,{filter:'all',limit:1,page:2});
  assert.equal(all.pagination.total,3);assert.equal(all.posts[0].event._id,'two');
  const account=await (queue as any)._handler(ctx,{filter:'all',accountId:'a'});
  assert.deepEqual(account.posts.map((p:any)=>p.event._id),['one','three']);
  const pending=await (queue as any)._handler(ctx,{filter:'pending'});
  assert.equal(pending.posts[0].event.isEventPoster,null);assert.equal(pending.pagination.total,1);
  const extraction=await (queue as any)._handler(ctx,{filter:'needs-extraction'});
  assert.equal(extraction.posts[0].event._id,'three');
  assert.deepEqual(await (getStats as any)._handler(ctx,{}),{total:3,unclassified:1,markedAsEvent:1,markedAsNotEvent:1,needsExtraction:1});
});
test('known-post lookup is restricted to the requested Instagram account',async()=>{
  const {ctx}=harness();
  assert.deepEqual(await (getKnownInstagramPostIds as any)._handler(ctx,{accountId:'a'}),['post-a']);
});
test('progress distinguishes queued ingestion, active AI and completed AI without returning payloads',async()=>{
  const {ctx}=harness();const result=await (jobProgress as any)._handler(ctx,{});
  assert.equal(result.recent.length,2);assert.equal(result.ingestionActive,1);assert.equal(result.active.length,1);
  assert.equal(result.recent[1].status,'success');assert.equal(result.active[0].eventId,'one');
  assert.equal(JSON.stringify(result).includes('must-not-return'),false);
});
