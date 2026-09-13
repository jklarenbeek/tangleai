/** Cited deterministic answers; model-generated arithmetic is never an authority. */
import { sameTemporalValue, refuse, success, type TemporalResult, type TemporalAnswer, type TemporalClaim, type TemporalQuery, type TemporalRecall } from './contracts.ts';
import { temporalInstant, temporalElapsed } from './time.ts';
import { recallTemporal } from './retrieval.ts';
import type { TemporalStore } from './store.ts';
function uniquePoint(claims: TemporalClaim[], unit: string): TemporalResult<{ at: string; claims: TemporalClaim[] }> {
  if (!claims.length) return refuse('no-match', 'elapsed operand has no evidenced event');
  const instants = new Map<number, string>();
  for (const claim of claims) {
    if (claim.time.kind !== 'point' || (unit === 'hour' && claim.time.precision !== 'millisecond')) return refuse('unknown-validity', 'exact arithmetic needs sufficiently precise event operands');
    const epoch = temporalInstant(claim.time.at); if (epoch.status !== 'success') return epoch;
    instants.set(epoch.value, claim.time.at);
  }
  if (instants.size !== 1) return refuse('ambiguous-series', 'operand series contains multiple evidenced event times');
  return success({ at: [...instants.values()][0], claims });
}
function computeTemporalAnswer(recall: TemporalRecall, query: TemporalQuery): TemporalResult<TemporalAnswer> {
  const operation = query.operation;
  const citations = [...new Map(recall.claims.flatMap(c => c.citations).map(c => [JSON.stringify(c), c])).values()];
  if (operation.kind === 'none') return { status: 'fallback', reason: 'ordinary-query', detail: 'ordinary query has no temporal kernel answer' };
  if (operation.kind === 'elapsed') {
    const from = uniquePoint(recall.claims.filter(c => sameTemporalValue(c.series, operation.fromSeries)), operation.unit);
    const to = uniquePoint(recall.claims.filter(c => sameTemporalValue(c.series, operation.toSeries)), operation.unit);
    if (from.status !== 'success') return from; if (to.status !== 'success') return to;
    const elapsed = temporalElapsed(from.value.at, to.value.at, operation.unit, query.anchor?.offsetMinutes);
    if (elapsed.status !== 'success') return elapsed;
    return success({ recall, operation: 'elapsed', value: { ...elapsed.value }, citations,
      rule: 'Hours are elapsed instants; days/weeks count civil dates; months/years use Jaren anchored calendar clamping with civil-day remainder.' });
  }
  if (operation.kind === 'order') {
    const ordered: { claim: TemporalClaim; epoch: number }[] = [];
    for (const claim of recall.claims) {
      if (claim.time.kind !== 'point' || claim.time.precision !== 'millisecond') return refuse('unknown-validity', 'exact event ordering requires exact instant precision');
      const at = temporalInstant(claim.time.at); if (at.status !== 'success') return at;
      ordered.push({ claim, epoch: at.value });
    }
    ordered.sort((a, b) => a.epoch - b.epoch || a.claim.id.localeCompare(b.claim.id));
    return success({ recall, operation: 'order', value: ordered.map(r => ({ claimId: r.claim.id, at: r.epoch, value: r.claim.value })), citations, rule: 'Ascending exact instants; equal instants retain a deterministic claim-ID tie order.' });
  }
  return success({ recall, operation: operation.kind, value: recall.claims.map(c => ({ claimId: c.id, value: c.value })), citations,
    rule: operation.kind === 'overlaps' ? 'Half-open overlap; uncertain event buckets must fit wholly within the query.' : 'Half-open validity membership, after knowledge and semantic candidate filtering.' });
}
export async function answerTemporal(store: TemporalStore, query: TemporalQuery): Promise<TemporalResult<TemporalAnswer>> {
  const recall = await recallTemporal(store, query);
  if (recall.status !== 'success') return recall;
  const answer = computeTemporalAnswer(recall.value, query);
  if (answer.status !== 'success') {
    const failure = answer.reason === 'no-match' && !recall.value.coverage.complete ? refuse('incomplete-index', 'bounded evidence cannot establish a missing arithmetic operand') : answer;
    return { ...failure, coverage: { ...recall.value.coverage, refusals: { [failure.reason]: 1 } } };
  }
  return answer;
}
