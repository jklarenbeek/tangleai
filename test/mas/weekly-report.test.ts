/**
 * The weekly report through the real durable runtime, plus the forced
 * reclaim matrix: a one-shot infrastructure crash before every node
 * still converges to identical output, ordered messages and spend with
 * ZERO duplicate scripted provider calls — the drafters overlap at
 * measured concurrency exactly 3 and the finalizer receives declared
 * edge order under reverse completion every time.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  planMasWorkflow,
  validateMasWorkflow,
} from '@tangleai/mas';
import { driveAcyclicFixture, runAcyclicFixture } from '../../benchmark/lib/mas-runner.ts';
import type { FixtureDocument } from '../../benchmark/lib/mas-conformance.types.ts';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as {
  registry: { path: string }, configCatalog: { path: string },
};
const snapshotOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile(manifest.registry.path, 'utf8')));
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
assert.ok(snapshotOutcome.valid && catalogOutcome.valid);
const snapshot = snapshotOutcome.value;
const catalog = catalogOutcome.value;

const fixture = JSON.parse(await readFile('benchmark/fixtures/mas/positive/weekly-report-manual.json', 'utf8')) as FixtureDocument;
const validatedOutcome = await validateMasWorkflow(fixture.workflow, snapshot, catalog);
assert.ok(validatedOutcome.valid);
const validated = validatedOutcome.value;
const planOutcome = await planMasWorkflow(validated);
assert.ok(planOutcome.valid);
const plan = planOutcome.value;

describe('the weekly report fixture', () => {
  it('passes its complete registered oracle through the durable runtime', async () => {
    const row = await runAcyclicFixture(fixture, validated, plan, snapshot, catalog);
    assert.equal(row.state, 'runtime-pass');
    assert.equal(row.maxObservedConcurrency, 3, 'the three drafters overlap at exactly 3');
    assert.equal(row.calls, 11);
    assert.equal(row.toolCalls, 3);
    assert.equal(row.contextReads, 1);
  });

  it('forced reclaim before every node converges with zero duplicate scripted provider calls', async () => {
    const clean = await driveAcyclicFixture(fixture, validated, plan, snapshot, catalog, {});
    assert.equal(clean.scriptedClientCalls, 11);

    for (const crashBefore of ['researcher', 'data-analyst', 'market-analyst', 'writer']) {
      const crashed = await driveAcyclicFixture(fixture, validated, plan, snapshot, catalog, {
        crashBefore,
        relaxEventOracle: true,
      });
      assert.deepEqual(crashed.output, clean.output, `crash before ${crashBefore}: identical output`);
      assert.deepEqual(crashed.messagesBrief, clean.messagesBrief, `crash before ${crashBefore}: identical ordered messages`);
      assert.deepEqual(crashed.spend, clean.spend, `crash before ${crashBefore}: identical committed spend`);
      assert.equal(crashed.scriptedClientCalls, 11, `crash before ${crashBefore}: zero duplicate scripted provider calls`);
      assert.equal(crashed.row.state, 'runtime-pass');
      assert.equal(crashed.row.calls, 11, 'committed call counts stay exact across the reclaim');
    }
  });
});
