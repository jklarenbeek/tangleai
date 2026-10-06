/** Source binding is shared by the instrument and its read-only artifact consumer. */
import { sourceManifest } from './source-manifest.ts';
import { loadResearchFixture, RESEARCH_FIXTURE_PATH, MANIFEST_PATH, type LoadedResearchFixture } from './research-fixture.ts';
export const SOURCE_MANIFEST = [
  'package.json', 'package-lock.json', 'benchmark/research.ts', MANIFEST_PATH,
  'benchmark/scripts/research-fixtures.ts', 'scripts/research-schema.ts',
  'benchmark/lib/research.ts', 'benchmark/lib/research-source.ts', 'benchmark/lib/research-schema.ts', 'benchmark/lib/research.types.ts',
  'benchmark/lib/research-fixture.ts', 'benchmark/lib/research-programs.ts', 'benchmark/lib/research-evaluator.ts',
  'benchmark/lib/research-oracle.ts', 'benchmark/lib/research-runner.ts', 'benchmark/lib/research-validation.ts',
  'benchmark/lib/research-workflow.ts', 'benchmark/lib/research-lifecycle-fixture.ts', 'examples/research.ts',
  'benchmark/lib/research-discovery.ts', 'benchmark/lib/research-discovery-fixture.ts', 'benchmark/scripts/research-transcripts.ts',
  'benchmark/lib/research-reasoning.ts', 'benchmark/lib/research-reasoning-fixture.ts', 'scripts/research-artifacts.ts', 'scripts/research-sources.ts',
  'benchmark/lib/research-execution.ts', 'benchmark/lib/research-execution-fixture.ts',
  'apps/research-runner/src/domains.ts',
  'benchmark/lib/research-domains.ts', 'benchmark/lib/research-domains-schema.ts', 'benchmark/lib/research-domains.types.ts',
  'benchmark/lib/research-domain-inputs.ts', 'benchmark/lib/research-domain-runtime.ts', 'benchmark/lib/research-domain-probes.ts',
  'benchmark/lib/research-tabular-fixture.ts', 'benchmark/scripts/tabular-statistics-fixture.ts',
  'benchmark/lib/research-arc.ts', 'benchmark/lib/research-arc-schema.ts', 'benchmark/schemas/arc-bench-topic.schema.json',
  'benchmark/schemas/research-domains.schema.json', 'scripts/research-domains-schema.ts', 'scripts/research-domain-artifacts.ts',
  'prompts/research/domains/tabular-context.toml',
  'benchmark/lib/research-decisions.ts', 'benchmark/lib/research-decision-fixture.ts', 'benchmark/lib/research-statistics.ts',
  'benchmark/lib/research-writing.ts', 'benchmark/lib/research-writing-fixture.ts', 'benchmark/lib/research-latex.ts',
  'benchmark/lib/research-lessons.ts', 'benchmark/lib/research-lessons-oracle.ts', 'benchmark/lib/research-lessons-fixture.ts',
  'benchmark/lib/research-lessons-schema.ts', 'benchmark/lib/research-lessons.types.ts', 'benchmark/schemas/research-lessons.schema.json',
  'scripts/research-schema-dependencies.ts', 'scripts/research-contracts.ts', 'scripts/research-lessons-schema.ts', 'scripts/research-schema.ts',
  'benchmark/lib/locomo-policy.ts',
  'benchmark/lib/research-ablation.ts', 'benchmark/lib/research-ablation-rows.ts', 'benchmark/lib/research-ablation-schema.ts',
  'benchmark/lib/research-ablation.types.ts', 'benchmark/schemas/research-ablation.schema.json', 'scripts/research-ablation-schema.ts',
  'benchmark/lib/research-audit.ts', 'benchmark/lib/research-audit-schema.ts', 'benchmark/lib/research-audit.types.ts',
  'benchmark/schemas/research-audit.schema.json', 'scripts/research-audit-schema.ts',
  'benchmark/research-query.ts', 'benchmark/lib/research-handoff.ts', 'queries/research/core-baseline.json',
  'benchmark/lib/args.ts', 'benchmark/lib/validate.ts', 'benchmark/lib/source-manifest.ts',
  'benchmark/lib/suite-packages.ts', 'benchmark/lib/report-envelope.ts', 'benchmark/lib/table.ts',
  'packages/research/schemas/research.schema.json', 'benchmark/schemas/research.schema.json',
] as const;

export async function researchSource(root: string, fixture?: LoadedResearchFixture) {
  const loaded = fixture ?? await loadResearchFixture(root);
  return sourceManifest(root, [...SOURCE_MANIFEST, ...loaded.manifest.members.map(member => RESEARCH_FIXTURE_PATH + '/' + member.path)],
    [RESEARCH_FIXTURE_PATH, 'packages/core', 'packages/models', 'packages/documents', 'packages/search', 'packages/context', 'packages/config',
      'packages/jaren', 'packages/research', 'packages/gmpl', 'packages/mas', 'packages/store', 'packages/agents', 'packages/evolve', 'packages/trace2skill', 'packages/outcomes']);
}
