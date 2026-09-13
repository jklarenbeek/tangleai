/** Matched runtime selectors. Gold enters only the explicitly separate evaluator ceiling. */
import assert from 'node:assert/strict';
import { cosineSimilarity } from '@jarenjs/core/vector';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createHashEmbedder } from '@tangleai/models/embed';
import { createMemoryUnit, recallByEmbedding } from '@tangleai/memory';
import { answerTemporal, recallTemporal, temporalInstant, temporalValue, createTemporalSessionIndex, type TemporalStore, type TemporalQuery, type SourceOccurrence, type Knowledge } from '@tangleai/memory/temporal';
import { longMemEvalViews, validateLmeRuntime, LME_TYPES, type LmeRuntimeQuestion, type LmeEvaluatorQuestion, type LmeRawQuestion } from './longmemeval.ts';
import { materializeLongMemEval } from './longmemeval-runtime.ts';
import { longMemEvalRetrieval } from './longmemeval-scoring.ts';
import { TEMPORAL_CONTROLS, TEMPORAL_ROWS, registerTemporal, type TemporalRow } from './temporal-registration.ts';
import { sha256 } from './longmemeval-source.ts';

/** UTF-8 bytes conservatively bound text tokens; no tokenizer-specific token count is claimed. */
export const TEMPORAL_CONTEXT_BYTES = 12000;
export interface TemporalMatrixInput {
  runtime: LmeRuntimeQuestion; sources: SourceOccurrence[]; runtimeIds: Record<string, string>;
  knowledge: Knowledge;
  vectors: Map<string, number[]>; embedding: number[]; contextBytes: number;
  store?: TemporalStore; query?: TemporalQuery;
}
export interface TemporalMatrixRow {
  row: TemporalRow; status: 'measured' | 'unmeasured' | 'refused' | 'fallback'; reason: string | null;
  selectedIds: string[]; poolIds: string[]; context: string; bytes: number; trimmed: number; kernel: string | null;
}
const digest = (value: unknown) => sha256(canonicalizeJson(value));
function pool(input: TemporalMatrixInput) {
  return input.sources.map(source => ({ source, score: cosineSimilarity(input.vectors.get(source.id)!, input.embedding) }))
    .filter(r => r.score >= TEMPORAL_CONTROLS.minScore).sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id)).slice(0, TEMPORAL_CONTROLS.candidatePool).map(r => r.source);
}
export async function validateTemporalMatrixInput(input: TemporalMatrixInput): Promise<void> {
  assert.ok(validateLmeRuntime(input.runtime), 'runtime view is invalid or contains evaluator data');
  const expected = await materializeLongMemEval(input.runtime);
  assert.deepEqual(input.knowledge, expected.knowledge);
  assert.deepEqual(input.sources, expected.sources, 'source view changed'); assert.deepEqual(input.runtimeIds, expected.runtimeIds, 'occurrence mapping changed');
  assert.ok(Number.isSafeInteger(input.contextBytes) && input.contextBytes > 0 && input.contextBytes <= TEMPORAL_CONTEXT_BYTES, 'context ceiling changed');
  assert.equal(input.embedding.length, TEMPORAL_CONTROLS.embedder.dims); assert.ok(input.embedding.every(Number.isFinite));
  assert.equal(input.vectors.size, input.sources.length, 'embedding coverage changed');
  for (const s of input.sources) { const v = input.vectors.get(s.id); assert.ok(v && v.length === TEMPORAL_CONTROLS.embedder.dims && v.every(Number.isFinite), 'source vector missing or invalid'); }
  if (input.query) {
    const q = input.query;
    assert.equal(q.scope, input.runtime.scope); assert.equal(q.text, input.runtime.question);
    assert.deepEqual(q.knowledge, expected.knowledge); assert.deepEqual(q.embeddedBy, TEMPORAL_CONTROLS.embedder);
    assert.deepEqual(q.embedding, input.embedding); assert.equal(q.candidatePool, TEMPORAL_CONTROLS.candidatePool); assert.equal(q.k, TEMPORAL_CONTROLS.outputK); assert.equal(q.minScore, TEMPORAL_CONTROLS.minScore);
    assert.equal(q.anchor?.at, input.runtime.anchor.at, 'query anchor changed');
  }
  if (input.store) {
    const snapshot = temporalValue(await input.store.snapshot(input.runtime.scope, input.query?.expectedHead ?? undefined));
    assert.equal(digest([...snapshot.sources].sort((a,b)=>a.id.localeCompare(b.id))), digest([...input.sources].sort((a,b)=>a.id.localeCompare(b.id))), 'prepared source view changed');
    assert.deepEqual(snapshot.projection.embeddedBy, TEMPORAL_CONTROLS.embedder);
    assert.deepEqual(snapshot.projection.knowledge, expected.knowledge);
    assert.equal(digest(snapshot.projection.embeddings.map(e=>[e.sourceId,e.vector]).sort()), digest([...input.vectors].sort()), 'prepared embedding pool changed');
  }
}
function contextRow(input: TemporalMatrixInput, row: TemporalRow, selected: SourceOccurrence[], poolIds: string[], kernel: string | null = null): TemporalMatrixRow {
  const kept: SourceOccurrence[] = []; let context = kernel === null ? '' : `Temporal result: ${kernel}\n`;
  let trimmed = 0;
  for (const s of selected) {
    const item = row === 'legacy-default' ? `[${s.id}] ${s.text}\n` : `[${s.id}] ${s.role}; observed ${s.observedAt.raw}; ${s.observedAt.precision}; ${s.observedAt.provenance}\n${s.text}\n`;
    if (Buffer.byteLength(context + item, 'utf8') > input.contextBytes) { trimmed++; continue; }
    context += item; kept.push(s);
  }
  // A computed value cannot survive without every source its citations require.
  if (kernel !== null && (trimmed > 0 || Buffer.byteLength(context) > input.contextBytes)) return { row, status: 'refused', reason: 'context-budget', selectedIds: [], poolIds, context: '', bytes: 0, trimmed: selected.length, kernel: null };
  return { row, status: 'measured', reason: null, selectedIds: kept.map(s => input.runtimeIds[s.id]), poolIds, context, bytes: Buffer.byteLength(context), trimmed, kernel };
}
function unavailable(row: TemporalRow, poolIds: string[], reason: string, status: TemporalMatrixRow['status'] = 'unmeasured'): TemporalMatrixRow {
  return { row, status, reason, selectedIds: [], poolIds, context: '', bytes: 0, trimmed: 0, kernel: null };
}
/** Inputs are validated once at the batch boundary, before any selector or store call. */
export async function runTemporalMatrix(input: TemporalMatrixInput): Promise<TemporalMatrixRow[]> {
  await validateTemporalMatrixInput(input);
  const semantic = pool(input), poolIds = semantic.map(s => input.runtimeIds[s.id]);
  // The ordinary store is text-keyed, last write wins. Empty turns are preserved
  // as occurrences but cannot become ordinary nonempty memory units.
  const legacy = new Map<string, { unit: ReturnType<typeof createMemoryUnit>; source: SourceOccurrence }>();
  for (const s of input.sources.filter(s => s.text.length > 0)) {
    const unit = createMemoryUnit({ text: s.text, evidence: s.sourceLocator, at: s.observedAt.at, embedding: input.vectors.get(s.id)!, embeddedBy: TEMPORAL_CONTROLS.embedder });
    legacy.set(unit.id, { unit, source: s });
  }
  const selected = recallByEmbedding([...legacy.values()].map(r => r.unit), input.embedding, { k: 10, minScore: 0, identity: TEMPORAL_CONTROLS.embedder }).ranked.map(r => legacy.get(r.unit.id)!.source);
  const legacyRow = contextRow(input, 'legacy-default', selected, selected.map(s => input.runtimeIds[s.id]));
  // Timestamp metadata changes the context budget visibly, but never re-ranks.
  const rows = [legacyRow, contextRow(input, 'timestamp-context-only', selected, legacyRow.poolIds), contextRow(input, 'matched-pool-lane-off', semantic.slice(0, 10), poolIds)];
  for (const row of ['observed-session-filter', 'validity-asof-on', 'full-kernel'] as const) {
    if (!input.query || !input.store) { rows.push(unavailable(row, poolIds, 'model-derived-query-and-claims-unmeasured')); continue; }
    const operation = input.query.operation;
    if (row === 'observed-session-filter') {
      const index = temporalValue(await createTemporalSessionIndex(input.store).get(input.runtime.scope));
      const epoch = (s: string) => temporalValue(temporalInstant(s));
      const ids = operation.kind === 'at' || operation.kind === 'as-of' ? index.at(epoch(operation.at)) : operation.kind === 'overlaps' ? index.overlaps(epoch(operation.from), epoch(operation.until)) : null;
      rows.push(ids ? contextRow(input, row, semantic.filter(s => ids.includes(s.id)).slice(0, 10), poolIds) : unavailable(row, poolIds, 'operation-has-no-observed-window', 'fallback')); continue;
    }
    const result = row === 'full-kernel' ? await answerTemporal(input.store, input.query) : await recallTemporal(input.store, input.query);
    if (result.status !== 'success') { rows.push(unavailable(row, poolIds, result.reason, result.status)); continue; }
    const value = result.value, recall = 'recall' in value ? value.recall : value;
    assert.ok(recall.sources.every(s => poolIds.includes(input.runtimeIds[s.id])), 'treatment used evidence outside matched pool');
    assert.equal(recall.coverage.semanticCandidates, poolIds.length, 'treatment candidate count differs');
    rows.push(contextRow(input, row, recall.sources, poolIds, 'recall' in value ? canonicalizeJson({ value: value.value, citations: value.citations, rule: value.rule }) : null));
  }
  return rows;
}
/** Evaluator-only, explicitly labelled ceilings. Never feed these results to treatment preparation. */
export async function temporalOracleRows(input: TemporalMatrixInput, evaluator: LmeEvaluatorQuestion, certifiedWindow?: TemporalQuery): Promise<TemporalMatrixRow[]> {
  assert.equal(evaluator.scope, input.runtime.scope);
  const gold = new Set(evaluator.goldSessionIds);
  const annotated = new Set(evaluator.annotatedTurnIds);
  const candidates = input.sources.filter(s => gold.has(evaluator.occurrenceSessions[input.runtimeIds[s.id]]))
    .sort((a, b) => Number(annotated.has(input.runtimeIds[b.id])) - Number(annotated.has(input.runtimeIds[a.id])) || Buffer.byteLength(a.text) - Buffer.byteLength(b.text) || a.id.localeCompare(b.id));
  const representatives = [...gold].flatMap(id => { const source = candidates.find(s => evaluator.occurrenceSessions[input.runtimeIds[s.id]] === id); return source ? [source] : []; });
  const evidence = [...new Map([...representatives, ...candidates].map(s => [s.id, s])).values()].slice(0, 10);
  const ceiling = contextRow(input, 'oracle-evidence', evidence, []);
  const window = certifiedWindow ? (await runTemporalMatrix({ ...input, query: certifiedWindow })).find(r => r.row === 'full-kernel')! : unavailable('oracle-window', [], 'independently-certified-window-unavailable');
  return [ceiling, { ...window, row: 'oracle-window' }];
}
export async function temporalMatrixInput(runtime: LmeRuntimeQuestion): Promise<TemporalMatrixInput> {
  const materialized = await materializeLongMemEval(runtime), embedder = createHashEmbedder({ dims: 512 });
  const vectors = await embedder.embed([runtime.question, ...materialized.sources.map(s => s.text)]);
  return { runtime, ...materialized, embedding: [...vectors[0]], vectors: new Map(materialized.sources.map((s, i) => [s.id, [...vectors[i + 1]]])), contextBytes: TEMPORAL_CONTEXT_BYTES };
}
export interface TemporalKeylessQuestion {
  id: string; group: string; fold: 'development' | 'confirmation'; type: typeof LME_TYPES[number]; abstention: boolean; profile: LmeRuntimeQuestion['profile'];
  occurrences: number; emptyTurns: number; futureGold: boolean; viewIdentity: string;
  rows: Array<Omit<TemporalMatrixRow, 'context' | 'kernel'> & { contextHash: string; retrieval: ReturnType<typeof longMemEvalRetrieval> | null }>;
}
export async function runTemporalKeyless(rows: readonly LmeRawQuestion[], locomoIds: string[], progress?: (count: number) => void) {
  const registration = registerTemporal(rows, locomoIds), questions: TemporalKeylessQuestion[] = [];
  const groups = new Map(registration.groups.flatMap(g => g.members.map(id => [id, g.id] as const))), dev = new Set(registration.folds[0].members);
  for (const [i, raw] of rows.entries()) {
    for (const profile of ['provided-history', 'strict-as-of'] as const) {
      const { runtime, evaluator } = longMemEvalViews(raw, profile), input = await temporalMatrixInput(runtime);
      const matrix = [...await runTemporalMatrix(input), ...await temporalOracleRows(input, evaluator)];
      assert.deepEqual(matrix.map(r => r.row), TEMPORAL_ROWS);
      questions.push({ id: runtime.scope, group: groups.get(runtime.scope)!, fold: dev.has(runtime.scope) ? 'development' : 'confirmation', type: evaluator.type, abstention: evaluator.abstention,
        profile, occurrences: runtime.occurrences.length, emptyTurns: runtime.occurrences.filter(o => !o.text.length).length, futureGold: evaluator.sessions.some(s => s.future && evaluator.goldSessionIds.includes(s.sourceId)), viewIdentity: runtime.viewId,
        rows: matrix.map(({ context, kernel: _kernel, ...r }) => ({ ...r, contextHash: sha256(context), retrieval: r.status === 'unmeasured' ? null : longMemEvalRetrieval(evaluator, r.selectedIds) })) });
    }
    progress?.(i + 1);
  }
  return { registrationHash: registration.sha256, questions, physicalRequests: 0 as const, quality: 'unmeasured' as const };
}
