/**
 * The bounded, cited context seam and its injected host adapters.
 *
 * `MasContextProvider.read` returns a CLOSED outcome: `ok` with
 * ordered, bounded `{ address, text, citation, capabilities }` units,
 * or an explicit `unavailable`/`failed` with a reason — absence is
 * never silent. Every adapter here is a thin shaping over an INJECTED
 * host capability (a memory recall function, a document chunk recall, a
 * search client, a toolbox manifest, an MCP-compatible provider): this
 * package carries no network client, no database and no domain import,
 * so the host decides what exists and the workflow can only request
 * declared, allowlisted adapters. Units are clamped to the caller's
 * `maxUnits`/`maxChars` through the suite's `truncate`; the abort
 * signal is honored before any injected call.
 */

import { truncate } from '@jarenjs/core/chunk';

export interface MasContextUnit {
  address: string;
  text: string;
  citation: string | null;
  capabilities: string[];
}

export type MasContextOutcome =
  | { outcome: 'ok', units: MasContextUnit[] }
  | { outcome: 'unavailable', reason: string }
  | { outcome: 'failed', reason: string };

export interface MasContextReadOptions {
  signal: AbortSignal;
  maxUnits: number;
  maxChars: number;
}

export interface MasContextProvider {
  id: string;
  read(request: { node: string, query: unknown }, options: MasContextReadOptions): Promise<MasContextOutcome>;
}

function clamp(units: MasContextUnit[], options: MasContextReadOptions): MasContextUnit[] {
  const kept: MasContextUnit[] = [];
  let chars = 0;
  for (const unit of units.slice(0, options.maxUnits)) {
    const room = options.maxChars - chars;
    if (room <= 0) break;
    const text = truncate(unit.text, room);
    chars += text.length;
    kept.push({ ...unit, text });
  }
  return kept;
}

function guarded(
  id: string,
  read: (request: { node: string, query: unknown }, options: MasContextReadOptions) => Promise<MasContextUnit[]>,
): MasContextProvider {
  return {
    id,
    async read(request, options) {
      if (options.signal.aborted) {
        return { outcome: 'failed', reason: 'the shared abort signal was already raised' };
      }
      try {
        const units = await read(request, options);
        return { outcome: 'ok', units: clamp(units, options) };
      } catch (error) {
        return { outcome: 'failed', reason: (error as Error).message ?? String(error) };
      }
    },
  };
}

/** Curated memory recall over an injected identity-gated recall function. */
export function createMemoryContextProvider(host: {
  recall: (query: unknown, options: { limit: number, signal: AbortSignal }) => Promise<Array<{ id: string, text: string }>>,
} | null): MasContextProvider {
  if (host === null) {
    return {
      id: 'memory',
      read: async () => ({ outcome: 'unavailable', reason: 'no memory store is configured on this host' }),
    };
  }
  return guarded('memory', async (request, options) => {
    const records = await host.recall(request.query, { limit: options.maxUnits, signal: options.signal });
    return records.map((record) => ({
      address: `memory:${record.id}`,
      text: record.text,
      citation: record.id,
      capabilities: ['read'],
    }));
  });
}

/** Versioned document chunks over an injected recall, addresses retained. */
export function createDocumentsContextProvider(host: {
  recallChunks: (query: unknown, options: { limit: number, signal: AbortSignal }) => Promise<Array<{ sourceId: string, versionId: string, chunkId: string, text: string }>>,
} | null): MasContextProvider {
  if (host === null) {
    return {
      id: 'documents',
      read: async () => ({ outcome: 'unavailable', reason: 'no document store is configured on this host' }),
    };
  }
  return guarded('documents', async (request, options) => {
    const chunks = await host.recallChunks(request.query, { limit: options.maxUnits, signal: options.signal });
    return chunks.map((chunk) => ({
      address: `document:${chunk.sourceId}/${chunk.versionId}/${chunk.chunkId}`,
      text: chunk.text,
      citation: chunk.chunkId,
      capabilities: ['read'],
    }));
  });
}

/**
 * Read-only safe web discovery over an injected search lane. Snippets
 * carry the `discovery` capability and are never promoted to evidence.
 */
export function createWebContextProvider(host: {
  search: (query: unknown, options: { limit: number, signal: AbortSignal }) => Promise<Array<{ url: string, title: string, snippet: string }>>,
} | null): MasContextProvider {
  if (host === null) {
    return {
      id: 'web',
      read: async () => ({ outcome: 'unavailable', reason: 'no safe web lane is configured on this host' }),
    };
  }
  return guarded('web', async (request, options) => {
    const results = await host.search(request.query, { limit: options.maxUnits, signal: options.signal });
    return results.map((result) => ({
      address: `web:${result.url}`,
      text: `${result.title}\n${result.snippet}`,
      citation: result.url,
      capabilities: ['discovery'],
    }));
  });
}

/** The effective toolbox manifest — declarations, never secret-bearing closures. */
export function createToolboxContextProvider(host: {
  list: () => Array<{ name: string, description: string, inputSchema: unknown }>,
}): MasContextProvider {
  return guarded('toolbox', async () => host.list().map((tool) => ({
    address: `tool:${tool.name}`,
    text: `${tool.name} — ${tool.description}\ninput: ${JSON.stringify(tool.inputSchema)}`,
    citation: null,
    capabilities: ['read'],
  })));
}

/**
 * The MCP-compatible seam: an injected provider with explicit
 * capability/authentication status; this package ships no MCP client.
 */
export function createMcpContextProvider(host: {
  status: () => { available: boolean, reason?: string },
  read: (request: { node: string, query: unknown }, options: MasContextReadOptions) => Promise<MasContextUnit[]>,
} | null): MasContextProvider {
  if (host === null) {
    return {
      id: 'mcp',
      read: async () => ({ outcome: 'unavailable', reason: 'no MCP-compatible provider is injected on this host' }),
    };
  }
  return {
    id: 'mcp',
    async read(request, options) {
      const status = host.status();
      if (!status.available) {
        return { outcome: 'unavailable', reason: status.reason ?? 'the injected provider reports itself unavailable' };
      }
      return guarded('mcp', host.read).read(request, options);
    },
  };
}
