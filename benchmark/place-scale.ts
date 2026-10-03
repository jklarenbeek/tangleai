/** Conditional native scale trials; raw timings stay in a separate immutable receipt. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { parseArgs } from './lib/args.ts';
import { measurePlaceScaleShape, type PlaceScaleShape } from './lib/place-scale.ts';
import { PLACE_SCALE_REGISTRATION, PLACE_SCALE_RECEIPT, placeScaleSource, placeScaleDecision, validatePlaceScaleReceipt } from './lib/place-scale-receipt.ts';
import { requirePlaceShape } from './lib/place-validation.ts';
import type { PlaceScaleReceipt, ScaleRuntime, ScaleWorker } from './lib/place-report.types.ts';

const execute = promisify(execFile);
export async function measurePlaceScale(): Promise<PlaceScaleReceipt> {
  const source = await placeScaleSource(), registration = PLACE_SCALE_REGISTRATION, registrationId = await canonicalSha256(registration);
  const runtimes: ScaleRuntime[] = [];
  let workloadId: string | undefined;
  async function measure(runtime: 'node' | 'bun', shape: PlaceScaleShape): Promise<ScaleWorker | null> {
    let stdout: string;
    try { ({ stdout } = await execute(runtime, ['benchmark/place-scale.ts', '--worker', shape], { cwd: process.cwd(), maxBuffer: 4 * 1024 * 1024, timeout: 300000 })); }
    catch (cause) {
      if (runtime === 'bun' && shape === 'sweep' && cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return null;
      throw cause;
    }
    const worker = requirePlaceShape<ScaleWorker>(JSON.parse(stdout));
    if (worker.document !== 'place-scale-worker' || worker.runtime !== runtime || worker.registrationId !== registrationId ||
      worker.measurement && worker.measurement.shape !== shape) throw Error('scale subprocess identity differs');
    workloadId ??= worker.workloadId;
    if (worker.workloadId !== workloadId) throw Error('scale runtimes measured different workloads');
    return worker;
  }
  for (const runtime of ['node', 'bun'] as const) {
    const worker = await measure(runtime, 'sweep');
    if (!worker) {
      runtimes.push({ runtime, status: 'unavailable', version: null, platform: null, rtree: null, detail: 'Bun executable is unavailable (ENOENT)',
        rows: { sweep: null, bbox: null, rtree: null }, notRun: { sweep: 'runtime unavailable', bbox: 'runtime unavailable', rtree: 'runtime unavailable' } });
    } else {
      if (!worker.measurement || worker.unavailable !== null) throw Error('required scale sweep did not run');
      runtimes.push({ runtime, status: 'measured', version: worker.version, platform: worker.platform, rtree: worker.rtree, detail: null,
        rows: { sweep: worker.measurement, bbox: null, rtree: null }, notRun: { sweep: null, bbox: 'registered sweep meets the target', rtree: 'registered sweep meets the target' } });
    }
  }
  for (const shape of ['bbox', 'rtree'] as const) {
    if (placeScaleDecision(runtimes, registration.targetP95Ms).targetMet) break;
    for (const runtime of runtimes.filter(row => row.status === 'measured')) {
      if (shape === 'rtree' && !runtime.rtree) { runtime.notRun.rtree = 'native SQLite capability rtree=false'; continue; }
      const worker = await measure(runtime.runtime, shape);
      if (!worker?.measurement || worker.unavailable !== null || worker.version !== runtime.version || worker.platform !== runtime.platform || worker.rtree !== runtime.rtree) throw Error('physical scale trial is unavailable or changed runtime identity');
      runtime.rows[shape] = worker.measurement; runtime.notRun[shape] = null;
      if (shape === 'bbox') runtime.notRun.rtree = 'registered bbox trial meets the target';
    }
  }
  if (!workloadId || canonicalizeJson(source) !== canonicalizeJson(await placeScaleSource())) throw Error('scale measurement source changed during execution');
  const body: Omit<PlaceScaleReceipt, 'sha256'> = { document: 'place-scale', schemaVersion: 1, registration, registrationId, workloadId, source, runtimes,
    ...placeScaleDecision(runtimes, registration.targetP95Ms), physicalRequests: 0,
    limits: 'Synthetic sparse uniform positions; candidate lookup only, with precomputed nine-cell probes. Cold is the first pass after preparation, not an OS cache reset. Warm follows the registered warmups. Native exact cell refinement is timed for physical prefilters; distance checks and receipt hashing are outside the timer. Public sourced-gazetteer validation, semantic retrieval, loading and complete SQLite adapter I/O are not timed. The slowest available runtime governs the shared target; no universal or dense-urban latency claim.' };
  return validatePlaceScaleReceipt({ ...body, sha256: await canonicalSha256(body) });
}

export async function runPlaceScaleCli(argv: string[]): Promise<void> {
  if (argv.some(arg => /^--check=/.test(arg))) throw Error('--check takes no value');
  const args = parseArgs(argv, { flags: ['check'], values: ['json', 'worker'] });
  if (args.rest.length || [...args.values.values()].some(value => value.startsWith('--'))) throw Error('unexpected scale argument or missing value');
  const worker = args.values.get('worker');
  if (worker) {
    if (!['sweep', 'bbox', 'rtree'].includes(worker) || args.values.has('json') || args.flags.size) throw Error('invalid scale worker invocation');
    console.log(JSON.stringify(await measurePlaceScaleShape(worker as PlaceScaleShape, PLACE_SCALE_REGISTRATION, () => performance.now()))); return;
  }
  const path = args.values.get('json') ?? PLACE_SCALE_RECEIPT;
  if (args.flags.has('check')) {
    const receipt = await validatePlaceScaleReceipt(JSON.parse(await readFile(path, 'utf8')));
    console.log(JSON.stringify({ sha256: receipt.sha256, decision: receipt.decision, targetMet: receipt.targetMet })); return;
  }
  try { await access(path); }
  catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
      const receipt = await measurePlaceScale();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
      console.log(JSON.stringify({ sha256: receipt.sha256, decision: receipt.decision, targetMet: receipt.targetMet })); return;
    }
    throw cause;
  }
  throw Error('retain the existing timing receipt; choose a new --json path for a new measurement');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const before = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('place scale forbids network requests'); };
  try { await runPlaceScaleCli(process.argv.slice(2)); if (calls) throw Error('scale network guard was reached'); }
  finally { globalThis.fetch = before; }
}
