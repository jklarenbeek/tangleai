/** Native model diffs and shadow validation own physical graph column changes. */
import { planModelMigration, sqliteDialect, checkMigrationDocument, migrate, migrationStatus,
  type Driver, type MigrationTarget, type BorrowedMigrationTarget, type MigrateOptions } from '@jarenjs/db';
import { JarenValidator } from '@jarenjs/validate';
import { equalsJson } from '@jarenjs/core/object';
import { immutableLightRagJson } from '@tangleai/lightrag';
import { createTangleDbModel } from './model.ts';
import { assertGraphVectorDeclaration, GRAPH_VECTOR_COLLECTIONS, GraphVectorRefusal, type GraphVectorDeclaration } from './graph-vector-model.ts';
import { GRAPH_VECTOR_STATE_KEY, validateGraphVectorState, type GraphVectorState } from './graph-vector-state.ts';

interface NativeGraphMigration {
  $migration: string; id: string; from: string; to: string;
  steps: Array<{ kind: string; collection?: string; draft?: boolean; [key: string]: unknown }>;
}
export interface GraphVectorMigrationPlan {
  before: GraphVectorDeclaration | null;
  after: GraphVectorDeclaration;
  migration: NativeGraphMigration;
  removedWidths: number[];
  dropState?: GraphVectorState;
}
export function planGraphVectorMigration(before: GraphVectorDeclaration | null, after: GraphVectorDeclaration, id: string,
  options: { dropState?: GraphVectorState } = {}): GraphVectorMigrationPlan {
  if (before !== null) assertGraphVectorDeclaration(before);
  assertGraphVectorDeclaration(after);
  if (!id.trim()) throw new TypeError('A saved graph migration requires an id.');
  const removedWidths = (before?.widths ?? []).filter(width => !after.widths.includes(width));
  let dropState: GraphVectorState | undefined;
  if (removedWidths.length) {
    if (!options.dropState) throw new GraphVectorRefusal('TVEC1003', 'Column removal requires the current retained identity state.');
    dropState = validateGraphVectorState(options.dropState);
    if (!equalsJson(dropState.active, after.active) || [dropState.active, ...dropState.retained.map(row => row.identity)].some(identity => removedWidths.includes(identity.dims)))
      throw new GraphVectorRefusal('TVEC1003', 'An active or retained rollback still requires the graph column.');
  } else if (options.dropState) throw new GraphVectorRefusal('TVEC1003', 'A column-add plan cannot carry a removal precondition.');
  try {
    const planned = planModelMigration(createTangleDbModel({ graphVectors: before ?? undefined }),
      createTangleDbModel({ graphVectors: after }), { dialect: sqliteDialect, id }) as { migration: NativeGraphMigration;
        report: { added: unknown[]; removed: unknown[]; schemaChanged: string[]; drafts: string[] } };
    if (planned.report.added.length || planned.report.removed.length
      || planned.report.schemaChanged.some(name => !(GRAPH_VECTOR_COLLECTIONS as readonly string[]).includes(name)))
      throw new TypeError('The graph diff changed unrelated physical ownership.');
    // The only schema change types the existing optional embedding member.
    // Native final-state validation checks every retained row; no JSON rewrite
    // is required or permitted for this declaration-only transition.
    const migration = { ...planned.migration, steps: planned.migration.steps.filter(step => {
      if (!step.draft) return true;
      if (before !== null || step.kind !== 'jslt' || !step.collection
        || !(GRAPH_VECTOR_COLLECTIONS as readonly string[]).includes(step.collection)
        || !equalsJson(step.stylesheet, [])) throw new TypeError('An unexpected native schema draft needs a reviewed transform.');
      return false;
    }) };
    if (dropState) migration.steps.unshift(
      { kind: 'query', collection: 'settings', expect: 'ebv', assert: { $eq: [{ $count: { $for: { r: '$[*]' },
        $where: { $and: [{ $eq: ['$r.key', GRAPH_VECTOR_STATE_KEY] }, { $eq: ['$r.value', { $const: dropState }] }] }, $return: '$r' } }, 1] } },
      ...GRAPH_VECTOR_COLLECTIONS.map(collection => ({ kind: 'query', collection, expect: 'empty', assert: { $for: { r: '$[*]' },
        $where: { $and: [{ $eq: ['$r.status', 'active'] }, { $or: removedWidths.map(width => ({ $eq: ['$r.payload.embeddedBy.dims', width] })) }] }, $return: '$r.id' } })),
      { kind: 'query', collection: 'settings', expect: 'empty', assert: { $for: { r: '$[*]' }, $where: { $and: [
        { $eq: ['$r.value.document', 'graph-vector-stage-reservation'] }, { $eq: ['$r.value.status', 'pending'] },
        { $some: { width: '$r.value.widths[*]' }, $satisfies: { $or: removedWidths.map(width => ({ $eq: ['$width', width] })) } },
      ] }, $return: '$r.key' } },
    );
    checkMigrationDocument(migration);
    return immutableLightRagJson({ before, after, migration, removedWidths, ...(dropState ? { dropState } : {}) });
  } catch (cause) { throw new GraphVectorRefusal('TVEC1004', 'The native graph column migration could not be planned.', { cause }); }
}
export function graphVectorMigrationOptions(baseline: GraphVectorDeclaration | null, after: GraphVectorDeclaration, driver: Driver,
  options: Pick<MigrateOptions, 'dryRun' | 'shadowFixture' | 'onProgress'> = {}): MigrateOptions {
  return { baseline: createTangleDbModel({ graphVectors: baseline ?? undefined }), model: createTangleDbModel({ graphVectors: after }),
    shadowDriver: driver, dryRun: options.dryRun, shadowFixture: options.shadowFixture, onProgress: options.onProgress,
    compileSchema: schema => new JarenValidator({ skipErrors: false, collectErrors: true }).compile(schema as Record<string, unknown>) };
}
export async function applyGraphVectorMigrations(target: MigrationTarget | BorrowedMigrationTarget, plans: readonly GraphVectorMigrationPlan[],
  options: { baseline: GraphVectorDeclaration | null; driver: Driver; dryRun?: boolean; shadowFixture?: MigrateOptions['shadowFixture'] }) {
  if (!plans.length) throw new TypeError('A saved graph migration chain is required.');
  const source = { ...target }, { baseline, driver, dryRun, shadowFixture } = options;
  const saved = plans.map((plan, index) => {
    const expected = planGraphVectorMigration(plan.before, plan.after, plan.migration.id, { dropState: plan.dropState });
    if (!equalsJson(expected, plan) || index > 0 && !equalsJson(plans[index - 1].after, plan.before))
      throw new GraphVectorRefusal('TVEC1003', 'The saved graph migration or source chain differs from its native plan.');
    if (plan.removedWidths.length && !shadowFixture)
      throw new GraphVectorRefusal('TVEC1003', 'Column removal requires a shadow fixture with its reviewed retained-state precondition.');
    return expected;
  });
  if (!equalsJson(saved[0].before, baseline)) throw new GraphVectorRefusal('TVEC1003', 'The graph migration baseline differs.');
  const native = graphVectorMigrationOptions(baseline, saved.at(-1)!.after, driver, { dryRun, shadowFixture });
  try {
    const migrations = saved.map(plan => plan.migration), statusOptions = { model: native.model, shadowDriver: driver };
    const result = await (source.driver ? migrate(source, migrations, native) : migrate(source, migrations, native));
    const status = dryRun ? null : await (source.driver
      ? migrationStatus(source, migrations, statusOptions) : migrationStatus(source, migrations, statusOptions));
    if (status && !status.upToDate) throw new GraphVectorRefusal('TVEC1004', 'Native graph migration status reports physical drift.', { cause: status });
    return { result, status };
  } catch (cause) {
    if (cause instanceof GraphVectorRefusal) throw cause;
    throw new GraphVectorRefusal('TVEC1004', 'The native graph migration refused; the native cause is retained.', { cause });
  }
}
