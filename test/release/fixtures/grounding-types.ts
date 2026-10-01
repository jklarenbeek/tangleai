import { createWebLane, createReplayWebTransport, type WebLaneOptions, type WebReplayRecord, loadGroundingProfile, createMemoryGroundingStore, planSessionTransition, type GroundingProfile, type GroundingSession, type GroundingStore, type EvidenceCandidate, type GroundedAnswer } from '@tangleai/grounding';
import type { GroundingIssue } from '@tangleai/grounding/contracts';
import profile from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };
import schema from '@tangleai/grounding/schemas/grounding' with { type: 'json' };
import { createGroundingStore, type TangleDb } from '@tangleai/store';
declare const session: GroundingSession, db: TangleDb, answer: GroundedAnswer;
const store: GroundingStore = createMemoryGroundingStore();
const durable: GroundingStore = createGroundingStore(db);
const validated = await loadGroundingProfile(profile);
if (validated.valid) { const typed: GroundingProfile = validated.value; await store.putProfile(typed); }
await durable.putAnswer(answer, session.revision);
planSessionTransition(session, { kind: 'refresh', reason: 'Explicit refresh.' });
// @ts-expect-error a refresh requires its reason
planSessionTransition(session, { kind: 'refresh' });
// @ts-expect-error unsupported issue codes cannot enter a closed grounding record
const bad: GroundingIssue = { code: 'invented', path: '', detail: 'Wrong.' };
// @ts-expect-error a discovery snippet is not an evidence lane
const lane: EvidenceCandidate['lane'] = 'snippet';
void [schema, bad, lane];

declare const webOptions: WebLaneOptions, records: WebReplayRecord[];
const transport = await createReplayWebTransport(records, { searxBase: "https://search.example" });
const webResult = await createWebLane({ ...webOptions, transport }).retrieve(session, "atomic-query");
if (webResult.ok) { const candidates: EvidenceCandidate[] = webResult.candidates; await durable.putWebResult(webResult.run, candidates); }

import { reconcileEvidence, generateGroundedClaims, repairPrihaClaims, renderPrihaAnswer, type GenerateGroundedClaimsOptions, type PrihaAnswer, type ClaimValidationView } from '@tangleai/grounding';
declare const answerOptions: GenerateGroundedClaimsOptions, draft: PrihaAnswer, view: ClaimValidationView;
const reconciled = await reconcileEvidence(answerOptions.profile, answerOptions.admitted, { sessionId: session.id, now: '2026-06-01T00:00:00.000Z', facts: {} });
const generated = await generateGroundedClaims({ ...answerOptions, ...reconciled });
if (generated.ok) renderPrihaAnswer(generated.answer);
await repairPrihaClaims(draft, view, [{ op: 'remove', path: '/claims/0' }]);
// @ts-expect-error a confidence field is outside the grounded draft contract
const guessed: PrihaAnswer = { disposition: 'abstain', claims: [], reason: 'No source.', confidence: 1 };
void guessed;

import { createGroundingHost, createGroundingReader, createGroundingWorkflow, type GroundingHostOptions, type GroundingReply, type GroundingEvidenceView } from '@tangleai/grounding';
import { createGroundingSegmentHost } from '@tangleai/store';
import { selectGroundingContext } from '@tangleai/grounding';
const selection = selectGroundingContext(answerOptions.admitted, answerOptions.profile.budgets.contextTokens);
const omitted: readonly string[] = selection.omittedEvidenceIds;
void omitted;
declare const hostOptions: GroundingHostOptions;
const host = await createGroundingHost(hostOptions);
const reply: GroundingReply = await host.start({ text: 'Where is reception?', conversationId: 'consumer' });
const evidence: GroundingEvidenceView = await host.evidence(reply.sessionId);
await host.respond(reply.sessionId, 'interaction', { answers: { q1: 'Reception' } });
await host.refresh(reply.sessionId, 'Explicit new run');
const segments = createGroundingSegmentHost(db, { now: () => '2026-06-01T00:00:00.000Z', jobClock: () => 1000, deadlineFor: () => '2026-06-02T00:00:00.000Z' });
await createGroundingReader({ store, mas: segments.store }).list();
await createGroundingWorkflow({ profile: hostOptions.profile, caseId: 'consumer', factVocabulary: [], currentOptimization: async () => { throw Error('No intent during compilation'); } });
// @ts-expect-error a refresh requires an explicit reason
await host.refresh(reply.sessionId);
void evidence;
