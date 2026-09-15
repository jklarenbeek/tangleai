/**
 * The live tier that spends nothing.
 *
 * A live skill-evolution run is not authorized by this repository. What is
 * committed instead is the registration of one: a credential-free description
 * of the rows a live rerun would cover, the ceiling each would run under and
 * the stages it would drive, hashed into a `planId` that an explicit
 * `--authorize <plan-id>` would have to name. Nothing behind that door exists
 * — there is no execution path here to reach, and the record says so in its
 * own `reason` rather than leaving a reader to infer it.
 *
 * The record is deterministic by construction. Its plan is built from an
 * environment DESCRIPTION, so the committed bytes do not depend on whether the
 * machine that rendered them had a key: the committed copy is the one an empty
 * environment produces, and an operator's own environment changes what the
 * terminal prints, never what the repository carries.
 *
 * A key is never read into this module, never printed and never hashed. The
 * plan carries the NAME of the variable a key would come from.
 */

import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createReportValidator, describeErrors } from './validate.ts';
import LIVE_SCHEMA from '../schemas/trace2skill-live.schema.json' with { type: 'json' };
import { AI_ENV, readAiEnv, chatSettingsOf, type AiEnv } from './ai-env.ts';
import { livePlanOf } from './trace2skill-cli.ts';
import { ROOT } from './trace2skill-fixture.ts';
import type { LoadedFixture } from './trace2skill-fixture.ts';
import type { Trace2skillReport } from './trace2skill.types.ts';
import type { LivePlan, LivePlanRow, Trace2skillLive } from './trace2skill-live.types.ts';

export const LIVE_RECORD_PATH = join(ROOT, 'benchmark/results/trace2skill-live.json');

/**
 * The environment the committed registration is rendered under: none. Every
 * guard is its documented default and no key is configured, which is exactly
 * the state a clone starts in.
 */
export const FROZEN_LIVE_ENV: AiEnv = readAiEnv({});

/** Why the committed record is `not-run`, stated where a reader meets it. */
const LIVE_REASON =
  'no live tier is authorized in this build: the plan is a registration, and executing it needs a separate operator '
  + 'approval naming its planId. Nothing was spent and no request was made.';

/** What an authorization argument means against a frozen plan. */
export type LiveAuthorization = 'skipped' | 'dry-run' | 'refused' | 'unimplemented';

/**
 * An argument that does not name this plan is refused before anything else is
 * considered: a mismatched approval is wrong whether or not the plan would
 * have fitted its ceiling, and answering it with the ceiling would tell an
 * operator their id was accepted.
 */
export function liveAuthorizationOf(plan: LivePlan, authorize: string | undefined): LiveAuthorization {
  if (authorize !== undefined && authorize !== plan.planId) return 'refused';
  if (plan.skipped !== null) return 'skipped';
  return authorize === undefined ? 'dry-run' : 'unimplemented';
}

/**
 * The rows a live rerun would cover, with the ceiling each runs under. The
 * keyless tier's own call count IS the ceiling: the wire answers the same
 * registered units, so a live rerun of a row makes at most the calls that row
 * already made, once per unit and once more for a repair.
 */
function livePlanRows(report: Trace2skillReport): LivePlanRow[] {
  const rows: LivePlanRow[] = [];
  for (const table of [report.tables.deepening, report.tables.creation]) {
    for (const row of table) {
      if (row.condition === 'oracle' || row.condition === 'random') continue;
      rows.push({
        id: row.id,
        condition: row.condition,
        status: row.status,
        units: row.tasks.length,
        // The keyless tier answered the same registered units, so its own call
        // count is the ceiling a live rerun is planned against, doubled for one
        // repair per call. A live model that wanted more is stopped by the run
        // budget, not by this number.
        maxFreshCalls: row.cost.calls * 2,
        // No replay cache is consulted: a cache is addressed by endpoint, and
        // no endpoint is resolved until a key exists.
        cacheHits: 0,
      });
    }
  }
  return rows;
}

export interface LiveRecordOptions {
  loaded: LoadedFixture;
  report: Trace2skillReport;
  mode?: 'deepening' | 'creation';
  /** The environment the plan describes; the frozen empty one by default. */
  env?: AiEnv;
}

