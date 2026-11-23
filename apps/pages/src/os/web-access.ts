/**
 * Web access on the Pages desktop: a page on GitHub Pages cannot read most of
 * the web itself, so it calls a host's web reader (the Tangle desktop serves
 * one at {@link WEB_READER_EXAMPLE}) at the address the person set in
 * Settings. The reader the kernel gets reads that preference on every call,
 * so a new address works at once; with none set it answers `OS0180`.
 */
import { httpWebReader, unconfiguredWebReader, type WebReader } from '@tangleai/os';

/** Where a Tangle desktop on this machine serves its reader. */
export const WEB_READER_EXAMPLE = 'http://127.0.0.1:4700/api/web-reader';

/** A reader address as stored: an http(s) address without a query or fragment, `''` for none, `null` when it is not one. */
export function webReaderAddress(value: unknown): string | null {
  if (typeof value !== 'string') return value === undefined || value === null ? '' : null;
  const text = value.trim();
  if (text === '') return '';
  if (text.length > 2048) return null;
  try {
    const url = new URL(text);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/+$/, '');
  } catch { return null; }
}

/** The desktop's reader: the one at the address `address()` answers now, or none. */
export function pagesWebReader(address: () => string, options: { fetch?: typeof globalThis.fetch } = {}): WebReader {
  let cached: { at: string, reader: WebReader } | null = null;
  const none = unconfiguredWebReader();
  const current = () => {
    const at = address();
    if (!at) return none;
    if (cached?.at !== at) cached = { at, reader: httpWebReader(at, options) };
    return cached.reader;
  };
  return { read: (input) => current().read(input), search: (input) => current().search(input) };
}

/**
 * Whether a reader answers at `at`: it reads a loopback address, which a
 * reader refuses (`OS0181`) without fetching anything. Any answer the
 * contract declares shows a reader is there; silence does not.
 */
export async function testWebReader(at: string, options: { fetch?: typeof globalThis.fetch } = {}): Promise<{ ok: true } | { ok: false, detail: string }> {
  try { await httpWebReader(at, { ...options, timeoutMs: 10_000 }).read({ url: 'http://127.0.0.1/' }); return { ok: true }; }
  catch (error: any) {
    return error?.unanswered === true || !error?.code ? { ok: false, detail: String(error?.message ?? error) } : { ok: true };
  }
}
