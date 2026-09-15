/**
 * The persistent EvolveStore, over the shared Jaren store and native driver.
 *
 * Every method is one immediate transaction, so the read that decides an
 * immutability refusal and the write that follows it cannot be separated
 * by another writer. The sequence a record is listed by is allocated
 * inside that same transaction for the same reason: two executors adding
 * records concurrently get distinct positions rather than a tie nobody
 * can order.
 *
 * The compare-and-swap on an experiment is the whole reason the row is
 * kept apart from the immutable records — it is the one thing here that
 * changes, and it changes only against a revision the caller has seen.
 */

import {
  planExperimentWrite, recordExperimentId, sealRecord, validateRecord, ok, refuseOne,
  type EvolveStore, type EvolveOutcome, type ListQuery, type WriteReceipt,
  type EvolveRecord, type EvolveExperiment, type ExperimentCommand,
} from '@tangleai/evolve';
import type { TangleDb } from './db.ts';
import { asRows } from './memory-store.ts';

interface RecordRow { id: string, scope: string, seq: number, experimentId?: string, payload: EvolveRecord }
interface KeyRow { id: string, target: string }
interface ExperimentRow { id: string, revision: number, payload: EvolveExperiment }

const keyOf = (kind: string, key: string): string => kind + ' ' + key;

export function createEvolveStore(db: TangleDb): EvolveStore {
  return {
    async putRecord(value: unknown): Promise<EvolveOutcome<WriteReceipt>> {
      const checked = await validateRecord<EvolveRecord & { id: string }>(value);
      if (!checked.ok) return checked;
      const record = checked.value as EvolveRecord;

      if (record.kind === 'experiment') {
        const sealed = record as EvolveExperiment;
        return db.transaction(async tx => {
          const rows = tx.collection<ExperimentRow>('evolve_experiments');
          const held = await rows.get(sealed.experimentId);
          if (held) {
            if (held.payload.id === sealed.id) return ok({ id: sealed.id, writes: 0 });
            return refuseOne<WriteReceipt>('TEVO1002', '/experimentId',
              'Experiment ' + sealed.experimentId + ' already exists under a different value.');
          }
          await rows.put({ id: sealed.experimentId, revision: sealed.revision, payload: sealed });
          return ok({ id: sealed.id, writes: 1 });
        }, { mode: 'immediate' });
      }

      return db.transaction(async tx => {
        const rows = tx.collection<RecordRow>('evolve_records');
        const held = await rows.get(record.id);
        if (held) return ok({ id: record.id, writes: 0 });
        const existing = asRows(await rows.execute<number>({
          $for: { r: '$[*]' }, $return: '$r.seq',
        }));
        const seq = existing.length === 0 ? 0 : Math.max(...existing) + 1;
        const experimentId = recordExperimentId(record);
        await rows.put(experimentId === null
          ? { id: record.id, scope: record.kind, seq, payload: record }
          : { id: record.id, scope: record.kind, seq, experimentId, payload: record });
        return ok({ id: record.id, writes: 1 });
      }, { mode: 'immediate' });
    },

    async getRecord(id: string): Promise<EvolveOutcome<EvolveRecord | null>> {
      return db.transaction(async tx => {
        const held = await tx.collection<RecordRow>('evolve_records').get(id);
        if (held) return ok(held.payload);
        const experiments = asRows(await tx.collection<ExperimentRow>('evolve_experiments').execute<EvolveExperiment>({
          $for: { r: '$[*]' }, $where: { $eq: ['$r.payload.id', { $const: id }] }, $return: '$r.payload',
        }));
        return ok(experiments[0] ?? null);
      });
    },

    async listRecords(query: ListQuery): Promise<EvolveOutcome<EvolveRecord[]>> {
      return db.transaction(async tx => {
        if (query.kind === 'experiment') {
          const rows = asRows(await tx.collection<ExperimentRow>('evolve_experiments').execute<EvolveExperiment>({
            $for: { r: '$[*]' }, $orderby: ['$r.id'], $return: '$r.payload',
          }));
          const filtered = query.experimentId === undefined
            ? rows
            : rows.filter(row => row.experimentId === query.experimentId);
          return ok(filtered as EvolveRecord[]);
        }
        const rows = asRows(await tx.collection<RecordRow>('evolve_records').execute<RecordRow>({
          $for: { r: '$[*]' }, $where: { $eq: ['$r.scope', { $const: query.kind }] }, $orderby: ['$r.seq'], $return: '$r',
        }));
        const filtered = query.experimentId === undefined
          ? rows
          : rows.filter(row => row.experimentId === query.experimentId);
        return ok(filtered.map(row => row.payload));
      });
    },

    async putKey(kind: string, key: string, id: string): Promise<EvolveOutcome<WriteReceipt>> {
      return db.transaction(async tx => {
        const rows = tx.collection<KeyRow>('evolve_keys');
        const composite = keyOf(kind, key);
        const held = await rows.get(composite);
        if (held) {
          if (held.target === id) return ok({ id, writes: 0 });
          return refuseOne<WriteReceipt>('TEVO1002', '/key',
            'Key ' + kind + ' ' + key + ' already names ' + held.target + '.');
        }
        await rows.put({ id: composite, target: id });
        return ok({ id, writes: 1 });
      }, { mode: 'immediate' });
    },

    async getKey(kind: string, key: string): Promise<EvolveOutcome<string | null>> {
      return db.transaction(async tx => {
        const held = await tx.collection<KeyRow>('evolve_keys').get(keyOf(kind, key));
        return ok(held?.target ?? null);
      });
    },

    async getExperiment(experimentId: string): Promise<EvolveOutcome<EvolveExperiment | null>> {
      return db.transaction(async tx => {
        const held = await tx.collection<ExperimentRow>('evolve_experiments').get(experimentId);
        return ok(held?.payload ?? null);
      });
    },

    async transitionExperiment(
      experimentId: string,
      command: ExperimentCommand,
      expectedRevision: number,
    ): Promise<EvolveOutcome<EvolveExperiment>> {
      return db.transaction(async tx => {
        const rows = tx.collection<ExperimentRow>('evolve_experiments');
        const held = await rows.get(experimentId);
        const planned = planExperimentWrite(held?.payload ?? null, experimentId, command, expectedRevision);
        if (!planned.ok) return planned;
        const sealed = await sealRecord<EvolveExperiment>(planned.value);
        if (!sealed.ok) return sealed;
        await rows.put({ id: experimentId, revision: sealed.value.revision, payload: sealed.value });
        return ok(sealed.value);
      }, { mode: 'immediate' });
    },
  };
}
