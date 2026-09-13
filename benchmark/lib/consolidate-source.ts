/** Effective file bytes, independent of whether a reviewed order is committed. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { sourceManifest } from './source-manifest.ts';
export async function consolidateSourceHash(root = process.cwd()): Promise<string> {
  const source = await sourceManifest(root,
    ['benchmark/consolidate.ts', 'benchmark/scripts/consolidation-store.ts', 'scripts/runtime-fixture.ts', 'scripts/consolidation-schema.ts', 'benchmark/registrations/consolidate.json', 'benchmark/schemas/consolidate-report.schema.json'],
    ['benchmark/lib', 'packages/core', 'packages/memory', 'packages/context', 'packages/agents', 'packages/store', 'packages/models']);
  return canonicalSha256({ files: source.files });
}
