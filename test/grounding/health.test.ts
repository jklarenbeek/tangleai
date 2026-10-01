import { it } from 'node:test';
import assert from 'node:assert/strict';
import { groundingHostHarness, HOST_QUERY } from '../fixtures/grounding/host-harness.ts';
import { answerHarness, draftClaim } from '../fixtures/grounding/answer-harness.ts';
import { createGroundingHost, profileRevisionOf, createAnswerModel, generateGroundedClaims, renderPrihaAnswer, reconcileEvidence } from '@tangleai/grounding';

it('the final cross-lane supply respects the evidence context ceiling', async () => {
 const h = await groundingHostHarness({ web: true });
 try {
  const profile = structuredClone(h.profile); profile.budgets.contextTokens = 1; profile.revision = await profileRevisionOf(profile);
  const host = await createGroundingHost({ ...h.bindings(), profile, store:h.grounding, segments:h.segments });
  const reply = await host.start({text:HOST_QUERY,conversationId:'tiny-context'});
  const trace = await h.grounding.readTrace(reply.sessionId), native = await h.segments.store.readTrace(reply.identities.runId);
  const output = native!.attempts.find(row => row.invocationId==='reconcile' && row.status==='completed')!.output as {context:{evidenceIds:string[]}};
  const supplied = trace!.evidence.filter(row=>output.context.evidenceIds.includes(row.id));
  assert.ok(trace!.evidence.length>0, 'The test actually fetched evidence.');
  assert.ok(supplied.reduce((n,row)=>n+Math.ceil(row.excerpt.length/4),0)<=1);
  assert.equal(reply.answer!.disposition,'abstain');assert.equal(reply.answer!.citations.length,0);
 } finally {await h.close();}
});
it('standalone answer stages reject oversized supplied evidence before their model call', async () => {
 const f = await answerHarness([]), profile=structuredClone(f.profile);profile.budgets.contextTokens=1;profile.revision=await profileRevisionOf(profile);
 let calls=0;
 const model=await createAnswerModel({profile,modelIdentity:null,clock:()=>0,client:{endpoint:{provider:'scripted'},async complete(){calls++;return {message:{content:JSON.stringify({disposition:'answer',claims:[draftClaim(f.web.id)]})}};}}});
 await assert.rejects(model.run('generate',f.intent.originalQuery,[f.web],{}, {maxRepairs:0}),(cause: unknown)=>(cause as {issue?: {code?: string}}).issue?.code==='TGRD1007');
 assert.equal(calls,0);
});
for (const location of ['claim','caveat','reason']) it('the configured fact boundary refuses an unsupplied '+location, async () => {
 const replies: unknown[]=[],f=await answerHarness(replies);
 const claim: Extract<import('@tangleai/grounding').PrihaAnswer,{disposition:'answer'}>['claims'][number]=draftClaim(f.web.id,{critical:false});
 if(location==='claim')claim.text+=' The user is age seventy.';
 if(location==='caveat')claim.caveats=['The user is age seventy.'];
 replies.push(location==='reason'?{disposition:'abstain',reason:'The user is age seventy.',claims:[]}:{disposition:'answer',claims:[claim]},[]);
 const result=await generateGroundedClaims({...f.options,factVocabulary:['age seventy']});assert.ok(result.ok);
 assert.ok(!renderPrihaAnswer(result.answer).includes('age seventy'));
 assert.equal(result.answer.disposition,'refuse');assert.equal(result.answer.citations.length,0);assert.ok(f.calls()<=2);
});
it('a fact explicitly supplied in this request remains usable', async () => {
 const replies: unknown[]=[],f=await answerHarness(replies,undefined,'I am age seventy. Where is the reception?');
 replies.push({disposition:'answer',claims:[draftClaim(f.web.id,{text:'The user is age seventy. Harbour reception is in Square Hall.',critical:false})]});
 const result=await generateGroundedClaims({...f.options,factVocabulary:['age seventy']});assert.ok(result.ok);assert.equal(result.answer.disposition,'answer');assert.equal(f.calls(),1);
});
it('final conflict caveats cannot reintroduce an unsupplied registered fact', async () => {
 const replies: unknown[]=[],f=await answerHarness(replies),other={...f.web,id:f.web.id+'-other',excerpt:'Harbour reception is in North Hall.'};
 assert.ok((await f.store.putEvidence([other])).ok);
 const reconciled=await reconcileEvidence(f.profile,[f.web,other],{sessionId:f.session.id,now:'2026-07-01T00:00:00.000Z',facts:{}});
 replies.push({decisions:[{conflictId:reconciled.conflicts[0].id,interpretation:'The user is age seventy.',decision:'caveat'}]}, {disposition:'answer',claims:[draftClaim(f.web.id,{critical:false})]});
 const result=await generateGroundedClaims({...f.options,factVocabulary:['age seventy'],admitted:reconciled.admitted,conflicts:reconciled.conflicts});
 assert.ok(result.ok);assert.ok(!renderPrihaAnswer(result.answer).includes('age seventy'));assert.equal(result.answer.disposition,'refuse');assert.equal(result.answer.citations.length,0);assert.equal(f.calls(),2);
});
it('a zero-clarification profile binds only its declared adapters and still answers', async () => {
 const h=await groundingHostHarness({web:true});
 try {
  const profile=structuredClone(h.profile);profile.clarification.maxTurns=0;profile.revision=await profileRevisionOf(profile);
  const host=await createGroundingHost({...h.bindings(),profile,store:h.grounding,segments:h.segments});
  const result=await host.start({text:HOST_QUERY,conversationId:'no-clarification'});assert.equal(result.disposition,'answer');assert.equal(result.trace.calls,7);
  const before=h.stats();const routes=await Promise.all(['emergency-a','emergency-b'].map(conversationId=>host.start({text:'urgent fixture signal',conversationId})));
  assert.ok(routes.every(reply=>reply.disposition==='refusal' && reply.trace.calls===0));assert.deepEqual(h.stats(),before);
  assert.notEqual(routes[0].identities.workflowVersionId,routes[1].identities.workflowVersionId);
 } finally {await h.close();}
});
