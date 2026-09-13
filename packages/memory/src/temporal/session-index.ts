/** Observation precision buckets, cached per immutable projection. They never describe fact validity. */
import { createIntervalIndex, compileBuckets } from '@jarenjs/core/series';
import { temporalIdentity, refuse, success, type TemporalResult, type TemporalSnapshot } from './contracts.ts';
import { temporalInstant } from './time.ts';
import type { TemporalStore } from './store.ts';
export function createTemporalSessionIndex(store: TemporalStore) {
  const cache = new Map<string, Promise<TemporalResult<ReturnType<typeof build>>>>();
  let constructions = 0;
  function build(snapshot: TemporalSnapshot, identity: string) {
    const points = new Map<number, string[]>(), buckets: { start: number; end: number; id: string }[] = [];
    for (const source of snapshot.sources) {
      const stamp = source.observedAt, instant = temporalInstant(stamp.at);
      if (instant.status !== 'success') throw Error(instant.detail);
      if (stamp.precision === 'millisecond') { const at = points.get(instant.value) ?? []; at.push(source.id); points.set(instant.value, at); }
      else {
        const widths = { second: 'PT1S', minute: 'PT1M', day: 'P1D', month: 'P1M', year: 'P1Y' };
        const ladder = compileBuckets(widths[stamp.precision], { offset: stamp.offsetMinutes });
        const position = ladder.indexOf(instant.value);
        buckets.push({ start: ladder.startOf(position), end: ladder.startOf(position + 1), id: source.id });
      }
    }
    const index = createIntervalIndex(buckets); constructions++;
    return { identity, versionId: snapshot.projection.versionId, sourceCount: snapshot.sources.length, complete: snapshot.projection.complete,
      at(at: number): string[] { return [...new Set([...(points.get(at) ?? []), ...index.at(at).map((r: { id: string }) => r.id)])].sort(); },
      overlaps(from: number, until: number): string[] {
        return [...new Set([...points].filter(([at]) => at >= from && at < until).flatMap(([, ids]) => ids).concat(index.overlapping(from, until).map((r: { id: string }) => r.id)))].sort();
      } };
  }
  return {
    stats: () => ({ constructions, cachedVersions: cache.size }),
    async get(scope: string) {
      const head = await store.head(scope); if (head.status !== 'success') return head;
      if (!head.value) return refuse('incomplete-index', 'no active observation projection');
      const captured = head.value, key = `${scope}:${captured.versionId}`;
      let pending = cache.get(key);
      if (!pending) {
        pending = (async () => {
          const snapshot = await store.snapshot(scope, captured); if (snapshot.status !== 'success') return snapshot;
          try { return success(build(snapshot.value, await temporalIdentity({ view: snapshot.value.projection.viewIdentity, sources: snapshot.value.projection.occurrenceIds, policy: 'observation-precision-v1' }))); }
          catch (cause) { return refuse('invalid-time', `invalid observation bucket: ${String(cause)}`); }
        })();
        cache.set(key, pending);
      }
      const result = await pending;
      if (result.status !== 'success') cache.delete(key);
      return result;
    },
  };
}
