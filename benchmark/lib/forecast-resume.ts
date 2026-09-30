/** Crash only AFTER durable publication, then close SQLite and reopen the queue. */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { MasInfrastructureCrash } from '@tangleai/mas';
import { openTangleDb, createMasStore } from '@tangleai/store';
import { FORECAST_TABLES, forecastMust, forecastQuery, forecastRunId, forecastRevision } from '@tangleai/forecast';
import { fixtureForecastHost, type ForecastScriptCounter } from './forecast-host-fixture.ts';

export const FORECAST_RESUME_STAGES = ['checkpoint-run','note-create','checkpoint-complete','mas:checkpoint-plan','mas:checkpoint-run','mas:note-create','mas:revision-run','mas:revision-skip','mas:revision-gate','mas:checkpoint-complete'] as const;
export type ForecastResumeStage = typeof FORECAST_RESUME_STAGES[number];
export async function driveForecastResume(databasePath: string, stop?: ForecastResumeStage) {
  let instant = '2025-01-25T00:00:00.000Z', leaseClock = 1_000_000, crashes = 0, reopens = 0, duplicates = 0;
  const stopped = new Set<number>(), counters: ForecastScriptCounter[] = [], open = () => openTangleDb({ path: databasePath,jobs: { now: () => leaseClock,random: () => .5 } });
  let db = await open(), ordinal = 1;
  const crash = (stage: string) => { if (stage === stop && !stopped.has(ordinal)) { stopped.add(ordinal); throw new MasInfrastructureCrash('Forecast fixture stops after committed ' + stage); } };
  const make = async () => {
    const base = createMasStore(db,{ now: () => instant });
    const masStore = { ...base,async commitNodeCompletion(...args: Parameters<typeof base.commitNodeCompletion>) {
      const result = await base.commitNodeCompletion(...args);
      if (result.ok) crash('mas:' + result.value.attempt.invocationId);
      return result;
    } };
    return fixtureForecastHost({ db,masStore,instant: () => instant,counters,afterStage: stage => crash(stage) });
  };
  try {
    let f = await make();
    const disorder = await f.host.deliver(f.question.id,2);
    assert.equal(disorder.kind,'refused'); if (disorder.kind === 'refused') assert.equal(disorder.issues[0].code,'TFCT1004');
    const outputs: unknown[] = [], revisions: string[] = [];
    for (const scheduled of f.registered.checkpoints) {
      ordinal = scheduled.ordinal; instant = scheduled.scheduledAt;
      for (let attempt = 0; ; attempt++) {
        assert.ok(attempt < 3,'bounded recovery');
        try { const tick = await f.host.tick(instant); assert.deepEqual(tick.refused,[]); break; }
        catch (error) {
          if (!(error instanceof MasInfrastructureCrash)) throw error;
          crashes++; leaseClock += 300000;
          await db.close(); db = await open(); reopens++; f = await make(); await f.host.resume();
        }
      }
      const runId = await forecastRunId(f.question.id,instant), trace = await f.masStore.readTrace(runId);
      assert.equal(trace?.run.status,'completed',JSON.stringify(trace?.run.failure));
      assert.ok(trace!.attempts.every(a => a.status === 'completed' || a.status === 'aborted'),JSON.stringify(trace!.attempts.map(a => ({ node: a.invocationId,status: a.status }))));
      assert.ok(trace!.attempts.filter(a => a.status === 'aborted').every(a => trace!.attempts.some(b => b.idempotencyKey === a.idempotencyKey && b.status === 'completed')),'every interrupted attempt has a completed successor');
      assert.equal(trace!.run.budget.spent.turns,0,'forecast receipts, not generic MAS tasks, meter the model');
      outputs.push(trace!.run.output); revisions.push(...trace!.attempts.filter(a => a.invocationId.startsWith('revision-')).map(a => ordinal + ':' + a.invocationId));
      const before = await Promise.all(FORECAST_TABLES.map(table => forecastQuery(f.store,table))), beforeCalls = counters.reduce((n,c) => n + c.calls(),0);
      const duplicate = await f.host.deliver(f.question.id,ordinal); assert.equal(duplicate.kind,'duplicate');
      if (duplicate.kind === 'duplicate') { assert.equal(duplicate.cause.code,'TMAS2001'); duplicates++; }
      const second = await f.host.tick(instant); assert.equal(second.started,0); assert.equal(second.due,0);
      assert.deepEqual(await Promise.all(FORECAST_TABLES.map(table => forecastQuery(f.store,table))),before);
      assert.equal(counters.reduce((n,c) => n + c.calls(),0),beforeCalls);
      if (ordinal < 3) { await db.close(); db = await open(); reopens++; f = await make(); await f.host.resume(); }
    }
    const records = Object.fromEntries(await Promise.all(FORECAST_TABLES.map(async table => [table,forecastMust(await forecastQuery(f.store,table))])));
    const logicalCalls = counters.reduce((n,c) => n + c.calls(),0), physicalRequests = counters.reduce((n,c) => n + c.physicalCalls(),0);
    assert.equal(logicalCalls,12); assert.equal(physicalRequests,0); assert.ok(revisions.includes('1:revision-skip')); assert.ok(!revisions.includes('1:revision-run'));
    const report = { records,outputs,logicalCalls,physicalRequests }, bytes = canonicalizeJson(report), digest = await forecastRevision(report);
    assert.equal((await db.integrityCheck()).ok,true);
    return { bytes,digest,logicalCalls,physicalRequests,crashes,reopens,duplicates,ordinalRefusals: 1,firstRevisionSkipped: true,revisions,executableRevision: f.host.plan.executableRevision };
  } finally { await db.close(); }
}
export async function measureForecastResume(directory?: string) {
  const owned = directory === undefined, root = directory ?? await mkdtemp(join(tmpdir(),'forecast-resume-'));
  try {
    const baseline = await driveForecastResume(join(root,'baseline.db'));
    const stages = [];
    for (const stage of FORECAST_RESUME_STAGES) {
      const result = await driveForecastResume(join(root,stage.replace(':','-') + '.db'),stage);
      assert.equal(result.bytes,baseline.bytes,stage); assert.equal(result.logicalCalls,baseline.logicalCalls,stage);
      // The two mutually exclusive branch tasks execute once and twice respectively.
      assert.equal(result.crashes,stage === 'mas:revision-skip' ? 1 : stage === 'mas:revision-run' ? 2 : 3,stage);
      stages.push({ stage,stops: result.crashes,resumed: result.crashes,extraCalls: result.logicalCalls - baseline.logicalCalls,artifactDigest: result.digest });
    }
    return { checkpoints: 3,logicalCalls: baseline.logicalCalls,physicalRequests: baseline.physicalRequests,baselineReopens: baseline.reopens,duplicateDeliveries: baseline.duplicates,duplicateCause: 'TMAS2001',ordinalRefusals: baseline.ordinalRefusals,firstRevisionSkipped: baseline.firstRevisionSkipped,artifactDigest: baseline.digest,executableRevision: baseline.executableRevision,stages };
  } finally { if (owned) await rm(root,{ recursive: true,force: true,maxRetries: 8,retryDelay: 50 }); }
}
