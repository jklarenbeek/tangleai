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
