/**
 * Loop semantics: the reflection/critique/revision cycle terminates on
 * the third oracle result; a conditional retry succeeds once through
 * the declared recovery value and can never exceed its cap (the capped
 * variant fails TMAS2009 with exactly the capped number of body
 * attempts); and a mid-loop crash resumes from the persisted FSM/state
 * snapshot to the identical output.
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
import { driveAcyclicFixture } from '../../benchmark/lib/mas-runner.ts';
import type { FixtureDocument } from '../../benchmark/lib/mas-conformance.types.ts';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as { configCatalog: { path: string } };
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
const registryOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile('benchmark/fixtures/mas/control-registry.json', 'utf8')));
assert.ok(catalogOutcome.valid && registryOutcome.valid);
const catalog = catalogOutcome.value;
const registry = registryOutcome.value;

async function prepared(path: string) {
  const fixture = JSON.parse(await readFile(path, 'utf8')) as FixtureDocument;
  const validated = await validateMasWorkflow(fixture.workflow, registry, catalog);
  assert.ok(validated.valid, JSON.stringify(!validated.valid ? validated.issues[0] : null));
  const plan = await planMasWorkflow(validated.value);
  assert.ok(plan.valid);
  return { fixture, validated: validated.value, plan: plan.value };
}

describe('reflection, critique, revision', () => {
  it('executes exactly three iterations and terminates on the third oracle result', async () => {
    const { fixture, validated, plan } = await prepared('benchmark/fixtures/mas/control/reflection-revision.json');
    const drive = await driveAcyclicFixture(fixture, validated, plan, registry, catalog);
    assert.equal(drive.row.state, 'runtime-pass');
    assert.equal(drive.events.filter((event) => event.includes('/reflect:completed')).length, 3);
    assert.deepEqual(drive.output, { result: { text: 'draft zero+++', quality: 3 } });
  });

  it('resumes mid-loop from the persisted snapshot to the identical output with no duplicate body attempt', async () => {
    const { fixture, validated, plan } = await prepared('benchmark/fixtures/mas/control/reflection-revision.json');
    const clean = await driveAcyclicFixture(fixture, validated, plan, registry, catalog);
    const crashed = await driveAcyclicFixture(fixture, validated, plan, registry, catalog, {
      crashBefore: 'revise',
      relaxEventOracle: true,
    });
    assert.deepEqual(crashed.output, clean.output, 'identical output after the mid-loop reclaim');
    assert.deepEqual(crashed.spend, clean.spend, 'identical committed spend');
    assert.equal(crashed.events.filter((event) => event.includes('/revise:completed')).length, 3, 'still exactly three committed revisions');
  });
});

describe('conditional retry', () => {
  it('succeeds on the second declared attempt through a typed recovery value', async () => {
    const { fixture, validated, plan } = await prepared('benchmark/fixtures/mas/control/conditional-retry.json');
    const drive = await driveAcyclicFixture(fixture, validated, plan, registry, catalog);
    assert.deepEqual(drive.output, { result: { ok: true, n: 3, goal: 2 } });
    assert.equal(drive.events.filter((event) => event.includes('/try:completed')).length, 2, 'one failure value, one success — both committed bodies');
  });

  it('cannot retry after its cap: the capped run fails TMAS2009 with exactly three body attempts', async () => {
    const { fixture, validated, plan } = await prepared('benchmark/fixtures/mas/control/conditional-retry.json');
    const capped = structuredClone(fixture);
    (capped.script.input as { start: { goal: number } }).start.goal = 99;
    Object.assign(capped.expect as object, { outcome: 'failed', output: null, failure: { node: 'attempt' } });
    const drive = await driveAcyclicFixture(capped, validated, plan, registry, catalog, { relaxEventOracle: true });
    assert.equal(drive.output, null, 'a capped loop yields no output');
    assert.equal(drive.events.filter((event) => event.includes('/try:completed')).length, 3, 'exactly the declared cap of body attempts — a fourth is impossible');
    assert.ok(drive.events.includes('attempt:failed'), 'the loop control attempt failed');
  });
});
