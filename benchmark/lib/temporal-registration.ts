/** Freeze related evidence questions together before prompt or capability tuning. */
import { mulberry32, shuffle } from '@jarenjs/core/random';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { confirmationConversations } from './locomo-policy.ts';
import { LME_TYPES, lmeScope, opaqueLmeId, type LmeRawQuestion } from './longmemeval.ts';
import { LONGMEMEVAL_SOURCE, LONGMEMEVAL_FILES, sha256 } from './longmemeval-source.ts';

import { TEMPORAL_CONTROLS } from './temporal-controls.ts';
export { TEMPORAL_CONTROLS, TEMPORAL_ROWS, type TemporalRow } from './temporal-controls.ts';

export function registerTemporal(rows: readonly LmeRawQuestion[], locomoIds: readonly string[]) {
  const byIdentity = new Map<string, number[]>();
  rows.forEach((q, i) => {
    for (const identity of [`question:${q.question_id.replace(/_abs$/, '')}`, ...q.answer_session_ids.map(s => `evidence:${s}`)]) {
      const bucket = byIdentity.get(identity) ?? []; bucket.push(i); byIdentity.set(identity, bucket);
    }
  });
  const adjacency = rows.map(() => new Set<number>());
  for (const indices of byIdentity.values()) for (const i of indices.slice(1)) {
    adjacency[indices[0]].add(i); adjacency[i].add(indices[0]);
  }
  const visited = new Set<number>();
  const components: number[][] = [];
  rows.forEach((_, i) => {
    if (visited.has(i)) return;
    const component: number[] = [], pending = [i]; visited.add(i);
    while (pending.length) {
      const next = pending.pop()!; component.push(next);
      for (const neighbor of adjacency[next]) if (!visited.has(neighbor)) { visited.add(neighbor); pending.push(neighbor); }
    }
    components.push(component);
  });
  const groups = components.map(indices => {
    const members = indices.map(i => lmeScope(rows[i])).sort();
    return { id: opaqueLmeId(['group', members]), members, indices };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const developmentGroups = new Set(shuffle(mulberry32(TEMPORAL_CONTROLS.seed), groups.map(g => g.id)).slice(0, Math.ceil(groups.length * .2)));
  const folds = (['development', 'confirmation'] as const).map(name => {
    const selected = groups.filter(g => developmentGroups.has(g.id) === (name === 'development'));
    const indices = selected.flatMap(g => g.indices);
    return { name, groups: selected.length, questions: indices.length,
      members: selected.flatMap(g => g.members).sort(),
      types: Object.fromEntries(LME_TYPES.map(t => [t, indices.filter(i => rows[i].question_type === t).length])),
      abstentions: indices.filter(i => rows[i].question_id.includes('_abs')).length };
  });
  const confirmation = confirmationConversations(locomoIds);
  const body = { version: 1, source: LONGMEMEVAL_SOURCE, files: LONGMEMEVAL_FILES, controls: TEMPORAL_CONTROLS,
    groups: groups.map(({ id, members }) => ({ id, members })), folds, largestGroup: Math.max(0, ...groups.map(g => g.members.length)),
    locomo: { status: locomoIds.length ? 'available' : 'unavailable',
      development: locomoIds.filter(id => !confirmation.includes(id)).sort(), confirmation },
    pairs: [
      ['timestamp-context-only', 'legacy-default'], ['matched-pool-lane-off', 'timestamp-context-only'],
      ['observed-session-filter', 'matched-pool-lane-off'], ['validity-asof-on', 'matched-pool-lane-off'],
      ['full-kernel', 'validity-asof-on'], ['full-kernel', 'matched-pool-lane-off'],
    ],
  };
  return { ...body, sha256: sha256(canonicalizeJson(body)) };
}
export type TemporalRegistration = ReturnType<typeof registerTemporal>;
