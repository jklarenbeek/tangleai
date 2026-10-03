/** Registered synthetic geometry, using the shipped candidate owner and native physical trials. */
import { mulberry32 } from '@jarenjs/core/random';
import { geohashEncode, geohashNeighbours, geohashBounds, bboxUnion, bboxPolygon, circleBounds, bboxContains, geoDistance } from '@jarenjs/core/geo';
import { compareCodePoints } from '@jarenjs/core/string';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { openStore } from '@jarenjs/db';
import { pickDriver } from '@tangleai/store';
import { entriesInPlaceCells } from '../../packages/memory/src/place/candidates.ts';
import { PLACE_COLLECTIONS } from '../../packages/store/src/place-model.ts';
import { asRows } from '../../packages/store/src/memory-store.ts';
import { latency } from './stats.ts';
import type { PlaceScaleReceipt, ScaleMeasurement, ScalePhase, ScaleWorker } from './place-report.types.ts';

export type PlaceScaleRegistration = Omit<PlaceScaleReceipt['registration'], 'entries' | 'probes'> & { entries: number; probes: number };
export type PlaceScaleShape = ScaleMeasurement['shape'];
export interface SyntheticPlace { id: string; geometry: { type: 'Point'; coordinates: [number, number] }; source: { kind: 'synthetic' }; }
export interface PlaceScaleProbe { id: string; centre: SyntheticPlace; cells: string[]; bounds: [number, number, number, number]; }
export interface PlaceScaleWorkload { entries: SyntheticPlace[]; probes: PlaceScaleProbe[]; id: string; }

export async function placeScaleWorkload(registration: PlaceScaleRegistration): Promise<PlaceScaleWorkload> {
  if (!Number.isSafeInteger(registration.entries) || registration.entries < 1 || !Number.isSafeInteger(registration.probes) || registration.probes < 1 ||
    registration.precision !== 6 || !Number.isFinite(registration.radiusMetres) || registration.radiusMetres <= 0) throw Error('invalid place scale workload');
  const random = mulberry32(registration.seed);
  const entries: SyntheticPlace[] = Array.from({ length: registration.entries }, (_, index) => ({ id: `synthetic-${String(index).padStart(6, '0')}`,
    geometry: { type: 'Point', coordinates: [-150 + random() * 300, -50 + random() * 100] }, source: { kind: 'synthetic' } }));
  const probes = Array.from({ length: registration.probes }, (_, index) => {
    const centre = entries[Math.floor(random() * entries.length)], cells = geohashNeighbours(geohashEncode(...centre.geometry.coordinates, registration.precision));
    const bounds = cells.map(cell => geohashBounds(cell)!).reduce((a, b) => bboxUnion(a, b));
    const circle = circleBounds(...centre.geometry.coordinates, registration.radiusMetres);
    if (cells.length !== 9 || !circle || !bboxContains(bounds, circle[0], circle[1]) || !bboxContains(bounds, circle[2], circle[3])) throw Error('registered scale probe exceeds its nine cells');
    return { id: `probe-${index}`, centre, cells, bounds: [bounds[0], bounds[1], bounds[2], bounds[3]] as [number, number, number, number] };
  });
  return { entries, probes, id: await canonicalSha256({ entries, probes }) };
}

export async function placeScaleResult(probe: PlaceScaleProbe, candidates: readonly SyntheticPlace[], radiusMetres: number) {
  const ids = candidates.map(entry => entry.id).sort(compareCodePoints), refined: string[] = [];
  for (const entry of candidates) {
    if (entry.id === probe.centre.id) continue;
    const distance = geoDistance(probe.centre.geometry, entry.geometry);
    if (distance === null || !Number.isFinite(distance)) throw Error('synthetic candidate has no native distance');
    if (distance <= radiusMetres) refined.push(entry.id);
  }
  refined.sort(compareCodePoints);
  return { candidates: ids.length, refined: refined.length, resultSha256: await canonicalSha256({ candidates: ids, refined }) };
}

