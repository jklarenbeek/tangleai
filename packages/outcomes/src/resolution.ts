/** Accepted evidence is a verified host snapshot, independent of scoring. */
import { equalsJson } from '@jarenjs/core/object';
import { checkShape, checkTime, jsonBytes } from './schema.ts';
import { outcomeRevision } from './identity.ts';
import { reject } from './errors.ts';
import { putRecord, unique } from './persistence.ts';
import { recordOf, requireNew, seal } from './service-context.ts';
import type { ServiceContext } from './service-context.ts';
import type { OutcomeTransaction } from './store.ts';
import type { Source, SourceRef, ResolveCommand } from './outcomes.contracts.gen.ts';

export async function verifiedSource(context: ServiceContext, reference: SourceRef, earliest: string, receivedAt: string): Promise<Source> {
  const loaded = await context.resolver.resolve(reference, context.scope);
  if (!loaded) reject('OUTC1006', 'The trusted resolver cannot supply the pinned source.');
  const source = checkShape<Source>('source', loaded);
  if (source.scopeId !== context.scopeId || source.subject !== context.scope.subject) reject('OUTC1003', 'Evidence belongs to another scope or subject.');
  const { digest, ...bytes } = source;
  if (source.sourceId !== reference.sourceId || digest !== reference.digest || await outcomeRevision(bytes) !== digest) reject('OUTC1006', 'Evidence bytes differ from the pinned source.');
  checkTime(source.observedAt); checkTime(receivedAt);
  if (source.observedAt < earliest || receivedAt < source.observedAt) reject('OUTC1006', 'Evidence observation is outside the accepted time interval.');
  if (jsonBytes(source as unknown as import('./outcomes.contracts.gen.ts').Json) > 32768) reject('OUTC1006', 'Evidence snapshot exceeds 32,768 canonical UTF-8 bytes.');
  return source;
}
export async function prepareResolution(context: ServiceContext, c: ResolveCommand) {
  const decision = await context.atomic().transaction(async tx => {
    await requireNew(tx, c.scopeId, 'resolution', c.input.decisionId);
    return recordOf(tx, c.input.decisionId, c.scopeId, c.artifactKey, 'decision');
  });
  const { domain } = context.adapter(decision.adapter);
  if (new Set(c.input.evidence.map(r => r.sourceId)).size !== c.input.evidence.length) reject('OUTC1001', 'Evidence references must be unique.');
  if (c.at < c.input.receivedAt) reject('OUTC1006', 'Receipt time precedes evidence arrival.');
  const sources: Source[] = [];
  for (const reference of c.input.evidence) {
    const source = await verifiedSource(context, reference, decision.decidedAt, c.input.receivedAt);
    if (source.decisionId !== decision.id) reject('OUTC1003', 'Evidence was observed for another decision.');
    sources.push(source);
  }
  const payload = domain.resolution(sources[0].payload);
  if (jsonBytes(sources as unknown as import('./outcomes.contracts.gen.ts').Json) > 32768) reject('OUTC1006', 'Combined evidence snapshots exceed 32,768 canonical UTF-8 bytes.');
  for (const source of sources) if (!equalsJson(domain.resolution(source.payload), payload)) reject('OUTC1006', 'Sources disagree on the accepted outcome.');
  return { decision, sources: sources.sort((a, b) => a.sourceId < b.sourceId ? -1 : 1), payload };
}
export async function commitResolution(tx: OutcomeTransaction, context: ServiceContext, c: ResolveCommand, data: Awaited<ReturnType<typeof prepareResolution>>) {
  await requireNew(tx, c.scopeId, 'resolution', c.input.decisionId);
  const resolution = await seal('resolution', c.scopeId, c.artifactKey, c.at, {
    decisionId: data.decision.id, resolverRevision: context.resolverRevision, sources: data.sources,
    payload: data.payload, receivedAt: c.input.receivedAt,
    late: data.decision.expectedResolutionAt === null ? null : c.input.receivedAt > data.decision.expectedResolutionAt,
    resolutionSchema: data.decision.adapter.resolutionSchema,
  });
  await putRecord(tx, resolution); await unique(tx, c.scopeId, 'resolution', data.decision.id, resolution.id);
  return { resolutionId: resolution.id };
}
