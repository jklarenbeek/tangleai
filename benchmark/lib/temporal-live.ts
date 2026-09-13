/** Exact planned purchases and durable transport receipts; injected hosts own approval and persistence. */
import assert from 'node:assert/strict';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { temporalSchema } from '@tangleai/core/schemas/temporal';
import { TEMPORAL_EXTRACTION_PROMPT, TEMPORAL_RESOLUTION_PROMPT } from '@tangleai/memory/temporal';
import { materializeLongMemEval } from './longmemeval-runtime.ts';
import { longMemEvalViews, type LmeRawQuestion, type LmeRuntimeQuestion } from './longmemeval.ts';
import { TEMPORAL_ROWS, registerTemporal, type TemporalRow } from './temporal-registration.ts';
import { TEMPORAL_CONTEXT_BYTES } from './temporal-experiment.ts';
import { LONGMEMEVAL_JUDGE, longMemEvalJudgePrompt } from './longmemeval-scoring.ts';
import { ANSWER_SCHEMA, ANSWER_SYSTEM_PROMPT } from './locomo-qa.ts';
import { sha256 } from './longmemeval-source.ts';

export const TEMPORAL_PLAN_LIMITS = { sourceChunkBytes: 96000, sourceChunkItems: 32, inputBytes: 262144, outputTokens: 4096,
  contextBytes: TEMPORAL_CONTEXT_BYTES, repairs: 1, httpAttempts: 1, deadlineMs: 120000, concurrency: 4 } as const;
