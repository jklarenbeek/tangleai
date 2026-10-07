import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXPERIENTIAL_COLLECTIONS } from '@tangleai/store';

it('keeps experiential identifiers and all thirteen persistence collections distinct', async () => {
  const root = new URL('../../packages/experiential/', import.meta.url);
  for (const path of await readdir(root, { recursive: true })) {
    if (!/\.(ts|json|md)$/.test(path) || path.startsWith('node_modules/')) continue;
    const text = await readFile(new URL(path, root), 'utf8');
    assert.ok(!/\bConsolidation[A-Z]|\bconsolidation_/.test(text), join('packages/experiential', path));
  }
  assert.deepEqual(Object.keys(EXPERIENTIAL_COLLECTIONS).sort(), [
    'experiential_experiences', 'experiential_assessments', 'experiential_datasets', 'experiential_training_runs',
    'experiential_artifacts', 'experiential_evaluations', 'experiential_gate_policies', 'experiential_approvals',
    'experiential_deployments', 'experiential_pins', 'experiential_retention_decisions', 'experiential_events', 'experiential_heads',
  ].sort());
});
