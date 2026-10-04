import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExecutionManifest, createResearchWorkspace, validateExecutionManifest, validateResearchWorkspace,
  researchRevisionOf, RESEARCH_EXECUTION_LIMITS, type ResearchExecutionManifestInput, type ResearchOutcome } from '@tangleai/research';
import { checked, hash } from './fixtures.ts';
import { executionFixture } from './execution-fixtures.ts';
import { probeResearchExecutionRefusal } from '../../benchmark/lib/research-execution-fixture.ts';
import { requireResearchShape } from '../../benchmark/lib/research-validation.ts';
import type { ResearchExecutionRefusalFixture } from '../../benchmark/lib/research.types.ts';

function code(result: ResearchOutcome<unknown>, expected: string) {
  assert.equal(result.valid, false); if (!result.valid) assert.equal(result.issues[0].code, expected, JSON.stringify(result));
}
test('execution manifest binds frozen inputs, exact bytes and the shipped executor contract', async () => {
  const f = await executionFixture();
  assert.deepEqual(checked(await validateExecutionManifest(f.manifest, f.workspace, f.context)), f.manifest);
  const { id, executionManifestHash, ...body } = f.manifest;
  assert.equal(executionManifestHash, await researchRevisionOf(body));
  assert.equal(id, 'execution-' + executionManifestHash);
  assert.equal(f.manifest.workspaceHash, f.workspace.manifest.workspaceHash);
});
const mutations: Record<string, (input: ResearchExecutionManifestInput) => void> = {
  'escape-path': input => { input.workspace.manifest.entries[0].path = '../outside'; },
  'secret-read': input => { input.workspace.manifest.entries[0].path = 'hidden/labels.json'; },
  'network-during-measured': input => { input.network = { setup: 'off', measured: 'on' } as never; },
  'resource-cap': input => { input.resources.memoryBytes = RESEARCH_EXECUTION_LIMITS.resources.memoryBytes + 1; },
  'writable-evaluator': input => { input.workspace.manifest.entries.find(row => row.role === 'evaluator')!.mode = 'writable'; },
  'missing-image-digest': input => { input.imageDigest = ''; },
};
for (const [name, mutate] of Object.entries(mutations)) test(name + ' is refused before executor dispatch', async () => {
  const f = await executionFixture(), input = structuredClone(f.input); mutate(input);
  let calls = 0;
  const result = await buildExecutionManifest(input);
  if (result.valid) { calls++; await f.executor.run(result.value, input.workspace, f.context); }
  code(result, 'TRSH1010'); assert.equal(calls, 0);
});
test('contract and plan mismatches retain preregistration refusal', async () => {
  const f = await executionFixture();
  code(await buildExecutionManifest({ ...f.input, contract: { ...f.contract, contractHash: hash() } }), 'TRSH1009');
  code(await buildExecutionManifest({ ...f.input, plan: { ...f.plan, planHash: hash() } }), 'TRSH1009');
  code(await validateExecutionManifest({ ...f.manifest, planHash: hash() }, f.workspace, f.context), 'TRSH1009');
  code(await validateExecutionManifest({ ...f.manifest, network: { setup: 'off', measured: 'on' } } as never, f.workspace, f.context), 'TRSH1010');
});
test('each committed isolation fixture reproduces its registered admission refusal', async () => {
  const { fixture } = await executionFixture();
  assert.deepEqual(fixture.manifest.execution.refusals.map(row => row.id), ['escape-path', 'secret-read', 'network-during-measured', 'resource-cap', 'writable-evaluator']);
  for (const registered of fixture.manifest.execution.refusals) {
    const input = requireResearchShape<ResearchExecutionRefusalFixture>('ResearchExecutionRefusalFixture', JSON.parse(new TextDecoder().decode(fixture.files.get(registered.path)!)));
    assert.deepEqual(input.expected, registered.expected);
    const observed = await probeResearchExecutionRefusal(fixture, input);
    assert.equal(observed.refusedAsRegistered, true, JSON.stringify(observed));
  }
});
test('archive identities and case or parent path collisions cannot evade admission', async () => {
  const f = await executionFixture(), changed = structuredClone(f.workspace);
  changed.artifacts[0].bytes[0] ^= 1; code(await validateResearchWorkspace(changed), 'TRSH1002');
  for (const path of ['/tmp/a', 'output', 'input/../../a', 'Secrets/token', 'inputs/.env.local', 'inputs/a\\b', 'inputs//a']) {
    const input = structuredClone(f.input); input.workspace.manifest.entries[0].path = path;
    code(await buildExecutionManifest(input), 'TRSH1010');
  }
  for (const paths of [['input/a', 'INPUT/A'], ['input/a', 'input/a/b']])
    code(await createResearchWorkspace({ projectId: 'p', datasetIds: [], splitIds: [], files: paths.map(path => ({
      path, bytes: new Uint8Array([1]), mode: 'read-only', role: 'input' })) }), 'TRSH1010');
});
test('aliased addresses count materialized bytes and async hashing snapshots mutable inputs', async () => {
  const f = await executionFixture(), captured = structuredClone(f.workspace);
  const pending = buildExecutionManifest(f.input);
  f.workspace.artifacts[0].bytes.fill(0);
  assert.equal(checked(await pending).workspaceHash, captured.manifest.workspaceHash);
  const workspace = checked(await createResearchWorkspace({ projectId: 'p', datasetIds: [], splitIds: [],
    files: ['a', 'b'].map(path => ({ path, bytes: new Uint8Array(10), mode: 'read-only', role: 'input' })) }));
  assert.equal(workspace.artifacts.length, 1);
  code(await validateResearchWorkspace(workspace, { ...RESEARCH_EXECUTION_LIMITS, maxInputBytes: 15 }), 'TRSH1010');
});
