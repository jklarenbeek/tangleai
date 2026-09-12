import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
/** Real local and in-process HTTP bindings; neither opens a socket. */
import { openLocalClient } from '@jarenjs/contract/local';
import { openHttpClient } from '@jarenjs/contract/client';
import { serveHttp } from '@jarenjs/contract/http';
import { toFetchHandler } from '@jarenjs/contract/fetch';
import { createOutcomeService, createOutcomeContract, createOutcomeHandlers, outcomeRevision } from '@tangleai/outcomes';
import { measureOutcomeReplay } from './outcome-runtime.ts';
import { probe } from './outcome-conformance.ts';
import type { OutcomeApi } from './outcome-runtime.ts';
import type { OutcomeServiceOptions, OutcomeService, Result } from '@tangleai/outcomes';
import type { OutcomeFixtures } from './outcome-fixtures.ts';
import type { Trace, Binding } from './outcome-conformance.types.ts';

export function outcomeTransportFactory(binding: 'local' | 'http') {
  let requests = 0;
  const contract = createOutcomeContract();
  const factory = async (host: OutcomeServiceOptions): Promise<OutcomeService> => {
    const service = await createOutcomeService(host);
    const authenticated = Object.freeze({ service, allowScope: (id: string) => id === service.scopeId });
    const handlers = createOutcomeHandlers({ resolveHost: ctx => binding === 'local' ? authenticated : ctx.host === authenticated ? authenticated : undefined });
    const fetchHandler = toFetchHandler(serveHttp(contract, handlers, { validateOutput: 'always', trace: () => 'outcome-http', now: () => 0, identify: () => ({ host: authenticated }) }));
    const client = binding === 'local'
      ? openLocalClient(contract, handlers, { validateOutput: 'always', trace: () => 'outcome-local' })
      : openHttpClient(contract, { fetch: (url: string | URL | Request, init?: RequestInit) => fetchHandler(new Request(new URL(String(url), 'http://outcome.invalid'), init)), keys: () => 'outcome-request', now: () => 0 });
    return new Proxy({ ...service }, { get(target, key) {
      const method = Reflect.get(target, key);
      if (typeof method !== 'function') return method;
      return async (input: unknown): Promise<Result> => {
        requests++;
        const result = await client.invoke(`outcomes.${key === 'injectChecked' ? 'inject' : String(key)}`, input);
        if (!result.ok) throw Error(`Outcome transport failure: ${JSON.stringify(result)}`);
        return result.value as Result;
      };
    } });
  };
  return { factory, requests: () => requests, revision: () => contract.revision() };
}
export async function measureOutcomeTransports(f: OutcomeFixtures, expected: Trace) {
  const probes = [], bindings: Binding[] = [];
  for (const binding of ['local', 'http'] as const) {
    const transport = outcomeTransportFactory(binding);
    const measured = await measureOutcomeReplay(f, { mode: 'checked-scripted', serviceFactory: transport.factory });
    bindings.push({ binding, store: 'memory', runtime: process.versions.bun ? 'bun' : 'node', requests: transport.requests(), contractRevision: await transport.revision(), trace: measured.trace });
    probes.push(probe(`contract-${binding}-business-trace`, await outcomeRevision(expected), await outcomeRevision(measured.trace), 'contract'));
    probes.push(probe(`contract-${binding}-replay`, [124, 0], [measured.row.counts.replayed, measured.row.counts.physicalRequests], 'contract'));
  }
  const db = await openTangleDb();
  try {
    const measured = await measureOutcomeReplay(f, { mode: 'checked-scripted', store: createOutcomeStore(db) });
    bindings.push({ binding: 'direct', store: 'sqlite', runtime: process.versions.bun ? 'bun' : 'node', requests: 0, contractRevision: null, trace: measured.trace });
    probes.push(probe('sqlite-business-trace', await outcomeRevision(expected), await outcomeRevision(measured.trace), 'complete'));
  } finally { await db.close(); }
  const directory = await mkdtemp(join(tmpdir(), 'outcome-bun-'));
  try {
    const binding = JSON.parse(execFileSync('bun', ['benchmark/scripts/outcome-runtime.ts', join(directory, 'db')], { encoding: 'utf8', maxBuffer: 8000000, timeout: 60000 })) as Binding;
    if (binding.runtime !== 'bun' || binding.store !== 'sqlite') throw Error('Child runtime metadata differs');
    bindings.push(binding);
    probes.push(probe('bun-sqlite-business-trace', await outcomeRevision(expected), await outcomeRevision(binding.trace), 'complete'));
  } finally { await rm(directory, { recursive: true, force: true }); }
  return { probes, bindings };
}
