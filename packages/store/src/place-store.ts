/** Immutable gazetteer loads over the native immediate transaction owner. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { compareCodePoints } from '@jarenjs/core/string';
import { geohashBounds } from '@jarenjs/core/geo';
import { createGazetteer, placeCell, placeRefuse, placeSuccess,
  type Gazetteer, type GazetteerEntry, type GazetteerView, type PlaceResult } from '@tangleai/memory/place';
import type { TangleDb, DbCollection } from './db.ts';
import { asRows } from './memory-store.ts';

interface GazetteerHeader { id: string; revision: string; entryIds: string[]; }
interface PlaceRow {
  id: string; gazetteerId: string; revision: string; recordType: 'gazetteer' | 'entry';
  payload: GazetteerHeader | GazetteerEntry; lon?: number; lat?: number; cell6?: string;
}
export interface PlaceDbOptions { applyProbe?: (step: 'put:entry' | 'put:gazetteer' | 'commit') => void; }
export interface PlaceDbStore {
  loadGazetteer(gazetteer: Gazetteer | GazetteerView): Promise<PlaceResult<{ writes: number; replayed: boolean }>>;
  entry(gazetteerId: string, id: string): Promise<PlaceResult<GazetteerEntry>>;
  entries(gazetteerId: string): Promise<PlaceResult<GazetteerEntry[]>>;
  entriesInCells(gazetteerId: string, cells: readonly string[]): Promise<PlaceResult<GazetteerEntry[]>>;
  /** Counts committed row writes and entered transactions, including failed attempts and reads. */
  stats(): { writes: number; transactions: number };
}
const rowId = (kind: PlaceRow['recordType'], gazetteerId: string, entryId?: string) =>
  canonicalizeJson(entryId === undefined ? [kind, gazetteerId] : [kind, gazetteerId, entryId]);
const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
const ordered = (rows: PlaceRow[]) => [...rows].sort((a, b) => compareCodePoints(a.id, b.id));

