import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MasInfrastructureCrash, type MasStore } from '@tangleai/mas';
import { openTangleDb, createMasStore, createTradingStore, createMasSegmentDriver } from '@tangleai/store';
import { runBacktest, type TradingStrategyResult } from '@tangleai/trading';
import { createScriptedTradingAgent, type ScriptedTradingAgentOptions } from '../../benchmark/lib/trading-agent-runner.ts';
import { checked } from '../../benchmark/lib/trading-research-runner.ts';
import { backtestFixture } from './backtest-fixture.ts';

const fixture = await backtestFixture(3);
type Probe = { kind: 'before' | 'after'; path: string } | { kind: 'fsm'; control: string; state: string; iteration?: number } | { kind: 'segment' | 'financial' };
const baselineDb = await openTangleDb({ jobs: { now: () => 1000000, random: () => 0.5 } });
const fsms: Array<Extract<Probe, { kind: 'fsm' }>> = [];
const baseMas = createMasStore(baselineDb, { now: () => 'scripted-tick' });
let firstRun: string | undefined;
const baselineAgent = createScriptedTradingAgent(baselineDb, fixture.catalog, { store: { ...baseMas, putRunFsm: async (...args) => {
  firstRun ??= args[0];
  const snapshot = args[2] as { state: string; context?: { iteration?: number } };
  const value = { kind: 'fsm' as const, control: args[1], state: snapshot.state, ...(snapshot.context?.iteration === undefined ? {} : { iteration: snapshot.context.iteration }) };
  if (args[0] === firstRun && !fsms.some(s => JSON.stringify(s) === JSON.stringify(value))) fsms.push(value);
  return baseMas.putRunFsm(...args);
} } });
const baseline = checked(await runBacktest({ ...fixture.data, providers: fixture.providers, store: createTradingStore(baselineDb), decide: baselineAgent.decide }));
assert.equal(baseline.result.status, 'completed');
assert.equal(baseline.fills.length, 2, 'recovery must cross real financial effects');
await baselineDb.close();
const paths = [...new Set(baselineAgent.events.filter(e => e.runId === baselineAgent.events[0].runId && e.event === 'completed').map(e => e.path))];
const probes: Probe[] = [...paths.flatMap(path => [{ kind: 'before' as const, path }, { kind: 'after' as const, path }]), ...fsms, { kind: 'segment' }, { kind: 'financial' }];

for (const probe of probes) it(`a crash ${probe.kind} ${'path' in probe ? probe.path : 'control' in probe ? `${probe.control}/${probe.state}/${probe.iteration ?? ''}` : 'completion'} resumes to a byte-identical result`, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'trading-recovery-')), path = join(dir, 'run.sqlite');
  const clock = { value: 1000000 }, census = { physical: 0, completion: 0, normalization: 0, repair: 0, restores: 0, replays: 0 };
  let armed = true, crashes = 0, reopens = 0, result: TradingStrategyResult | undefined;
  const crash = () => { armed = false; crashes++; throw new MasInfrastructureCrash(`registered ${probe.kind} recovery probe`); };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const db = await openTangleDb({ path, jobs: { now: () => clock.value, random: () => 0.5 } });
      try {
        const base = createMasStore(db, { now: () => 'scripted-tick' });
        const mas: MasStore = { ...base, beginNodeAttempt: async plan => {
          if (armed && probe.kind === 'before' && probe.path === plan.path) crash();
          return base.beginNodeAttempt(plan);
        }, putRunFsm: async (...args) => {
          const saved = await base.putRunFsm(...args), snapshot = args[2] as { state: string; context?: { iteration?: number } };
          if (armed && probe.kind === 'fsm' && args[1] === probe.control && snapshot.state === probe.state && snapshot.context?.iteration === probe.iteration) crash();
          return saved;
        } };
        const driver = createMasSegmentDriver(db, mas, { owner: 'recovery', leaseMs: 700000 });
        const options: ScriptedTradingAgentOptions = { store: mas, census, observer: () => ({ onNodeSettle: (path, status) => {
          if (armed && probe.kind === 'after' && path === probe.path && status === 'completed') crash();
        } }), segments: { ...driver, drive: (revision, execute, signal) => driver.drive(revision, segment => execute({ ...segment, completeSegment: async value => {
          if (armed && probe.kind === 'segment' && segment.run.id === baselineAgent.events.at(-1)!.runId) crash();
          await segment.completeSegment(value);
        } }), signal) } };
        const agent = createScriptedTradingAgent(db, fixture.catalog, options), store = createTradingStore(db);
        try {
          result = checked(await runBacktest({ ...fixture.data, providers: fixture.providers, store, decide: agent.decide,
            afterDecision: () => { if (armed && probe.kind === 'financial') crash(); } }));
        } catch (cause) {
          if (!(cause instanceof MasInfrastructureCrash)) throw cause;
          clock.value += 1000000; reopens++;
        }
        if (result) {
          const counts = await db.jobs!.counts(); assert.equal(counts.pending, 0); assert.equal(counts.leased, 0); assert.equal(counts.failed, 0); assert.equal(counts.dead, 0);
          const again = checked(await runBacktest({ ...fixture.data, providers: fixture.providers, store, decide: agent.decide }));
          assert.deepEqual(again, { ...result, writes: 0 });
        }
      } finally { await db.close(); }
      if (result) break;
    }
    assert.equal(crashes, 1); assert.equal(reopens, 1); assert.ok(result);
    assert.deepEqual(result.result, baseline.result); assert.deepEqual(result.fills, baseline.fills); assert.deepEqual(result.portfolios, baseline.portfolios);
    assert.equal(census.physical, baselineAgent.census.physical); assert.equal(census.normalization, baselineAgent.census.normalization);
    assert.equal(result.fills.length, new Set(result.fills.map(fill => fill.intentId)).size);
    t.diagnostic(JSON.stringify({ probe, crashes, reopens, physicalCalls: census.physical, restores: census.restores, replays: census.replays }));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