/** The frozen plan and the record that it was not run. Pure: same inputs, same bytes. */
export async function buildTrace2SkillLiveRecord(options: LiveRecordOptions): Promise<Trace2skillLive> {
  const env = options.env ?? FROZEN_LIVE_ENV;
  const mode = options.mode ?? 'deepening';
  const settings = chatSettingsOf(env);
  const base = await livePlanOf(env, mode, options.loaded);
  const rows = livePlanRows(options.report);
  const maxFreshTotal = rows.reduce((total, row) => total + row.maxFreshCalls, 0);
  const cacheHits = rows.reduce((total, row) => total + row.cacheHits, 0);
  const skipped = maxFreshTotal > env.maxCalls
    ? `${maxFreshTotal} maximum fresh requests exceed ${AI_ENV.maxCalls}=${env.maxCalls}; nothing was spent`
    : null;
  const plan: LivePlan = {
    planId: base.id,
    authorized: false,
    instrument: 'trace2skill',
    mode,
    fixtureId: options.loaded.fixtureId,
    provider: settings.provider ?? env.provider,
    model: settings.model,
    baseUrl: settings.baseUrl,
    keySource: env.keySource ?? AI_ENV.key,
    maxCalls: env.maxCalls,
    maxConcurrency: env.maxConcurrency,
    promptVersions: base.promptVersions.map(([role, revision]) => [role, revision]),
    stages: base.stages,
    rows,
    maxFreshTotal,
    cacheHits,
    skipped,
  };
  const payload: Omit<Trace2skillLive, 'recordId'> = {
    instrument: 'trace2skill-live',
    version: 1,
    status: 'not-run',
    reason: LIVE_REASON,
    calls: 0,
    spend: { calls: 0, tokens: 0 },
    plan,
  };
  const record: Trace2skillLive = { ...payload, recordId: await canonicalSha256(payload as unknown as Record<string, unknown>) };
  const outcome = await validateTrace2SkillLiveRecord(record);
  if (!outcome.valid) throw new Error(`the skill-evolution live record does not validate: ${outcome.errors.join('; ')}`);
  return record;
}

/** The printable plan — complete, credential-free, and what `--authorize` must match. */
export function describeLivePlan(record: Trace2skillLive): string[] {
  const { plan } = record;
  return [
    `live plan ${plan.planId}`,
    `  provider ${plan.provider}; model ${String(plan.model)}; base ${String(plan.baseUrl)}`,
    `  key would be read from ${plan.keySource}; ceilings ${plan.maxCalls} calls, ${plan.maxConcurrency} concurrent`,
    `  fixture ${plan.fixtureId.slice(0, 12)}; ${plan.stages.length} stages; ${plan.promptVersions.length} prompt packs`,
    ...plan.rows.map(row => `  row ${row.id} (${row.status}): ${row.units} unit(s), at most ${row.maxFreshCalls} fresh call(s), ${row.cacheHits} cache hit(s)`),
    `  ceilings: at most ${plan.maxFreshTotal} fresh requests against ${AI_ENV.maxCalls}=${plan.maxCalls}`,
    plan.skipped === null ? '  fits the configured ceiling' : `  SKIPPED: ${plan.skipped}`,
    `  ${record.reason}`,
  ];
}

export function renderLiveRecord(record: Trace2skillLive): string {
  return JSON.stringify(record, null, 2) + '\n';
}

let validator: ReturnType<typeof createReportValidator> | undefined;

/**
 * Schema and identity validation of a live record. The identity covers the
 * whole credential-free payload, so a record whose ceilings or rows were
 * edited after the fact no longer names its own `recordId`.
 */
export async function validateTrace2SkillLiveRecord(value: unknown): Promise<{ valid: boolean, errors: string[] }> {
  validator ??= createReportValidator(LIVE_SCHEMA as object);
  const outcome = validator(value);
  if (!outcome.valid) return { valid: false, errors: describeErrors(outcome, 6) };
  const record = value as Trace2skillLive;
  const { recordId, ...payload } = record;
  const errors: string[] = [];
  if (recordId !== await canonicalSha256(payload as unknown as Record<string, unknown>)) errors.push('live record identity');
  if (record.plan.planId !== await canonicalSha256({
    instrument: record.plan.instrument, mode: record.plan.mode, fixtureId: record.plan.fixtureId,
    provider: record.plan.provider, model: record.plan.model, baseUrl: record.plan.baseUrl,
    keySource: record.plan.keySource,
    maxCalls: record.plan.maxCalls, maxConcurrency: record.plan.maxConcurrency,
    promptVersions: record.plan.promptVersions, stages: record.plan.stages,
  })) errors.push('live plan identity');
  return { valid: errors.length === 0, errors };
}
