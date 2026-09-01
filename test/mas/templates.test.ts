/**
 * Template instantiation: schema-validated parameters through compiled
 * RFC 6902 copy-on-write; `createJSONPatch` proves two instances differ
 * only under declared targets; cap raises and kind escapes refuse; and
 * the instantiated parallel-analysis workflow is a NORMAL versioned
 * workflow that validates, lowers and passes its run oracle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createJSONPatch } from '@jarenjs/json/patch';
import {
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  instantiateMasTemplate,
  planMasWorkflow,
  validateMasWorkflow,
} from '@tangleai/mas';
import { driveAcyclicFixture } from '../../benchmark/lib/mas-runner.ts';
import type { FixtureDocument, FixtureScript, PositiveExpectation } from '../../benchmark/lib/mas-conformance.types.ts';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as { configCatalog: { path: string } };
const catalogOutcome = await createMasConfigCatalog(JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')));
const registryOutcome = await createMasRegistrySnapshot(JSON.parse(await readFile('benchmark/fixtures/mas/control-registry.json', 'utf8')));
assert.ok(catalogOutcome.valid && registryOutcome.valid);
const catalog = catalogOutcome.value;
const registry = registryOutcome.value;

const templateFixture = JSON.parse(await readFile('benchmark/fixtures/mas/templates/parallel-analysis.json', 'utf8')) as {
  template: Record<string, unknown>,
  instances: { a: Record<string, unknown>, b: Record<string, unknown> },
  run: { script: FixtureScript, expect: PositiveExpectation },
};

describe('parallel-analysis instantiation', () => {
  it('two instances differ only under declared targets (plus version and provenance metadata)', async () => {
    const a = await instantiateMasTemplate(templateFixture.template, templateFixture.instances.a);
    const b = await instantiateMasTemplate(templateFixture.template, templateFixture.instances.b);
    assert.ok(a.valid, JSON.stringify(!a.valid ? a.issues[0] : null));
    assert.ok(b.valid);
    assert.notEqual(a.value.workflow.versionId, b.value.workflow.versionId, 'different parameters, different semantic versions');

    const declared = (templateFixture.template.bindings as Array<{ targetPointer: string }>).map((binding) => binding.targetPointer);
    const metadata = ['/versionId', '/compile/sourceDesignRevision'];
    const changes = createJSONPatch(a.value.workflow, b.value.workflow);
    for (const change of changes) {
      const covered = [...declared, ...metadata].some((target) => change.path === target || change.path.startsWith(`${target}/`));
      assert.ok(covered, `'${change.path}' changed between instances but no binding declares it`);
    }
    assert.equal(a.value.templateVersionId, b.value.templateVersionId, 'one immutable template version fathered both');
    assert.notEqual(a.value.parametersRevision, b.value.parametersRevision);
  });

  it('a cap raise refuses TMAS1008 and a node-kind escape cannot validate', async () => {
    const raised = await instantiateMasTemplate(templateFixture.template, { ...templateFixture.instances.a, calls: 16 });
    assert.ok(!raised.valid, 'the fragment caps calls at 8; a parameter cannot raise it');
    assert.equal(raised.issues[0].code, 'TMAS1008');

    const escape = structuredClone(templateFixture.template) as { bindings: Array<{ parameterPointer: string, targetPointer: string, mode: string }> };
    escape.bindings.push({ parameterPointer: '/role', targetPointer: '/nodes/0/kind', mode: 'role' });
    const { versionId: _v, provenance: _p, ...semantic } = escape as Record<string, unknown>;
    const { canonicalSha256 } = await import('@jarenjs/json/canonical');
    (escape as Record<string, unknown>).versionId = await canonicalSha256(semantic);
    const kindChange = await instantiateMasTemplate(escape, templateFixture.instances.a);
    assert.ok(!kindChange.valid, 'replacing a node kind produces a document the closed schema refuses');
  });

  it('an undeclared parameter pointer leaves the target as authored', async () => {
    const partial = await instantiateMasTemplate(templateFixture.template, {
      role: 'analyst-alpha',
      instructionsRevision: (templateFixture.instances.a as { instructionsRevision: string }).instructionsRevision,
      calls: 8,
    });
    assert.ok(partial.valid);
    const node = partial.value.workflow.nodes[0] as { limits: { calls: number } };
    assert.equal(node.limits.calls, 8);
  });

  it('the instantiated workflow is a normal versioned workflow: validates, lowers and passes its run oracle', async () => {
    const instance = await instantiateMasTemplate(templateFixture.template, templateFixture.instances.a);
    assert.ok(instance.valid);
    const validated = await validateMasWorkflow(instance.value.workflow, registry, catalog);
    assert.ok(validated.valid, JSON.stringify(!validated.valid ? validated.issues[0] : null));
    const plan = await planMasWorkflow(validated.value);
    assert.ok(plan.valid);
    const fixture: FixtureDocument = {
      id: 'parallel-analysis-a',
      family: 'positive',
      title: 'parallel analysis, instance a',
      workflow: instance.value.workflow as unknown as Record<string, unknown>,
      script: templateFixture.run.script,
      expect: templateFixture.run.expect,
    };
    const drive = await driveAcyclicFixture(fixture, validated.value, plan.value, registry, catalog);
    assert.equal(drive.row.state, 'runtime-pass');
    assert.equal(drive.row.maxObservedConcurrency, 2, 'the two analysts overlap');
    assert.equal(drive.row.calls, 4, 'two turns per analyst, normalization included');
    assert.deepEqual(drive.output, { merged: [{ points: ['alpha analysis'] }, { points: ['second analysis'] }] }, 'declared edge order under reverse settle');
  });
});
