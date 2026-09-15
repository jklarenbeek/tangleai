/**
 * Strategies as checked records, not a second skill store.
 *
 * A strategy is the thing that proposed a change, and it has to be
 * addressable afterwards so an outcome can move its confidence. It is
 * written twice, deliberately: as a SKILL in the context ledger — which
 * owns skill validation, ids and embeddings — and as one memory carrier
 * in the outcome store, which is what the outcome lifecycle resolves
 * against. Neither is a copy of the other's job, and this module creates
 * no third record type of its own.
 *
 * The ledger's refusal is preserved rather than restated: a rejection
 * comes back as `TEVO1011` carrying the ledger's own message as `cause`,
 * so the reason a skill was refused survives the translation.
 */

import { refuseOne, ok, type EvolveOutcome } from './errors.ts';
import type { EvolveStrategy } from './contracts.gen.ts';

/** The ledger members this module uses. Structural, so a stub fits. */
export interface StrategyLedger {
  addSkill(input: {
    id?: string,
    name: string,
    when: string,
    instructions: string,
    tools?: string[],
    at?: string,
  }): Promise<Record<string, unknown>>;
  recallSkills(query: { near: string, limit?: number }): Promise<unknown>;
}

/**
 * The carrier this module writes. Spelled out rather than loosened to a
 * record, so it stays assignable to the memory unit the outcome store
 * actually accepts — a wider parameter here would not type-check against
 * a narrower one there.
 */
export interface StrategyCarrier {
  id: string;
  kind: 'fact';
  text: string;
  tags: string[];
  evidence: string;
  at: string;
  confidence: number;
}

export interface StrategyMemoryStore {
  memories: { put(unit: StrategyCarrier): Promise<unknown>, get(id: string): Promise<unknown> };
}

export interface StrategyRegistration {
  strategyId: string;
  skillId: string;
  memoryId: string;
  name: string;
  when: string;
  instructions: string;
  evidence?: string[];
  origin?: EvolveStrategy['origin'];
  revision: string;
  at: string;
  text?: string;
}

export interface StrategyLibrary {
  register(strategy: StrategyRegistration): Promise<EvolveOutcome<{ strategyId: string, writes: number }>>;
  list(): Promise<EvolveOutcome<StrategyRegistration[]>>;
  get(strategyId: string): Promise<EvolveOutcome<StrategyRegistration | null>>;
  recall(query: { near: string, limit?: number }): Promise<EvolveOutcome<unknown>>;
}

function isRejection(value: unknown): value is { error: string, code?: string } {
  return value !== null && typeof value === 'object' && typeof (value as { error?: unknown }).error === 'string';
}

export function createStrategyLibrary(options: {
  ledger: StrategyLedger,
  outcomeStore: StrategyMemoryStore,
}): StrategyLibrary {
  const { ledger, outcomeStore } = options;
  const held = new Map<string, StrategyRegistration>();

  return {
    async register(strategy) {
      const existing = held.get(strategy.strategyId);
      if (existing && existing.revision === strategy.revision && existing.skillId === strategy.skillId) {
        // A second identical registration is a read. Nothing is rewritten,
        // so a resumed run cannot double-count a strategy it already holds.
        return ok({ strategyId: strategy.strategyId, writes: 0 });
      }
      const skill = await ledger.addSkill({
        id: strategy.skillId,
        name: strategy.name,
        when: strategy.when,
        instructions: strategy.instructions,
        tools: [],
        at: strategy.at,
      });
      if (isRejection(skill)) {
        return refuseOne('TEVO1011', '/skillId', 'The ledger refused this strategy skill.', {
          code: skill.code ?? 'ledger/rejected',
          docPath: '/skill',
          message: skill.error,
        });
      }
      try {
        await outcomeStore.memories.put({
          id: strategy.memoryId,
          kind: 'fact',
          text: strategy.text ?? strategy.instructions,
          tags: ['evolve-strategy'],
          // A memory unit's evidence is one string. The evolve-side list of
          // record ids is joined rather than reshaped, so the carrier still
          // names exactly what the strategy was derived from.
          evidence: (strategy.evidence ?? []).join(' ') || strategy.strategyId,
          at: strategy.at,
          confidence: 0.5,
        });
      }
      catch (error) {
        // The outcome store rejects by throwing. A content failure is a
        // value here, so its reason is carried rather than propagated.
        return refuseOne('TEVO1011', '/memoryId', 'The outcome store refused this strategy carrier.', {
          code: 'outcomes/rejected',
          docPath: '/memory',
          message: error instanceof Error ? error.message : String(error),
        });
      }
      held.set(strategy.strategyId, strategy);
      return ok({ strategyId: strategy.strategyId, writes: 1 });
    },

    async list() {
      return ok([...held.values()].sort((a, b) =>
        (a.strategyId < b.strategyId ? -1 : a.strategyId > b.strategyId ? 1 : 0)));
    },

    async get(strategyId) {
      return ok(held.get(strategyId) ?? null);
    },

    async recall(query) {
      const result = await ledger.recallSkills(query);
      if (isRejection(result)) {
        // The ledger refuses recall without an embedder. Its reason is the
        // useful one, so it is carried rather than replaced.
        return refuseOne('TEVO1011', '/near', 'The ledger refused this recall.', {
          code: (result as { code?: string }).code ?? 'ledger/rejected',
          docPath: '/recall',
          message: result.error,
        });
      }
      return ok(result);
    },
  };
}
