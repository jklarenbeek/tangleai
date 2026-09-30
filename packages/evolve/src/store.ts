/**
 * The narrow persistence contract, and its in-memory reference.
 *
 * Two shapes of state live here and they are kept apart on purpose.
 * Records are IMMUTABLE and content-addressed: writing the same bytes
 * under the same id twice is a read, and writing different bytes under an
 * id that exists is a refusal, so nothing can be rewritten behind an
 * identity something else already cited. An experiment is MUTABLE and
 * fenced by an integer revision: it moves only through
 * `transitionExperiment`, under compare-and-swap, so two executors racing
 * the same step cannot both win.
 *
 * Keys are semantic uniqueness, not addresses — one experiment per
 * repository, base revision and proposal — which is what stops the same
 * proposal being run twice against the same tree and counted twice.
 *
 * An adapter implements this over a real database inside one transaction.
 * The reference below holds it in maps, and a parity test asserts the two
 * answer identically.
 */

import { refuseOne, ok, type EvolveOutcome } from './errors.ts';
import { validateRecord, sealRecord } from './identity.ts';
import { planExperimentTransition, type ExperimentCommand } from './transitions.ts';
import type { EvolveRecord, EvolveExperiment, Status } from './contracts.gen.ts';

/** A stored record with the sequence it was written at. */
export interface StoredRecord {
  seq: number;
  record: EvolveRecord;
}

export interface ListQuery {
  kind: EvolveRecord['kind'];
  experimentId?: string;
}

export interface WriteReceipt {
  id: string;
  /** 0 when the store already held exactly these bytes. */
  writes: number;
}

/** Both stores reserve their key separators; keys themselves remain opaque. */
export function checkEvolveKeyKind(kind: string): EvolveOutcome<true> {
  return typeof kind === 'string' && kind.length > 0 && !/[\u0000\s]/u.test(kind)
    ? ok(true as const)
    : refuseOne('TEVO1001', '/kind', 'A semantic key kind must be nonempty and contain no whitespace or NUL.');
}

export interface EvolveStore {
  putRecord(record: unknown): Promise<EvolveOutcome<WriteReceipt>>;
  getRecord(id: string): Promise<EvolveOutcome<EvolveRecord | null>>;
  listRecords(query: ListQuery): Promise<EvolveOutcome<EvolveRecord[]>>;
  putKey(kind: string, key: string, id: string): Promise<EvolveOutcome<WriteReceipt>>;
  getKey(kind: string, key: string): Promise<EvolveOutcome<string | null>>;
  getExperiment(experimentId: string): Promise<EvolveOutcome<EvolveExperiment | null>>;
  transitionExperiment(
    experimentId: string,
    command: ExperimentCommand,
    expectedRevision: number,
  ): Promise<EvolveOutcome<EvolveExperiment>>;
}

/** The experiment id a record carries, when it carries one. */
export function recordExperimentId(record: EvolveRecord): string | null {
  return 'experimentId' in record && typeof record.experimentId === 'string' ? record.experimentId : null;
}

/**
 * Plan one transition over a held experiment: validate the fence, plan the
 * status step, and answer the next experiment payload WITHOUT its id, so
 * every adapter seals and writes it the same way.
 */
export function planExperimentWrite(
  held: EvolveExperiment | null,
  experimentId: string,
  command: ExperimentCommand,
  expectedRevision: number,
): EvolveOutcome<Omit<EvolveExperiment, 'id'>> {
  if (held === null) {
    return refuseOne('TEVO1010', '/experimentId', 'No experiment ' + experimentId + ' is held.');
  }
  if (held.revision !== expectedRevision) {
    return refuseOne('TEVO1010', '/revision',
      'Experiment ' + experimentId + ' is at revision ' + held.revision + ', not ' + expectedRevision + '.');
  }
  const planned = planExperimentTransition(held.status as Status, command);
  if (!planned.ok) return { ok: false, issues: [planned.issue] };
  const { id: _id, ...data } = held;
  return ok({
    ...data,
    status: planned.status,
    revision: held.revision + 1,
    history: [...held.history, { from: held.status, to: planned.status, recordId: held.id }],
  });
}

/** The in-memory reference implementation. Zero I/O, one process. */
export function createMemoryEvolveStore(): EvolveStore {
  const records = new Map<string, StoredRecord>();
  const keys = new Map<string, string>();
  const experiments = new Map<string, EvolveExperiment>();
  let seq = 0;

  const keyOf = (kind: string, key: string): string => kind + '\u0000' + key;

  return {
    async putRecord(value) {
      const checked = await validateRecord<EvolveRecord & { id: string }>(value);
      if (!checked.ok) return checked;
      const record = checked.value as EvolveRecord;
      if (record.kind === 'experiment') {
        const held = experiments.get(record.experimentId) ?? null;
        if (held !== null) {
          if (held.id === record.id) return ok({ id: record.id, writes: 0 });
          return refuseOne('TEVO1002', '/experimentId',
            'Experiment ' + record.experimentId + ' already exists under a different value.');
        }
        experiments.set(record.experimentId, record);
        return ok({ id: record.id, writes: 1 });
      }
      const existing = records.get(record.id);
      if (existing) return ok({ id: record.id, writes: 0 });
      records.set(record.id, { seq: seq++, record });
      return ok({ id: record.id, writes: 1 });
    },

    async getRecord(id) {
      const held = records.get(id);
      if (held) return ok(held.record);
      for (const experiment of experiments.values()) if (experiment.id === id) return ok(experiment);
      return ok(null);
    },

    async listRecords(query) {
      if (query.kind === 'experiment') {
        const rows = [...experiments.values()]
          .filter(row => query.experimentId === undefined || row.experimentId === query.experimentId)
          .sort((a, b) => (a.experimentId < b.experimentId ? -1 : a.experimentId > b.experimentId ? 1 : 0));
        return ok(rows as EvolveRecord[]);
      }
      const rows = [...records.values()]
        .filter(row => row.record.kind === query.kind)
        .filter(row => query.experimentId === undefined || recordExperimentId(row.record) === query.experimentId)
        .sort((a, b) => a.seq - b.seq)
        .map(row => row.record);
      return ok(rows);
    },

    async putKey(kind, key, id) {
      const checked = checkEvolveKeyKind(kind);
      if (!checked.ok) return checked;
      const composite = keyOf(kind, key);
      const held = keys.get(composite);
      if (held !== undefined) {
        if (held === id) return ok({ id, writes: 0 });
        return refuseOne('TEVO1002', '/key', 'Key ' + kind + ' ' + key + ' already names ' + held + '.');
      }
      keys.set(composite, id);
      return ok({ id, writes: 1 });
    },

    async getKey(kind, key) {
      const checked = checkEvolveKeyKind(kind);
      if (!checked.ok) return checked;
      return ok(keys.get(keyOf(kind, key)) ?? null);
    },

    async getExperiment(experimentId) {
      return ok(experiments.get(experimentId) ?? null);
    },

    async transitionExperiment(experimentId, command, expectedRevision) {
      const held = experiments.get(experimentId) ?? null;
      const planned = planExperimentWrite(held, experimentId, command, expectedRevision);
      if (!planned.ok) return planned;
      const sealed = await sealRecord<EvolveExperiment>(planned.value);
      if (!sealed.ok) return sealed;
      experiments.set(experimentId, sealed.value);
      return ok(sealed.value);
    },
  };
}
