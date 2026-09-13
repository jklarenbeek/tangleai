import { createTemporalMemoryStore, createSourceOccurrence, createTemporalClaim, temporalStamp, temporalValue, citeSource,
  prepareTemporal, answerTemporal, renderTemporalAnswer, resolveTemporalWindow } from '@tangleai/memory/temporal';
import { createMemoryUnit, recallByEmbedding } from '@tangleai/memory';
import { validateTemporalShape } from '@tangleai/core/schemas/temporal';

const ensure = (condition, message) => { if (!condition) throw Error(message); };
export async function qualifyTemporal(store = createTemporalMemoryStore()) {
  const scope = 'installed-temporal', embeddedBy = { model: 'installed-2', dims: 2 };
  const authored = [
    ['Alex lives on Elm from January 1 onward.', '2024-01-01T00:00:00Z', 'address', 'Elm'],
    ['Alex lives on Elm from January 1 onward.', '2024-01-02T00:00:00Z', 'address', 'Elm'],
    ['Alex once lived by the river; dates unknown.', '2024-01-03T00:00:00Z', 'older-address', 'river'],
    ['Alex lives on Oak from April 1 onward.', '2024-04-01T00:00:00Z', 'address', 'Oak'],
  ];
  const sources = [], claims = [];
  for (const [sessionOrdinal, [text, at, key, value]] of authored.entries()) {
    const source = temporalValue(await createSourceOccurrence({ scope, sessionOrdinal, turnOrdinal: 0, role: 'host', text,
      sourceLocator: `installed:${sessionOrdinal}`, observedAt: temporalValue(temporalStamp(at)), knownAt: at }));
    sources.push(source);
    const time = key === 'older-address' ? { kind: 'unknown' } : { kind: 'state',
      from: value === 'Elm' ? '2024-01-01T00:00:00Z' : at, until: { kind: 'open' }, precision: 'day' };
    claims.push(temporalValue(await createTemporalClaim({ scope, series: { subject: 'alex', key }, value, time,
      status: time.kind === 'unknown' ? 'unknown' : 'accepted', citations: [temporalValue(citeSource(source))],
      derivation: { method: 'host-asserted', identity: 'installed-example' } }, [source])));
  }
  ensure(sources[0].id !== sources[1].id && sources[0].sourceHash === sources[1].sourceHash, 'occurrences must retain equal-text evidence');
  ensure(validateTemporalShape('sourceOccurrence', sources[0]).valid, 'public source contract');
  const input = { scope, key: 'prepare', sources, claims, knowledge: { mode: 'strict-as-of', cutoff: '2024-03-01T00:00:00Z' },
    expectedHead: null, sourceIdentity: 'installed-sources', policyIdentity: 'installed-policy', embeddedBy,
    embeddings: sources.map(source => ({ sourceId: source.id, vector: [1, 0] })),
    limits: { maxInputTokens: 1000, maxOutputTokens: 100, maxPhysicalRequests: 0, maxSources: 4, maxClaims: 4, concurrency: 1, deadlineMs: 1000, maxRepairs: 0 } };
  const before = store.stats().writes, receipt = temporalValue(await prepareTemporal(input, { store }));
  if (receipt.replayed) ensure(receipt.writes === 0 && store.stats().writes === before, 'reopen replay must not write');
  const query = { scope, text: 'Where did Alex live on January 15?', anchor: null, knowledge: input.knowledge,
    operation: { kind: 'as-of', at: '2024-01-15T00:00:00Z' }, subject: 'alex', series: 'address',
    embeddedBy, embedding: [1, 0], candidatePool: 100, k: 10, minScore: 0, expectedHead: receipt.head };
  const answer = temporalValue(await answerTemporal(store, query));
  ensure(answer.recall.claims.length === 2 && answer.recall.claims.every(c => c.value === 'Elm'), 'historical duplicate evidence');
  ensure(answer.citations.length === 2 && answer.citations.every(c => sources.some(s => s.id === c.sourceId && s.text.slice(c.start, c.end) === c.quote)), 'verified public citations');
  ensure(temporalValue(await store.snapshot(scope)).sources.length === 3, 'strict cutoff retains exactly permitted occurrences');
  ensure(temporalValue(await store.occurrence(scope, sources[3].id)) === null, 'future occurrence is not persisted');
  const unknown = await answerTemporal(store, { ...query, series: 'older-address' });
  ensure(unknown.status === 'refused' && unknown.reason === 'unknown-validity', 'unknown validity refuses');
  const foreignView = await answerTemporal(store, { ...query, knowledge: { mode: 'provided-history' } });
  ensure(foreignView.status === 'refused' && foreignView.reason === 'identity-mismatch', 'knowledge views cannot share claims');
  const relative = resolveTemporalWindow('yesterday');
  ensure(relative.status === 'refused' && relative.reason === 'unanchored-relative', 'relative query requires host anchor');
  const ordinary = createMemoryUnit({ text: sources[0].text, evidence: 'installed:ordinary', at: sources[0].knownAt, embedding: [1, 0], embeddedBy });
  ensure(recallByEmbedding([ordinary], [1, 0], { identity: embeddedBy }).ranked.length === 1, 'ordinary recall remains compatible');
  return { answer, rendered: renderTemporalAnswer(answer), replayed: receipt.replayed, replayWrites: receipt.replayed ? receipt.writes : null, occurrences: 3, citations: 2 };
}