/** A private experimental collection never admits synthetic sources through the public gazetteer API. */
function scaleModel(shape: PlaceScaleShape) {
  const base = PLACE_COLLECTIONS.place_gazetteer;
  return { $model: '0.1', collections: { place_gazetteer: { ...base,
    schema: { ...base.schema, properties: { ...base.schema.properties, payload: { type: 'object', properties: {
      geometry: { type: 'object', properties: { type: { const: 'Point' }, coordinates: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } } },
    } } } },
    indexes: [...base.indexes, ...(shape === 'sweep' ? [] : [{ name: 'by_geometry', path: '$.payload.geometry', derive: 'bbox', ...(shape === 'rtree' ? { physical: 'rtree' } : {}) }])],
  } } };
}
function scaleQuery(probe: PlaceScaleProbe) {
  return { $for: { r: '$[*]' }, $where: { $and: [{ $eq: ['$r.recordType', 'entry'] },
    { '$bbox-intersects': ['$r.payload.geometry', { $const: bboxPolygon(probe.bounds) }] }] }, $return: '$r.payload' };
}
export function placeScalePhase(samples: ScalePhase['samples']): ScalePhase {
  const measured = latency(samples.map(sample => sample.ms));
  if (measured.medianMs === null || measured.p95Ms === null) throw Error('a scale phase needs measured samples');
  return { p50Ms: measured.medianMs, p95Ms: measured.p95Ms, samples };
}

export async function measurePlaceScaleShape(shape: PlaceScaleShape, registration: PlaceScaleRegistration, timer: () => number): Promise<ScaleWorker> {
  const workload = await placeScaleWorkload(registration), driver = pickDriver();
  const capability = await openStore(scaleModel('sweep'), { driver });
  const rtree = capability.capabilities.rtree;
  await capability.close();
  if (typeof rtree !== 'boolean') throw Error('native SQLite did not report its R-tree capability');
  const identity = { document: 'place-scale-worker' as const, runtime: process.versions.bun ? 'bun' as const : 'node' as const,
    version: process.versions.bun ?? process.versions.node, platform: `${process.platform}/${process.arch}`, rtree,
    registrationId: await canonicalSha256(registration), workloadId: workload.id };
  if (shape === 'rtree' && !rtree) return { ...identity, measurement: null, unavailable: 'native SQLite capability rtree=false' };
  const db = shape === 'sweep' ? null : await openStore(scaleModel(shape), { driver });
  try {
    let explain: ScaleMeasurement['explain'] = null;
    if (db) {
      await db.transaction(async tx => {
        const collection = tx.collection('place_gazetteer');
        for (const entry of workload.entries) await collection.put({ id: entry.id, gazetteerId: 'synthetic-scale', revision: workload.id, recordType: 'entry',
          payload: entry, lon: entry.geometry.coordinates[0], lat: entry.geometry.coordinates[1], cell6: geohashEncode(...entry.geometry.coordinates, registration.precision) });
        await collection.put({ id: 'header', gazetteerId: 'synthetic-scale', revision: workload.id, recordType: 'gazetteer', payload: { id: 'synthetic-scale' } });
      }, { mode: 'immediate' });
      const plan = await db.collection('place_gazetteer').explain(scaleQuery(workload.probes[0]));
      const via = shape === 'bbox' ? 'columns' : 'rtree';
      if (!plan || typeof plan !== 'object' || !('prefilters' in plan) || !Array.isArray(plan.prefilters) ||
        !plan.prefilters.some(filter => filter && filter.construct === '$bbox-intersects' && filter.via === via)) throw Error(`native ${shape} trial did not use its declared prefilter`);
      explain = JSON.parse(JSON.stringify(plan)) as Record<string, unknown>;
    }
    const expected = new Map<string, Awaited<ReturnType<typeof placeScaleResult>>>();
    async function query(probe: PlaceScaleProbe) {
      const start = timer();
      const candidates = db ? entriesInPlaceCells(asRows(await db.collection('place_gazetteer').execute<SyntheticPlace>(scaleQuery(probe))), probe.cells, registration.precision)
        : entriesInPlaceCells(workload.entries, probe.cells, registration.precision);
      const ms = timer() - start;
      if (!Number.isFinite(ms) || ms < 0) throw Error('place scale clock must be finite and monotonic');
      const result = await placeScaleResult(probe, candidates, registration.radiusMetres);
      if (!expected.has(probe.id)) expected.set(probe.id, await placeScaleResult(probe, entriesInPlaceCells(workload.entries, probe.cells, registration.precision), registration.radiusMetres));
      if (canonicalizeJson(result) !== canonicalizeJson(expected.get(probe.id))) throw Error('native physical candidates differ from the exact sweep');
      return { probeId: probe.id, ms, ...result };
    }
    const cold: ScalePhase['samples'] = [], warm: ScalePhase['samples'] = [];
    for (const probe of workload.probes) cold.push(await query(probe));
    for (let index = 0; index < registration.warmups; index++) await query(workload.probes[index % workload.probes.length]);
    for (const probe of workload.probes) warm.push(await query(probe));
    return { ...identity, unavailable: null, measurement: { shape, via: shape === 'sweep' ? 'memory' : shape === 'bbox' ? 'columns' : 'rtree', explain,
      cold: placeScalePhase(cold), warm: placeScalePhase(warm) } };
  } finally { await db?.close(); }
}
