/** Frozen timing observations are verified separately from deterministic conformance. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { entriesInPlaceCells } from '../../packages/memory/src/place/candidates.ts';
import { placeScaleWorkload, placeScaleResult, placeScalePhase, type PlaceScaleShape } from './place-scale.ts';
import { sourceManifest } from './source-manifest.ts';
import { requirePlaceShape } from './place-validation.ts';
import type { FixtureManifest, PlaceIndex, PlaceScaleReceipt, ScaleRuntime } from './place-report.types.ts';
import manifest from '../fixtures/place/manifest.json' with { type: 'json' };

export const PLACE_SCALE_REGISTRATION = (manifest as FixtureManifest).scale;
export const PLACE_SCALE_RECEIPT = 'benchmark/receipts/place-scale.json';
const shapes: PlaceScaleShape[] = ['sweep', 'bbox', 'rtree'];
const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);

export async function placeScaleSource(root = process.cwd()): Promise<PlaceScaleReceipt['source']> {
  const source = await sourceManifest(root, ['benchmark/place-scale.ts', 'benchmark/lib/place-scale.ts', 'benchmark/lib/place-scale-receipt.ts',
    'benchmark/lib/place-validation.ts', 'benchmark/lib/place-report.types.ts', 'benchmark/lib/stats.ts', 'benchmark/lib/source-manifest.ts',
    'benchmark/lib/args.ts', 'benchmark/lib/validate.ts', 'benchmark/schemas/place.schema.json', 'benchmark/fixtures/place/manifest.json',
    'packages/memory/src/place/candidates.ts', 'packages/store/src/place-model.ts', 'packages/store/src/db.ts', 'packages/store/src/memory-store.ts']);
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as { packages: Record<string, { version: string; integrity: string }> };
  const native = await Promise.all(['core', 'db', 'json', 'validate'].map(async name => {
    const key = `@jarenjs/${name}`, pinned = lock.packages[`node_modules/${key}`];
    const installed = JSON.parse(await readFile(join(root, `node_modules/${key}/package.json`), 'utf8')) as { version: string };
    if (!pinned?.integrity || pinned.version !== installed.version) throw Error(`place scale native dependency differs: ${key}`);
    return { name: key, version: pinned.version, integrity: pinned.integrity };
  }));
  const body = { files: source.files, native };
  return { ...body, sha256: await canonicalSha256(body) };
}

export function placeScaleDecision(runtimes: readonly ScaleRuntime[], target: number): Pick<PlaceScaleReceipt, 'decision' | 'targetMet'> {
  const measured = runtimes.filter(runtime => runtime.status === 'measured');
  for (const shape of shapes) if (measured.length && measured.every(runtime => runtime.rows[shape] !== null && runtime.rows[shape]!.warm.p95Ms <= target)) {
    return { decision: shape, targetMet: true };
  }
  return { decision: 'sweep', targetMet: false };
}
export function placeScaleIndex(receipt: PlaceScaleReceipt): PlaceIndex {
  return { decision: receipt.decision, targetMet: receipt.targetMet, targetP95Ms: receipt.registration.targetP95Ms,
    receiptSha256: receipt.sha256, measured: {
      sweep: receipt.runtimes.filter(runtime => runtime.rows.sweep !== null).map(runtime => runtime.runtime),
      bbox: receipt.runtimes.filter(runtime => runtime.rows.bbox !== null).map(runtime => runtime.runtime),
      rtree: receipt.runtimes.filter(runtime => runtime.rows.rtree !== null).map(runtime => runtime.runtime),
    } };
}

let expectedPromise: Promise<{ workloadId: string; probes: Map<string, Awaited<ReturnType<typeof placeScaleResult>>> }> | undefined;
function expectedScale() {
  return expectedPromise ??= (async () => {
    const workload = await placeScaleWorkload(PLACE_SCALE_REGISTRATION), probes = new Map<string, Awaited<ReturnType<typeof placeScaleResult>>>();
    for (const probe of workload.probes) probes.set(probe.id, await placeScaleResult(probe,
      entriesInPlaceCells(workload.entries, probe.cells, PLACE_SCALE_REGISTRATION.precision), PLACE_SCALE_REGISTRATION.radiusMetres));
    return { workloadId: workload.id, probes };
  })();
}

export async function validatePlaceScaleReceipt(input: unknown, root = process.cwd()): Promise<PlaceScaleReceipt> {
  const receipt = requirePlaceShape<PlaceScaleReceipt>(input);
  if (receipt.document !== 'place-scale') throw Error('expected a place scale receipt');
  const { sha256, ...body } = receipt;
  if (sha256 !== await canonicalSha256(body) || !same(receipt.registration, PLACE_SCALE_REGISTRATION) ||
    receipt.registrationId !== await canonicalSha256(PLACE_SCALE_REGISTRATION)) throw Error('place scale receipt or registration identity differs');
  if (!same(receipt.source, await placeScaleSource(root))) throw Error('place scale measurement source is stale');
  const expected = await expectedScale();
  if (receipt.workloadId !== expected.workloadId || !same(receipt.runtimes.map(row => row.runtime), ['node', 'bun'])) throw Error('place scale workload or runtime census differs');
  const measured = receipt.runtimes.filter(runtime => runtime.status === 'measured'), target = receipt.registration.targetP95Ms;
  if (receipt.runtimes[0].status !== 'measured') throw Error('the registered Node scale row is missing');
  const sweepPasses = measured.every(runtime => runtime.rows.sweep !== null && runtime.rows.sweep.warm.p95Ms <= target);
  const bboxPasses = measured.every(runtime => runtime.rows.bbox !== null && runtime.rows.bbox.warm.p95Ms <= target);
  for (const runtime of receipt.runtimes) {
    if (runtime.status === 'unavailable') {
      if (!runtime.detail || runtime.version !== null || runtime.platform !== null || runtime.rtree !== null || shapes.some(shape => runtime.rows[shape] !== null || !runtime.notRun[shape])) throw Error('unavailable runtime has fabricated measurements');
      continue;
    }
    if (!runtime.version || !runtime.platform || runtime.rtree === null || runtime.detail !== null || runtime.rows.sweep === null) throw Error('incomplete scale runtime identity');
    if (sweepPasses ? runtime.rows.bbox !== null || runtime.rows.rtree !== null : runtime.rows.bbox === null) throw Error('bbox scale admission differs from the measured sweep');
    if (!sweepPasses && (bboxPasses ? runtime.rows.rtree !== null : runtime.rtree ? runtime.rows.rtree === null : runtime.rows.rtree !== null)) throw Error('R-tree scale admission differs from its predecessor or capability');
    for (const shape of shapes) {
      const row = runtime.rows[shape];
      if (row === null) { if (!runtime.notRun[shape]) throw Error('unmeasured shape needs a reason'); continue; }
      if (runtime.notRun[shape] !== null || row.shape !== shape || row.via !== (shape === 'sweep' ? 'memory' : shape === 'bbox' ? 'columns' : 'rtree')) throw Error('scale shape identity differs');
      if (shape === 'sweep') { if (row.explain !== null) throw Error('in-memory sweep cannot claim a database plan'); }
      else {
        const filters = row.explain?.prefilters;
        if (!Array.isArray(filters) || !filters.some(filter => filter && filter.construct === '$bbox-intersects' && filter.via === row.via)) throw Error('scale physical prefilter was not used');
      }
      for (const phase of [row.cold, row.warm]) {
        if (!same(phase.samples.map(sample => sample.probeId), [...expected.probes.keys()]) || !same(phase, placeScalePhase(phase.samples))) throw Error('scale samples or native quantiles differ');
        for (const { probeId, ms: _ms, ...outcome } of phase.samples) if (!same(outcome, expected.probes.get(probeId))) throw Error('scale candidate or refinement result differs');
      }
    }
  }
  if (!same({ decision: receipt.decision, targetMet: receipt.targetMet }, placeScaleDecision(receipt.runtimes, target))) throw Error('registered scale decision differs');
  return receipt;
}
export async function readPlaceScaleReceipt(root = process.cwd(), path = PLACE_SCALE_RECEIPT): Promise<PlaceScaleReceipt> {
  return validatePlaceScaleReceipt(JSON.parse(await readFile(join(root, path), 'utf8')), root);
}
