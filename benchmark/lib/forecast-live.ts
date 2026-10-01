/** A credential-free, bounded registration; only its exact authorization reaches a wire. */
import { equalsJson } from '@jarenjs/core/object';
import { forecastRevision, forecastPromptRevisions, forecastExecutorToolset } from '@tangleai/forecast';
import { readAiEnv, type AiEnv } from './ai-env.ts';
import { wireDescriptorOf, countingFetch } from './grounding-run.ts';
import { loadForecastFixtures, type ForecastFixtures } from './forecast-fixtures.ts';
import { sourceManifest } from './source-manifest.ts';
import { SOURCE_FILES, FORECAST_SOURCE_ROOTS } from './forecast-report.ts';
import { createReportValidator } from './validate.ts';
import schema from '../schemas/forecast-live.schema.json' with { type: 'json' };
import type { ForecastLive, LivePlan } from './forecast-live.types.ts';

export const FORECAST_LIVE_PATH = 'benchmark/results/forecast-live.json';
export const FORECAST_LIVE_LIMITS = Object.freeze({ checkpointCalls: 8,retrospectiveCalls: 4,maxOutputTokens: 1024,checkpointMs: 60000,retrospectiveMs: 30000,concurrency: 1,retryAttempts: 1 } as const);
export const FORECAST_LIVE_ROWS = ['no-harness','static-harness','scaffold-no-harness','evolving-harness'] as const;
const validator = createReportValidator(schema);
export async function buildForecastLive(options: { env?: AiEnv;root?: string;fixture?: ForecastFixtures } = {}): Promise<ForecastLive> {
  const env = options.env ?? readAiEnv({}), root = options.root ?? process.cwd(), fixture = options.fixture ?? await loadForecastFixtures(root);
  // Invalid URL descriptions can themselves contain secrets; none enter a plan.
  if (env.baseUrl) {
    let url: URL;try { url = new URL(env.baseUrl); } catch { throw Error('Forecast live base URL is invalid.'); }
    if (url.username || url.password || url.search || url.hash) throw Error('Forecast live base must be credential-free and have no query or fragment.');
  }
  const wire = wireDescriptorOf(env,'off'), source = await sourceManifest(root,SOURCE_FILES,FORECAST_SOURCE_ROOTS);
  const rows = await Promise.all(FORECAST_LIVE_ROWS.map(async id => { const tools = await forecastExecutorToolset(id);return { id,questions: fixture.questions.map(q => q.id),checkpoints: fixture.questions.flatMap(q => q.checkpoints.map(c => c.id)),maxFreshCalls: fixture.manifest.census.checkpoints*FORECAST_LIVE_LIMITS.checkpointCalls+(id === 'evolving-harness' ? fixture.manifest.census.resolutions*FORECAST_LIVE_LIMITS.retrospectiveCalls : 0),cacheHits: 0 as const,prompts: await forecastPromptRevisions(id),toolset: { names: tools.names,revision: tools.revision } }; }));
  const maxFreshTotal = rows.reduce((n,r) => n+r.maxFreshCalls,0);
  const body = { registrationId: fixture.manifest.registrationId,source: { head: source.head,sha256: source.sha256,files: source.files },wire,limits: FORECAST_LIVE_LIMITS,rows,maxFreshTotal,cache: 'none' as const,evidence: 'frozen-cutoff-replay' as const,pairedEvaluation: 'executed-digests-only' as const };
  const plan = { ...body,planId: await forecastRevision(body),skipped: !env.live ? (env.apiKey === null ? 'No live key or configured local wire; configure the shared AI environment.' : 'The shared AI environment has no executable chat wire.') : env.guardIssues.length ? 'A configured spend guard was rejected.' : maxFreshTotal > env.maxCalls ? `Registered maximum ${maxFreshTotal} exceeds the configured ${env.maxCalls} request ceiling.` : null };
  const record = { instrument: 'forecast-live' as const,schemaVersion: 1 as const,status: 'not-run' as const,plan,physicalRequests: 0 as const,reason: 'This is a registration, not a provider receipt. A new explicit approval naming this exact plan is required. Live quality and future candidate prediction pairs remain unmeasured.' };
  validateForecastLive(record); return record;
}
export function validateForecastLive(value: unknown): asserts value is ForecastLive { const result = validator(value); if (!result.valid) throw Error('Invalid forecast live registration: ' + JSON.stringify(result.errors)); }
export function forecastLiveAuthorization(plan: LivePlan, authorize?: string): 'refused' | 'skipped' | 'dry-run' | 'execute' {
  if (authorize !== undefined && authorize !== plan.planId) return 'refused';
  if (plan.skipped) return 'skipped';
  return authorize === undefined ? 'dry-run' : 'execute';
}
export function describeForecastLive(record: ForecastLive): string {
  const { plan } = record;
  return [`Forecast live plan ${plan.planId}: not-run`, `Registration ${plan.registrationId}; source ${plan.source.sha256}.`, `${plan.wire.provider} / ${plan.wire.model || '(no model)'}; key source ${plan.wire.keySource ?? '(none)'}.`,...plan.rows.map(r => `${r.id}: ${r.questions.length} questions / ${r.checkpoints.length} checkpoints; maximum ${r.maxFreshCalls} fresh calls; ${r.cacheHits} cache hits.`), `Maximum ${plan.maxFreshTotal} requests, ${plan.limits.maxOutputTokens} output tokens per request, ${plan.limits.concurrency} concurrent; configured ceiling ${plan.wire.maxCalls}.`,plan.skipped ?? 'Dry plan: no request is authorized.',record.reason].join('\n');
}
/** The caller retains both the plan and the execution receipt. The default path is zero requests. */
export async function runForecastLive(record: ForecastLive, options: { env: AiEnv;authorize?: string;fetch?: typeof globalThis.fetch;root?: string;databasePath?: string }) {
  validateForecastLive(record);
  const current = await buildForecastLive({ env: options.env,root: options.root });
  if (!equalsJson(current,record)) throw Error('Forecast live plan changed; inspect and authorize the current plan.');
  const authorization = forecastLiveAuthorization(record.plan,options.authorize), transport = countingFetch(options.fetch ?? globalThis.fetch);
  if (authorization !== 'execute') return { authorization,physicalRequests: 0,counts: transport.counts,execution: null };
  const { executeForecastLive } = await import('./forecast-live-execution.ts');
  const execution = await executeForecastLive(record.plan,{ ...options,fetch: transport.fetch });
  const physicalRequests = Object.values(transport.counts).reduce((n,v) => n+v,0);
  return { authorization,physicalRequests,counts: transport.counts,execution };
}
