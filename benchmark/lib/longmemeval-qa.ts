/** Injected measured QA path; evaluator annotations are used only after runtime selection. */
import { createChatClient } from '@tangleai/models/client';
import assert from 'node:assert/strict';
import { createStructuredOutput } from '@tangleai/models/structured';
import { createTemporalMemoryStore, prepareTemporal, proposeTemporalQuery, createTemporalProjection, temporalValue, temporalStamp, type TemporalClaim, type TemporalQuery, type TemporalModel } from '@tangleai/memory/temporal';
import { longMemEvalViews, type LmeRawQuestion } from './longmemeval.ts';
import { runTemporalMatrix, temporalMatrixInput, temporalOracleRows, type TemporalMatrixRow } from './temporal-experiment.ts';
import { temporalSourceChunks, verifyTemporalPlan, planTemporalPurchases, type TemporalPurchasePlan, type temporalPurchaseTransport } from './temporal-live.ts';
import { longMemEvalJudgePrompt, longMemEvalRetrieval, scoreLongMemEval } from './longmemeval-scoring.ts';
import { TEMPORAL_ROWS } from './temporal-registration.ts';
import { ANSWER_SCHEMA, ANSWER_SYSTEM_PROMPT, type AnswerValue } from './locomo-qa.ts';
import { sha256 } from './longmemeval-source.ts';

