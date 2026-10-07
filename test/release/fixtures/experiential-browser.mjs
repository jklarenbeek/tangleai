import { canaryShareOf, validateExperientialRecord, createExperientialMemoryStore,
  createExperientialOperations } from '@tangleai/experiential';
import schema from '@tangleai/experiential/schemas/experiential' with { type: 'json' };
import contract from '@tangleai/experiential/schemas/contract' with { type: 'json' };

export async function qualifyExperientialBrowser() {
  const invalid = validateExperientialRecord('experience', { state: 'unknown' });
  if (invalid.ok || !schema.$defs.ExperientialExperience) throw Error('Installed experiential schema failed closed validation');
  const share = await canaryShareOf('a'.repeat(64), 'installed-browser');
  if (!(share >= 0 && share < 1) || share !== await canaryShareOf('a'.repeat(64), 'installed-browser'))
    throw Error('Installed canary assignment is not stable');
  const store = createExperientialMemoryStore({ now: () => '2026-09-13T00:00:00.000Z' }), operations = createExperientialOperations(store);
  try {
    const read = await operations.invoke('experiential.artifacts', { scope: 'installed-browser' });
    if (!read.ok || !read.value.ok || read.value.value.length !== 0) throw Error('Installed read operation failed');
    return { operations: Object.keys(contract.operations).length, schemaClosed: true, stableShare: true, writes: store.stats().writes };
  } finally { await operations.close(); await store.close(); }
}
