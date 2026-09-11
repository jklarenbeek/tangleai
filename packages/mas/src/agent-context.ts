/**
 * Durable agent context — the suite's ledger and environment, composed,
 * never re-implemented.
 *
 * When a host configures durable agent memory, rounds compact through
 * `createLedger` over injected storage (recoverable, recallable); when
 * declared context exceeds the prompt threshold, the corpus loads into
 * a `createEnvironment` (with `compileJsonQuery` for `select`) and the
 * agent sees the bounded digest plus the suite's own
 * digest/peek/grep/chunk/stat/read tools — bulk content enters only
 * through an explicit `env_read` character budget, and re-chunking is
 * idempotent because the suite derives chunk addresses. Nothing here
 * adds a compactor, a recall tool or an environment operation; this is
 * composition of the published seams, with every slot address traceable.
 */

import { createEnvironment, createLedger } from '@jarenjs/ai';
import { compileJsonQuery } from '@jarenjs/json/query';

type LedgerOptions = NonNullable<Parameters<typeof createLedger>[0]>;
export type MasLedgerStorage = NonNullable<LedgerOptions['storage']>;

export interface MasAgentContextOptions {
  /** Injected durable storage; absent means in-memory (per run). */
  storage?: MasLedgerStorage;
  now?: () => string;
  embedder?: LedgerOptions['embedder'];
  goalLimits?: LedgerOptions['goalLimits'];
  archiveLimits?: LedgerOptions['archiveLimits'];
}

export interface MasAgentContext {
  ledger: ReturnType<typeof createLedger>;
  environment: ReturnType<typeof createEnvironment>;
  /** Load one addressed corpus slot; returns its bounded view. */
  putCorpus(name: string, content: string): Promise<{ name: string, size: number }>;
}

export function createMasAgentContext(options: MasAgentContextOptions = {}): MasAgentContext {
  const ledger = createLedger({
    ...(options.storage !== undefined ? { storage: options.storage } : {}),
    compileQuery: compileJsonQuery,
    ...(options.now !== undefined ? { now: options.now } : {}),
    ...(options.embedder !== undefined ? { embedder: options.embedder } : {}),
    ...(options.goalLimits !== undefined ? { goalLimits: options.goalLimits } : {}),
    ...(options.archiveLimits !== undefined ? { archiveLimits: options.archiveLimits } : {}),
  });
  const environment = createEnvironment({ ledger, compileQuery: compileJsonQuery });
  return {
    ledger,
    environment,
    async putCorpus(name, content) {
      const view = await environment.put(name, content) as { name: string, size: number, error?: string };
      if (view.error !== undefined) throw new Error(`the corpus slot refused: ${view.error}`);
      return { name: view.name, size: view.size };
    },
  };
}