function physicalRows(gazetteer: GazetteerView): PlaceResult<PlaceRow[]> {
  const rows: PlaceRow[] = [];
  for (const entry of gazetteer.entries) {
    const cell = placeCell(entry, 6); if (cell.status !== 'success') return cell;
    rows.push({ id: rowId('entry', gazetteer.id, entry.id), gazetteerId: gazetteer.id, revision: gazetteer.revision,
      recordType: 'entry', payload: entry, lon: entry.geometry.coordinates[0], lat: entry.geometry.coordinates[1], cell6: cell.value });
  }
  rows.push({ id: rowId('gazetteer', gazetteer.id), gazetteerId: gazetteer.id, revision: gazetteer.revision,
    recordType: 'gazetteer', payload: { id: gazetteer.id, revision: gazetteer.revision, entryIds: gazetteer.entries.map(e => e.id) } });
  return placeSuccess(ordered(rows));
}
/** Literal cell disjunctions are native query expressions; callers can inspect the actual planner receipt. */
export function placeReadDocument(gazetteerId: string, cells?: readonly string[]): object {
  const where: unknown[] = [{ $eq: ['$r.gazetteerId', { $const: gazetteerId }] }];
  if (cells !== undefined) where.push({ $eq: ['$r.recordType', { $const: 'entry' }] },
    cells.length ? { $or: [...new Set(cells)].map(cell => ({ $eq: ['$r.cell6', { $const: cell }] })) } : false);
  return { $for: { r: '$[*]' }, $where: { $and: where }, $orderby: ['$r.id'], $return: '$r' };
}
async function readGazetteer(collection: DbCollection<PlaceRow>, id: string): Promise<PlaceResult<{ view: GazetteerView; rows: PlaceRow[] }>> {
  const rows = asRows(await collection.execute<PlaceRow>(placeReadDocument(id)));
  if (!rows.length) return placeRefuse('TPLC1004', `unknown gazetteer: ${id}`);
  const header = rows.find(row => row.id === rowId('gazetteer', id) && row.recordType === 'gazetteer');
  if (!header) return placeRefuse('TPLC1001', 'persisted gazetteer header is missing');
  const view = await createGazetteer({ id, revision: header.revision, entries: rows.filter(row => row.recordType === 'entry').map(row => row.payload) });
  if (view.status !== 'success') return view;
  const expected = physicalRows(view.value); if (expected.status !== 'success') return expected;
  if (!same(ordered(rows), expected.value)) return placeRefuse('TPLC1001', 'persisted gazetteer inventory, payload or coordinate mirrors differ');
  return placeSuccess({ view: view.value, rows });
}
export function createPlaceDbStore(db: TangleDb, options: PlaceDbOptions = {}): PlaceDbStore {
  let writes = 0, transactions = 0;
  async function transaction<T>(task: (collection: DbCollection<PlaceRow>) => Promise<PlaceResult<T>>): Promise<PlaceResult<T>> {
    try {
      return await db.transaction(async tx => { transactions++; return task(tx.collection<PlaceRow>('place_gazetteer')); }, { mode: 'immediate' });
    } catch (cause) { return placeRefuse('TPLC1010', cause instanceof Error ? cause.message : String(cause)); }
  }
  async function read<T>(id: string, task: (value: { view: GazetteerView; rows: PlaceRow[] }, collection: DbCollection<PlaceRow>) => Promise<PlaceResult<T>>): Promise<PlaceResult<T>> {
    if (typeof id !== 'string' || !id.length) return placeRefuse('TPLC1001', 'gazetteer id must be a nonempty string');
    return transaction(async collection => {
      const value = await readGazetteer(collection, id);
      return value.status === 'success' ? task(value.value, collection) : value;
    });
  }
  return {
    async loadGazetteer(input) {
      // A view's two lookup functions are not persisted. All document members
      // still pass the closed gazetteer contract; unknown members are refused.
      let document: unknown = input;
      if (input && typeof input === 'object' && 'byId' in input && 'byName' in input && typeof input.byId === 'function' && typeof input.byName === 'function') {
        const { byId: _byId, byName: _byName, ...content } = input; document = content;
      }
      const checked = await createGazetteer(document); if (checked.status !== 'success') return checked;
      const rows = physicalRows(checked.value); if (rows.status !== 'success') return rows;
      const result = await transaction(async collection => {
        const existing = asRows(await collection.execute<PlaceRow>(placeReadDocument(checked.value.id)));
        if (existing.length) {
          const header = existing.find(row => row.id === rowId('gazetteer', checked.value.id) && row.recordType === 'gazetteer');
          if (header && header.revision !== checked.value.revision) return placeRefuse('TPLC1001', 'gazetteer revision differs; load under a new id');
          if (!same(ordered(existing), rows.value)) return placeRefuse('TPLC1001', 'persisted gazetteer inventory, payload or coordinate mirrors differ');
          return placeSuccess({ writes: 0, replayed: true });
        }
        for (const row of rows.value) { await collection.put(row); options.applyProbe?.(row.recordType === 'entry' ? 'put:entry' : 'put:gazetteer'); }
        options.applyProbe?.('commit');
        return placeSuccess({ writes: rows.value.length, replayed: false });
      });
      if (result.status === 'success') writes += result.value.writes;
      return result;
    },
    entry(id, entryId) {
      if (typeof entryId !== 'string' || !entryId.length) return Promise.resolve(placeRefuse('TPLC1001', 'entry id must be a nonempty string'));
      return read(id, async ({ view }) => view.byId(entryId));
    },
    entries(id) { return read(id, async ({ view }) => placeSuccess(view.entries)); },
    entriesInCells(id, cells) {
      if (!Array.isArray(cells) || cells.some(cell => typeof cell !== 'string' || cell.length !== 6 || geohashBounds(cell) === null)) {
        return Promise.resolve(placeRefuse('TPLC1001', 'stored cell lookups require valid precision-six geohashes'));
      }
      // Full revision/mirror verification precedes the cell query in the same
      // snapshot. This conservative adapter does not claim bounded read I/O.
      return read(id, async ({ rows }, collection) => {
        const selected = asRows(await collection.execute<PlaceRow>(placeReadDocument(id, cells)));
        const expected = rows.filter(row => row.recordType === 'entry' && cells.includes(row.cell6!));
        if (!same(ordered(selected), ordered(expected))) return placeRefuse('TPLC1001', 'stored cell query differs from the verified gazetteer');
        return placeSuccess(selected.map(row => row.payload as GazetteerEntry).sort((a, b) => compareCodePoints(a.id, b.id)));
      });
    },
    stats() { return { writes, transactions }; },
  };
}