export type TemporalPurchaseRole = 'extract' | 'resolve' | 'answer' | 'judge' | 'embedding';
export interface TemporalRoleModel { endpoint: string; model: string; inputUsdPerMillion: number; outputUsdPerMillion: number; metadataIdentity: string }
export type TemporalModels = Record<Exclude<TemporalPurchaseRole, 'embedding'>, TemporalRoleModel | null>;
export interface TemporalPurchaseJob {
  id: string; scope: string; profile: LmeRuntimeQuestion['profile']; fold: string; row: TemporalRow | 'shared'; role: TemporalPurchaseRole;
  viewIdentity: string; questionIdentity: string;
  ordinal: number; repair: boolean; sourceIds: string[]; logicalItems: number; inputBytes: number; outputTokens: number; initialPayloadBytes: number | null;
}
const digest = (value: unknown) => sha256(canonicalizeJson(value));
function wireUsage(reply: string | null): { input: number; output: number } | null {
  if (reply === null) return null;
  try {
    const body: unknown = JSON.parse(reply);
    if (!body || typeof body !== 'object' || !('usage' in body) || !body.usage || typeof body.usage !== 'object') return null;
    const usage = body.usage as Record<string, unknown>, input = usage.prompt_tokens, output = usage.completion_tokens;
    return typeof input === 'number' && typeof output === 'number' && Number.isSafeInteger(input) && Number.isSafeInteger(output) && input >= 0 && output >= 0 ? { input, output } : null;
  } catch { return null; } // Malformed replies retain their bytes and are rejected by the model client.
}
export function temporalSourceChunks<T>(sources: readonly T[]): T[][] {
  const chunks: T[][] = []; let current: T[] = [];
  for (const source of sources) {
    if (Buffer.byteLength(JSON.stringify([source])) > TEMPORAL_PLAN_LIMITS.sourceChunkBytes) throw Error('one source exceeds the registered extraction chunk; register an explicit span policy before spending');
    if (current.length && (current.length >= TEMPORAL_PLAN_LIMITS.sourceChunkItems || Buffer.byteLength(JSON.stringify([...current, source])) > TEMPORAL_PLAN_LIMITS.sourceChunkBytes)) { chunks.push(current); current = []; }
    current.push(source);
  }
  if (current.length) chunks.push(current);
  return chunks;
}
function checkModel(model: TemporalRoleModel) {
  const url = new URL(model.endpoint); assert.equal(url.protocol, 'https:'); assert.ok(!url.username && !url.password && !url.search && !url.hash, 'credential-free endpoint required');
  assert.ok(model.model.length && model.metadataIdentity.length);
  for (const price of [model.inputUsdPerMillion, model.outputUsdPerMillion]) assert.ok(Number.isFinite(price) && price >= 0, 'resolved model prices required');
}
export async function planTemporalPurchases(rows: readonly LmeRawQuestion[], locomoIds: string[], sourceIdentity: string, models: TemporalModels = { extract: null, resolve: null, answer: null, judge: null }) {
  for (const model of Object.values(models)) if (model) checkModel(model);
  const registration = registerTemporal(rows, locomoIds), dev = new Set(registration.folds[0].members), jobs: TemporalPurchaseJob[] = [];
  let sourceOccurrences = 0, embeddingLogicalItems = 0, blockedSources = 0;
  const blocked: Array<{ scope: string; profile: LmeRuntimeQuestion['profile']; reason: string }> = [];
  for (const raw of rows) for (const profile of ['provided-history', 'strict-as-of'] as const) {
    const { runtime } = longMemEvalViews(raw, profile), { sources } = await materializeLongMemEval(runtime);
    sourceOccurrences += sources.length; embeddingLogicalItems += sources.length + 1;
    const add = (role: TemporalPurchaseRole, row: TemporalPurchaseJob['row'], ordinal: number, sourceIds: string[], initialPayloadBytes: number | null, outputTokens: number, repairs: boolean) => {
      for (const repair of repairs ? [false, true] : [false]) {
        const job = { scope: runtime.scope, profile, viewIdentity: runtime.viewId, questionIdentity: sha256(runtime.question), fold: dev.has(runtime.scope) ? 'development' : 'confirmation', role, row, ordinal, repair, sourceIds,
          logicalItems: role === 'embedding' ? sourceIds.length : 1, inputBytes: TEMPORAL_PLAN_LIMITS.inputBytes, outputTokens, initialPayloadBytes: repair ? null : initialPayloadBytes };
        jobs.push({ id: digest(job), ...job });
      }
    };
    try {
      temporalSourceChunks(sources).forEach((chunk, ordinal) => add('extract', 'shared', ordinal, chunk.map(s => s.id), Buffer.byteLength(JSON.stringify({ scope: runtime.scope, sources: chunk })), 4096, true));
    } catch (cause) { blockedSources++; blocked.push({ scope: runtime.scope, profile, reason: String(cause) }); }
    add('resolve', 'shared', 0, [], Buffer.byteLength(JSON.stringify({ text: runtime.question })), 4096, true);
    for (const row of TEMPORAL_ROWS.filter(r => r !== 'oracle-window')) { add('answer', row, 0, [], null, 512, true); add('judge', row, 0, [], null, LONGMEMEVAL_JUDGE.maxTokens, false); }
  }
  const byRole = Object.fromEntries((['extract', 'resolve', 'answer', 'judge', 'embedding'] as const).map(role => {
    const selected = jobs.filter(j => j.role === role);
    return [role, { baseRequests: selected.filter(j => !j.repair).length, repairRequests: selected.filter(j => j.repair).length, physicalRequests: selected.length,
      logicalItems: role === 'embedding' ? embeddingLogicalItems : selected.filter(j => !j.repair).reduce((n, j) => n + j.logicalItems, 0),
      inputByteTokenCeiling: selected.reduce((n, j) => n + j.inputBytes, 0), outputTokenCeiling: selected.reduce((n, j) => n + j.outputTokens, 0) }];
  }));
  const configured = Object.values(models).every(m => m !== null);
  const worstCaseUsd = configured ? jobs.reduce((n, j) => { const m = models[j.role as Exclude<TemporalPurchaseRole, 'embedding'>]!; return n + (j.inputBytes * m.inputUsdPerMillion + j.outputTokens * m.outputUsdPerMillion) / 1e6; }, 0) : null;
  const body = { instrument: 'temporal-purchase-plan-v1' as const, sourceIdentity, registrationHash: registration.sha256, locomoIds, models,
    promptIdentity: digest({ extraction: TEMPORAL_EXTRACTION_PROMPT, resolution: TEMPORAL_RESOLUTION_PROMPT, temporalSchema, answer: ANSWER_SYSTEM_PROMPT, answerSchema: ANSWER_SCHEMA,
      judge: longMemEvalJudgePrompt.toString(), judgeOptions: LONGMEMEVAL_JUDGE }), limits: TEMPORAL_PLAN_LIMITS,
    questions: rows.length, profileCases: rows.length * 2, sourceOccurrences, byRole, jobs, blocked, blockedSources,
    embedding: { model: 'hash-trigram-512', dims: 512, logicalItems: embeddingLogicalItems, physicalBatches: 0, source: 'local-reference' },
    worstCaseRequests: jobs.length, worstCaseUsd, eligibleForApproval: configured && blockedSources === 0,
    semantics: 'Cold source chunks are independently extracted per knowledge view and shared only among matched rows within that view. All repairs are explicit one-attempt purchases. Input byte ceilings are conservative token reservations, not tokenizer measurements. Dynamic answer, judge and repair bodies must fit the declared ceiling or refuse before transport. Hash embeddings make zero physical requests. No paid authorization is implied.' };
  return { ...body, sha256: digest(body) };
}
export type TemporalPurchasePlan = Awaited<ReturnType<typeof planTemporalPurchases>>;
export interface TemporalPurchaseEntry {
  jobId: string; runId: string; requestHash: string; reservedUsd: number; phase: 'in-flight' | 'completed' | 'failed' | 'unknown'; status: number | null;
  reply: string | null; replyHash: string | null;
}
export interface TemporalPurchaseJournal { planHash: string; origin: 'live' | 'scripted'; campaignRequests: number; campaignUsd: number; entries: TemporalPurchaseEntry[] }
export interface TemporalPurchaseApproval { planHash: string; runId: string; perRunRequests: number; campaignRequests: number; campaignUsd: number }
export function verifyTemporalPlan(plan: TemporalPurchasePlan) {
  const { sha256: identity, ...body } = plan; assert.equal(identity, digest(body), 'purchase plan changed');
  assert.deepEqual(plan.limits, TEMPORAL_PLAN_LIMITS);
  assert.equal(plan.worstCaseRequests, plan.jobs.length); assert.equal(new Set(plan.jobs.map(j => j.id)).size, plan.jobs.length);
  for (const job of plan.jobs) {
    const { id, ...body } = job; assert.equal(id, digest(body));
    assert.equal(job.inputBytes, plan.limits.inputBytes); assert.ok(job.outputTokens > 0 && job.outputTokens <= plan.limits.outputTokens);
    assert.ok(job.sourceIds.length <= plan.limits.sourceChunkItems); assert.ok(!job.repair || ['extract','resolve','answer'].includes(job.role));
  }
}
/** Call under one exclusive journal owner. save() must durably persist before returning. */
export function temporalPurchaseTransport(plan: TemporalPurchasePlan, journal: TemporalPurchaseJournal, approval: TemporalPurchaseApproval,
  options: { fetch: typeof fetch; save(): void; replay?: boolean; deadlineMs?: number }) {
  verifyTemporalPlan(plan); assert.equal(approval.planHash, plan.sha256); assert.equal(journal.planHash, plan.sha256);
  assert.ok(plan.eligibleForApproval, 'models, prices or source coverage unresolved');
  assert.equal(journal.campaignRequests, approval.campaignRequests); assert.equal(journal.campaignUsd, approval.campaignUsd);
  for (const n of [approval.perRunRequests, approval.campaignRequests]) assert.ok(Number.isSafeInteger(n) && n >= 0);
  assert.ok(Number.isFinite(approval.campaignUsd) && approval.campaignUsd >= 0);
  const deadlineMs = options.deadlineMs ?? plan.limits.deadlineMs; assert.ok(deadlineMs > 0 && deadlineMs <= plan.limits.deadlineMs);
  const jobs = new Map(plan.jobs.map(j => [j.id, j])); assert.equal(new Set(journal.entries.map(e => e.jobId)).size, journal.entries.length, 'duplicate purchase receipt');
  const withinUsage = (entry: TemporalPurchaseEntry) => { const usage = wireUsage(entry.reply), job = jobs.get(entry.jobId)!; return !usage || (usage.input <= job.inputBytes && usage.output <= job.outputTokens); };
  const reportedUsd = (entry: TemporalPurchaseEntry) => { const usage = wireUsage(entry.reply), job = jobs.get(entry.jobId)!, model = plan.models[job.role as keyof TemporalModels]!;
    return usage ? (usage.input * model.inputUsdPerMillion + usage.output * model.outputUsdPerMillion) / 1e6 : null; };
  for (const entry of journal.entries) {
    const job = jobs.get(entry.jobId); assert.ok(job, 'receipt outside plan');
    const model = plan.models[job.role as keyof TemporalModels]!;
    assert.equal(entry.reservedUsd, (job.inputBytes * model.inputUsdPerMillion + job.outputTokens * model.outputUsdPerMillion) / 1e6, 'purchase cost changed');
    if (entry.reply !== null) assert.equal(entry.replyHash, sha256(entry.reply), 'wire receipt changed');
  }
  const campaign = createBudgetAccount({ turns: approval.campaignRequests, spent: { turns: journal.entries.length } });
  const run = createBudgetAccount({ turns: approval.perRunRequests, spent: { turns: journal.entries.filter(e => e.runId === approval.runId).length } });
  let active = 0, physicalRequests = 0, replayHits = 0;
  return { stats: () => ({ physicalRequests, replayHits, reservedUsd: journal.entries.reduce((n, e) => n + e.reservedUsd, 0),
      reportedUsd: journal.entries.every(e=>reportedUsd(e)!==null) ? journal.entries.reduce((n,e)=>n+reportedUsd(e)!,0) : null }),
    forJob(jobId: string): typeof fetch {
      return async (url, init) => {
        const job = jobs.get(jobId); assert.ok(job, 'unplanned physical request');
        const model = plan.models[job.role as keyof TemporalModels]!;
        assert.equal(String(url), model.endpoint, 'endpoint changed'); assert.equal(init?.method, 'POST'); assert.equal(typeof init?.body, 'string');
        const body = String(init!.body), request = JSON.parse(body) as Record<string, unknown>;
        assert.equal(request.model, model.model, 'model changed'); assert.ok(Buffer.byteLength(body) <= job.inputBytes, 'input ceiling exceeded');
        assert.ok(typeof request.max_tokens === 'number' && request.max_tokens > 0 && request.max_tokens <= job.outputTokens, 'output ceiling changed');
        const requestHash = digest({ endpoint: model.endpoint, body });
        const previous = journal.entries.find(e => e.jobId === jobId);
        if (previous) {
          assert.equal(previous.requestHash, requestHash, 'replay request changed');
          assert.ok(previous.reply !== null && previous.status !== null && previous.replyHash === sha256(previous.reply), 'purchase outcome uncertain; automatic rebuy is forbidden');
          assert.ok(withinUsage(previous), 'provider exceeded declared token ceiling');
          replayHits++; return new Response(previous.reply, { status: previous.status, headers: { 'content-type': 'application/json' } });
        }
        assert.ok(!options.replay, 'missing receipt; replay never reaches transport');
        assert.ok(journal.entries.every(withinUsage), 'provider exceeded declared token ceiling; further purchases are blocked');
        assert.ok(!campaign.stop() && !run.stop(), 'physical request budget exhausted'); assert.ok(active < plan.limits.concurrency, 'concurrency ceiling exceeded');
        const reservedUsd = (job.inputBytes * model.inputUsdPerMillion + job.outputTokens * model.outputUsdPerMillion) / 1e6;
        assert.ok(journal.entries.reduce((n, e) => n + Math.max(e.reservedUsd, reportedUsd(e) ?? 0), 0) + reservedUsd <= approval.campaignUsd, 'dollar budget exhausted');
        init?.signal?.throwIfAborted(); campaign.reserve(); run.reserve();
        const entry: TemporalPurchaseEntry = { jobId, runId: approval.runId, requestHash, reservedUsd, phase: 'in-flight', status: null, reply: null, replyHash: null };
        journal.entries.push(entry); options.save(); active++;
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(Error('physical deadline exceeded')), deadlineMs);
        const signal = init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
        let abort: () => void = () => {};
        const stopped = new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
        try {
          physicalRequests++;
          const result = await Promise.race([(async () => { const response = await options.fetch(url, { ...init, signal, redirect: 'error' }); return { status: response.status, reply: await response.text() }; })(), stopped]);
          entry.status = result.status; entry.reply = result.reply; entry.replyHash = sha256(result.reply); entry.phase = result.status >= 200 && result.status < 300 && withinUsage(entry) ? 'completed' : 'failed'; options.save();
          assert.ok(withinUsage(entry), 'provider exceeded declared token ceiling');
          return new Response(result.reply, { status: result.status, headers: { 'content-type': 'application/json' } });
        } catch (cause) { if (entry.phase === 'in-flight') { entry.phase = 'unknown'; options.save(); } throw cause; }
        finally { active--; clearTimeout(timer); signal.removeEventListener('abort', abort); }
      };
    },
  };
}
