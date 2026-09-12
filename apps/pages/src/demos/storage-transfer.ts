/** Explicit, lossless browser-data transfer. Settings are never a transfer member. */
export const TRANSFER_MEMBERS = ['transcript', 'ledger', 'game', 'projects', 'play'] as const;
export type TransferMember = typeof TRANSFER_MEMBERS[number];
export type TransferSlots = Partial<Record<TransferMember, { read(): unknown; write(value: any): unknown }>>;
export interface BrowserTransfer { format: 'tangle-browser-data'; version: 1; data: Partial<Record<TransferMember, unknown>> }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const empty = (value: unknown) => value == null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0);
const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => record(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function nonSecret(value: unknown, secrets: readonly string[]) {
  const visit = (item: unknown) => {
    if (typeof item === 'string' && secrets.some(secret => secret && item.includes(secret))) throw new Error('Selected data contains a configured credential; remove it before exporting.');
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) {
      if (/^(?:api[-_]?key|authorization|access[-_]?token|password|secret|__proto__|constructor|prototype)$/i.test(key)) throw new Error(`Refused private or unsafe member: ${key}`);
      visit(child);
    }
  };
  visit(value);
}
export function validateTransfer(input: unknown, secrets: readonly string[] = []): BrowserTransfer {
  if (!record(input) || input.format !== 'tangle-browser-data' || input.version !== 1 || !record(input.data)
      || Object.keys(input).some(key => !['format', 'version', 'data'].includes(key))) throw new Error('Unsupported browser data transfer.');
  for (const [key, value] of Object.entries(input.data)) {
    if (!TRANSFER_MEMBERS.includes(key as TransferMember)) throw new Error(`Unknown transfer member: ${key}`);
    if (key === 'transcript' ? !(record(value) && Array.isArray(value.messages)) : key === 'game' ? typeof value !== 'string' : !record(value)) throw new Error(`Invalid ${key} data.`);
    if (key === 'ledger' && Object.keys(value as object).some(name => !/^ai\/(?:state|snap|counters)\//.test(name))) throw new Error('Unknown ledger namespace.');
  }
  nonSecret(input.data, secrets);
  return structuredClone(input) as unknown as BrowserTransfer;
}
export function exportBrowserData(slots: TransferSlots, selected: readonly TransferMember[], secrets: readonly string[] = []): BrowserTransfer {
  const data: BrowserTransfer['data'] = {};
  for (const key of selected) {
    if (!TRANSFER_MEMBERS.includes(key) || !slots[key]) throw new Error(`Unavailable transfer member: ${key}`);
    const value = slots[key]!.read();
    if (!empty(value)) data[key] = value;
  }
  return validateTransfer({ format: 'tangle-browser-data', version: 1, data }, secrets);
}
/** Call only after the local host closes. The browser wrapper also excludes other writers. */
export async function importBrowserData(input: unknown, slots: TransferSlots, secrets: readonly string[] = []) {
  const transfer = validateTransfer(input, secrets), pending: Array<[TransferMember, unknown]> = [], unchanged: TransferMember[] = [];
  // Check every destination before writing any. Existing unequal data is never overwritten.
  for (const [name, value] of Object.entries(transfer.data)) {
    const key = name as TransferMember, slot = slots[key];
    if (!slot) throw new Error(`Unavailable destination: ${key}`);
    const before = slot.read();
    if (stable(before) === stable(value)) unchanged.push(key);
    else if (!empty(before)) throw new Error(`${key} already contains different data. Use a fresh browser profile or export and clear that slot explicitly first.`);
    else pending.push([key, value]);
  }
  const written: TransferMember[] = [];
  for (const [key, value] of pending) {
    try {
      if (await slots[key]!.write(structuredClone(value)) === false) throw new Error('write refused');
      if (stable(slots[key]!.read()) !== stable(value)) throw new Error('read-back differs');
      written.push(key);
    } catch (cause) {
      // Whole browser slots have no cross-slot transaction. Report partial progress honestly;
      // the same file is safe to retry because completed slots are compared before writing.
      throw new Error(`Import stopped at ${key}; completed: ${written.join(', ') || 'none'}. ${String(cause)}`);
    }
  }
  return { written, unchanged };
}
