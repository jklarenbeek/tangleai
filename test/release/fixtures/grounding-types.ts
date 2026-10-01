import { loadGroundingProfile, createMemoryGroundingStore, planSessionTransition, type GroundingProfile, type GroundingSession, type GroundingStore, type EvidenceCandidate, type GroundedAnswer } from '@tangleai/grounding';
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
