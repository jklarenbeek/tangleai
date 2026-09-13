import { validateTemporalShape } from '@tangleai/core/schemas/temporal';
import type { TemporalQuery, SourceOccurrence, ClaimTime, TemporalAnswer } from '@tangleai/core/schemas/temporal';
import { prepareTemporal, answerTemporal, renderTemporalAnswer, createTemporalMemoryStore, type PrepareTemporalInput, type TemporalStore } from '@tangleai/memory/temporal';
import { createTemporalDbStore, selectTemporalDbAsOf, type TangleDb } from '@tangleai/store';
declare const input: PrepareTemporalInput, query: TemporalQuery, source: SourceOccurrence, db: TangleDb;
const store: TemporalStore = createTemporalDbStore(db);
await prepareTemporal(input, { store });
const result = await answerTemporal(createTemporalMemoryStore(), query);
if (result.status === 'success') { const answer: TemporalAnswer = result.value; const rendered: string = renderTemporalAnswer(answer); void rendered; }
else { const count: number | undefined = result.coverage?.refusals[result.reason]; void count; }
validateTemporalShape('sourceOccurrence', source);
await selectTemporalDbAsOf(db, { kind: 'claim-asof', scope: query.scope, versionId: 'version', subject: 'alex', series: 'address', at: 0, limit: 100 });
// @ts-expect-error uncertain state ends are closed tagged values
const invalid: ClaimTime = { kind: 'state', from: '2024-01-01T00:00:00Z', until: null, precision: 'day' };
// @ts-expect-error the deterministic answer requires a complete scoped temporal query
await answerTemporal(store, { text: 'yesterday' });
void invalid;