export interface TemporalQaQuestion {
  id: string; profile: 'provided-history' | 'strict-as-of'; type: LmeRawQuestion['question_type']; abstention: boolean;
  row: typeof TEMPORAL_ROWS[number]; status: 'measured' | 'failed' | 'unmeasured'; reason: string | null; fallback: string | null;
  answer: string | null; judgeReply: string | null; contextHash: string | null; selectedIds: string[]; citedIds: string[];
  retrieval: ReturnType<typeof longMemEvalRetrieval> | null;
}
/** Replies contain source/model text: persist this result only in the ignored run directory. */
export async function executeLongMemEvalQa(rawRows: readonly LmeRawQuestion[], plan: TemporalPurchasePlan, transport: ReturnType<typeof temporalPurchaseTransport>) {
  verifyTemporalPlan(plan);
  assert.equal((await planTemporalPurchases(rawRows, plan.locomoIds, plan.sourceIdentity, plan.models)).sha256, plan.sha256, 'source workload differs from purchase plan');
  const rows: TemporalQaQuestion[] = [];
  for (const raw of rawRows) for (const profile of ['provided-history', 'strict-as-of'] as const) {
    const { runtime, evaluator } = longMemEvalViews(raw, profile), input = await temporalMatrixInput(runtime);
    const jobs = plan.jobs.filter(j => j.scope === runtime.scope && j.profile === profile);
    const route = (role: 'extract' | 'resolve' | 'answer' | 'judge', row: string, ordinal = 0) => {
      const selected = jobs.filter(j => j.role === role && j.row === row && j.ordinal === ordinal); let attempt = 0;
      return ((url, init) => { const job = selected[attempt++]; if (!job) throw Error('unplanned role, repair or question'); return transport.forJob(job.id)(url, init); }) as typeof fetch;
    };
    const model = (role: 'extract' | 'resolve' | 'answer' | 'judge'): TemporalModel => {
      const config = plan.models[role]; if (!config) throw Error('unconfigured model');
      return { provider: 'custom', baseUrl: config.endpoint.replace(/\/chat\/completions$/, ''), model: config.model, identity: config.metadataIdentity };
    };
    const store = createTemporalMemoryStore();
    const limits = { maxInputTokens: plan.limits.inputBytes, maxOutputTokens: plan.limits.outputTokens, maxPhysicalRequests: 2, maxSources: 32, maxClaims: 512, concurrency: 1, deadlineMs: plan.limits.deadlineMs, maxRepairs: 1 };
    let preparationFailure: string | null = null, resolved: TemporalQuery | undefined;
    try {
      const claims: TemporalClaim[] = [];
      for (const [ordinal, sources] of temporalSourceChunks(input.sources).entries()) {
        const batch = createTemporalMemoryStore();
        temporalValue(await prepareTemporal({ scope: runtime.scope, key: `extract:${ordinal}`, sources, sourceIdentity: runtime.viewId, knowledge: input.knowledge,
          policyIdentity: plan.sha256, expectedHead: null, embeddedBy: { model: 'hash-trigram-512', dims: 512 }, limits, embeddings: sources.map(s => ({ sourceId: s.id, vector: input.vectors.get(s.id)! })) },
        { store: batch, model: model('extract'), fetch: route('extract', 'shared', ordinal) }));
        claims.push(...temporalValue(await batch.snapshot(runtime.scope)).claims);
      }
      const bundle = temporalValue(await createTemporalProjection({ scope: runtime.scope, sources: input.sources, claims, knowledge: input.knowledge,
        sourceIdentity: runtime.viewId, viewIdentity: runtime.viewId, policyIdentity: plan.sha256, modelIdentity: model('extract').identity, promptIdentity: plan.promptIdentity,
        embeddedBy: { model: 'hash-trigram-512', dims: 512 }, embeddings: [...input.vectors].map(([sourceId, vector]) => ({ sourceId, vector })), complete: true }));
      const head = temporalValue(await store.apply(bundle, { key: 'complete', expectedHead: null })).head;
      const anchor = temporalValue(temporalStamp(runtime.anchor.at, { raw: runtime.anchor.raw, precision: 'minute', provenance: 'synthetic-UTC', offsetMinutes: 0 }));
      const proposal = await proposeTemporalQuery({ scope: runtime.scope, key: 'resolve', text: runtime.question, anchor, limits, clockIdentity: 'synthetic-UTC' },
        { store, model: model('resolve'), fetch: route('resolve', 'shared') });
      if (proposal.status !== 'success') preparationFailure = proposal.reason;
      else resolved = { scope: runtime.scope, text: runtime.question, anchor, knowledge: input.knowledge, ...proposal.value,
        embeddedBy: { model: 'hash-trigram-512', dims: 512 }, embedding: input.embedding, candidatePool: 100, k: 10, minScore: 0, expectedHead: head };
    } catch (cause) { preparationFailure = String(cause); }
    const matrixInput = resolved ? { ...input, store, query: resolved } : input;
    const matrix = [...await runTemporalMatrix(matrixInput), ...await temporalOracleRows(matrixInput, evaluator)];
    const matched = matrix.find(r => r.row === 'matched-pool-lane-off')!;
    for (const selected of matrix) {
      const record: TemporalQaQuestion = { id: runtime.scope, profile, type: evaluator.type, abstention: evaluator.abstention, row: selected.row, status: 'unmeasured', reason: null,
        fallback: null, answer: null, judgeReply: null, contextHash: null, selectedIds: [], citedIds: [], retrieval: null };
      if (selected.row === 'oracle-window') { record.reason = selected.reason; rows.push(record); continue; }
      // A real temporal refusal is visible even when the host chooses ordinary evidence.
      const treatment = ['observed-session-filter', 'validity-asof-on', 'full-kernel'].includes(selected.row);
      const context: TemporalMatrixRow = treatment && selected.status !== 'measured' ? matched : selected;
      record.fallback = context === matched && treatment ? preparationFailure ?? selected.reason : null;
      record.contextHash = sha256(context.context); record.selectedIds = context.selectedIds;
      record.retrieval = longMemEvalRetrieval(evaluator, context.selectedIds);
      try {
        const client = createChatClient({ ...model('answer'), retry: { attempts: 1 }, maxTokens: 512, fetch: route('answer', selected.row) });
        const answer = await createStructuredOutput({ client: { ...client, complete: request => client.complete({ ...request, temperature: 0 }) }, schema: ANSWER_SCHEMA, maxRepairs: 1 }).generate([
          { role: 'system', content: `${ANSWER_SYSTEM_PROMPT}\n\nMEMORIES:\n${context.context}` }, { role: 'user', content: `Question: ${runtime.question}` }]);
        if (answer.errors) throw Error('invalid answer after bounded repair');
        const value = answer.value as AnswerValue;
        const allowed = new Set(input.sources.filter(s => context.selectedIds.includes(input.runtimeIds[s.id])).map(s => s.id));
        if (value.citations.some(id => !allowed.has(id))) throw Error('answer cites evidence outside its actual context');
        record.answer = value.answer; record.citedIds = value.citations.map(id => input.runtimeIds[id]);
        const judge = createChatClient({ ...model('judge'), retry: { attempts: 1 }, maxTokens: 10, fetch: route('judge', selected.row) });
        const reply = await judge.complete({ messages: [{ role: 'user', content: longMemEvalJudgePrompt(evaluator.type, runtime.question, evaluator.answer, value.answer, evaluator.abstention) }], temperature: 0 });
        record.judgeReply = reply.message.content; record.status = 'measured';
      } catch (cause) { record.status = 'failed'; record.reason = String(cause); }
      rows.push(record);
    }
  }
  return { rows, transport: transport.stats(), scores: (['provided-history', 'strict-as-of'] as const).flatMap(profile => TEMPORAL_ROWS.map(row => ({ profile, row,
    score: row === 'oracle-window' ? null : scoreLongMemEval(rows.filter(r => r.profile === profile && r.row === row).map(r => ({ id: r.id, type: r.type, abstention: r.abstention, response: r.judgeReply }))) }))) };
}
