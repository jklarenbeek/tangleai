/** Trust derives from the host's resolved evidence and producer view, never prose. */
import { deepFreeze } from '@jarenjs/core/object';
import { validateExperientialShape } from './schema.ts';
import type { ExperientialExperience, ExperientialExclusionReason, ExperientialRef, ExperientialResolvedSource,
  ExperientialTrust, ExperientialTrustView } from './contracts.gen.ts';

const rawKinds = new Set(['web', 'web-page', 'retrieved-web', 'email', 'retrieved-chunk', 'tool-output', 'model-reflection']);
const address = (source: Pick<ExperientialRef, 'sourceId' | 'digest'>) => JSON.stringify([source.sourceId, source.digest]);
export interface ExperientialTaint {
  trust: ExperientialTrust;
  reasons: ExperientialExclusionReason[];
  independentOutcome: boolean;
  supportingIds: string[];
  producerId: string | null;
  taintedSourceIds: string[];
}

/** The caller supplies an admitted source view; this function does not fetch or confer authority. */
export function taintOf(experience: ExperientialExperience, lineage: ExperientialTrustView): ExperientialTaint {
  const reasons = new Set<ExperientialExclusionReason>(), tainted = new Set<string>();
  const checked = validateExperientialShape<ExperientialTrustView>('ExperientialTrustView', lineage);
  if (!checked.ok) return deepFreeze({ trust: 'untrusted', reasons: ['missing-source-id'], independentOutcome: false,
    supportingIds: [], producerId: null, taintedSourceIds: [] });
  const view = checked.value, sources = new Map<string, ExperientialResolvedSource>();
  for (const source of view.sources) {
    if (sources.has(address(source))) reasons.add('missing-source-id');
    sources.set(address(source), source);
  }
  const producers = view.producers.filter(p => p.identityId === experience.producingIdentityId);
  const producerId = producers.length === 1 ? producers[0].producerId : null;
  if (!producerId) reasons.add('missing-source-id');
  const visited = new Set<string>(), walking = new Set<string>();
  const inspect = (ref: ExperientialRef, inherited: boolean): void => {
    const key = address(ref), source = sources.get(key);
    if (!source || ref.kind !== source.kind) { reasons.add('missing-source-id'); return; }
    if (walking.has(key)) { reasons.add('tainted-lineage'); tainted.add(source.sourceId); return; }
    if (visited.has(key)) return;
    walking.add(key);
    if (source.scope !== experience.scope) reasons.add('cross-scope');
    if (source.privacy === 'private') reasons.add('private-scope');
    if (source.trust === 'untrusted' || rawKinds.has(source.kind)) {
      tainted.add(source.sourceId); reasons.add(inherited ? 'tainted-lineage' : 'untrusted-source');
    }
    for (const parent of source.parents) inspect(parent, true);
    walking.delete(key); visited.add(key);
  };
  for (const ref of [experience.taskRef, experience.inputRef, experience.outputRef, ...experience.sourceRefs]) inspect(ref, false);
  const outcome = experience.observedOutcome;
  const resolved = outcome ? sources.get(address(outcome)) : undefined;
  if (resolved) inspect(resolved, false);
  else if (outcome) reasons.add('missing-source-id');
  const selfJudged = !!outcome && (outcome.sourceId === producerId || resolved?.producerId === producerId);
  if (selfJudged) reasons.add('self-judged');
  const support = view.sources.filter(source => visited.has(address(source)) && !!producerId && source.producerId !== producerId
    && ['verified', 'operator'].includes(source.trust) && !rawKinds.has(source.kind) && source.scope === experience.scope
    && source.privacy !== 'private' && source.outcome?.contentDigest === experience.contentDigest
    && source.parents.length === 0);
  const independentOutcome = !!resolved && !selfJudged && support.includes(resolved)
    && resolved.outcome?.value === outcome!.value;
  if (!independentOutcome) reasons.add('no-independent-outcome');
  // Qualifying independent evidence may support the lesson, but never erases its tainted links.
  const trust: ExperientialTrust = independentOutcome && !reasons.has('missing-source-id')
    && !reasons.has('cross-scope') && !reasons.has('private-scope') ? resolved!.trust
    : (tainted.size || experience.trust === 'untrusted' || !independentOutcome ? 'untrusted' : experience.trust);
  return deepFreeze({ trust, reasons: [...reasons].sort(), independentOutcome,
    supportingIds: [...new Set(support.map(source => source.digest))].sort(), producerId, taintedSourceIds: [...tainted].sort() });
}
