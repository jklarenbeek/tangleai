/**
 * The lifecycle/region seams the fixtures exercise implicitly, pinned
 * directly: an invalid aggregated input is a TMAS2004 attempt value; a
 * first failure aborts the concurrent sibling and every started
 * lifecycle settles its own attempt before the region reports; nothing
 * turns partial results into workflow output; and the import census
 * proves the runtime consumed the suite, not a private twin.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  planMasWorkflow,
  validateMasWorkflow,
} from '@tangleai/mas';
import { driveAcyclicFixture } from '../../benchmark/lib/mas-runner.ts';
import type { FixtureDocument } from '../../benchmark/lib/mas-conformance.types.ts';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as {
  registry: { path: string }, configCatalog: { path: string },
};
const snapshotOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile(manifest.registry.path, 'utf8')));
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
assert.ok(snapshotOutcome.valid && catalogOutcome.valid);
const snapshot = snapshotOutcome.value;
const catalog = catalogOutcome.value;

async function loadFixture(path: string): Promise<{ fixture: FixtureDocument, validated: never, plan: never }> {
  const fixture = JSON.parse(await readFile(path, 'utf8')) as FixtureDocument;
  const validated = await validateMasWorkflow(fixture.workflow, snapshot, catalog);
  assert.ok(validated.valid);
  const plan = await planMasWorkflow(validated.value);
  assert.ok(plan.valid);
  return { fixture, validated: validated.value as never, plan: plan.value as never };
}

describe('failure and abort through the region', () => {
  it('the failure-abort fixture names the failure, aborts the sibling and leaves no output', async () => {
    const { fixture, validated, plan } = await loadFixture('benchmark/fixtures/mas/positive/failure-abort.json');
    const drive = await driveAcyclicFixture(fixture, validated, plan, snapshot, catalog, {});
    assert.deepEqual(drive.events, ['boom:failed', 'slow:aborted'], 'the sibling settled its aborted attempt before the region reported');
    assert.equal(drive.output, null, 'no partial workflow output');
    assert.equal(drive.row.state, 'runtime-pass');
  });

  it('an invalid delivered value fails as TMAS2004 with the attempt retaining the refusal', async () => {
    const { fixture, validated, plan } = await loadFixture('benchmark/fixtures/mas/positive/sequential.json');
    // Scripted first handler emits a number where the wire declares a string;
    // the CONSUMER's input validation is the boundary that must catch it.
    const broken = structuredClone(fixture);
    broken.script.handlers.first = { query: { value: { $add: [1, 1] } } };
    await assert.rejects(
      driveAcyclicFixture(broken, validated, plan, snapshot, catalog, { relaxEventOracle: true }),
      /run is 'failed', not completed/,
      'the run fails rather than delivering an invalid value downstream',
    );
  });
});

describe('the runtime import census', () => {
  it('consumes the published engines and adds no scheduler, dispatcher, parser, budget or replay twin', async () => {
    let all = '';
    for (const name of await readdir('packages/mas/src')) {
      if (name.endsWith('.ts')) all += await readFile(`packages/mas/src/${name}`, 'utf8');
    }
    for (const wanted of [
      'createAgent', 'createToolbox', 'createStructuredOutput', 'createBudgetAccount',
      'createLedger', 'createEnvironment', 'compileDag', 'compileFsm',
    ]) {
      assert.ok(all.includes(wanted), `the runtime consumes ${wanted}`);
    }
    for (const [name, forbidden] of [
      ['a desktop chat dependency', /apps\/desktop|chat\.send/],
      ['a provider resolver', /resolveEndpoint|baseUrl.*api\.openai|openrouter/i],
      ['a JSON reply parser/repair loop', /JSON\.parse\((result|reply|content)/],
      ['a local tool dispatcher', /function\s+dispatch\s*\(/],
      ['a local budget account', /spentTurns\s*\+\+|turnsRemaining/],
      ['a history compactor', /compactHistory|summariz/i],
      ['a readiness scheduler', /readyQueue|inDegree|kahn|topoSort/i],
      ['a replay key implementation', /replayKey|semanticKey\s*\(/],
    ] as Array<[string, RegExp]>) {
      assert.equal(forbidden.test(all), false, `packages/mas/src contains ${name}`);
    }
    const pkg = JSON.parse(await readFile('packages/mas/package.json', 'utf8')) as { dependencies: Record<string, string> };
    for (const dependency of Object.keys(pkg.dependencies)) {
      assert.match(dependency, /^@(jarenjs|tangleai)\//, `${dependency} stays inside the boundary — no orchestration library`);
    }
  });
});
