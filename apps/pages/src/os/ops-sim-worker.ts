/**
 * The simulation's worker, built as its own script (`os-ops-sim-worker.js`) and
 * started only when the person asks Jobs what will happen: it runs the
 * rebuilt registry on an in-memory SQLite copy with its own clock, answers once
 * and is ended. Nothing it runs calls anything outside it.
 */
import { wasmDriver, sqlite3Handle } from '@jarenjs/db/wasm';
import { createIntlZoneProvider } from '@jarenjs/locales/intl-zones';
import { simulateRegistry } from '@tangleai/ops/simulate';
import { initializeSqlite } from '../demos/playground/sqlite.ts';

self.onmessage = async (event: MessageEvent) => {
  const { registry, days, failRate, seed, from } = event.data ?? {};
  try {
    const sqlite3: any = await initializeSqlite({ locateFile: (name: string) => new URL(name, import.meta.url).href, print: () => {}, printErr: () => {} });
    const simulation = await simulateRegistry(registry, { driver: wasmDriver(sqlite3Handle(sqlite3)), days, failRate, seed, from, zoneProvider: createIntlZoneProvider({ revision: 'browser ICU' }) });
    (self as any).postMessage({ ok: true, simulation });
  } catch (error: any) {
    (self as any).postMessage({ ok: false, message: String(error?.message ?? error) });
  }
};
