/**
 * The desktop's side of a host's web reader: a {@link WebReader} that calls
 * the `web_reader` contract a host serves over HTTP. The host's declared
 * `refused` and `unreadable` answers become `OS0181` and `OS0182`; a host
 * that cannot be reached, or answers outside the contract, is `OS0182` too,
 * marked `unanswered: true`.
 */
import { compileContract } from '@jarenjs/contract';
import { openHttpClient } from '@jarenjs/contract/client';
import { WEB_CODES, WEB_READER_CONTRACT, type WebReader } from './web.ts';

let compiled: any = null;

const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

/** A reader over the contract a host serves at `baseUrl` (for example `http://127.0.0.1:4700/api/web-reader`). */
export function httpWebReader(baseUrl: string, options: { fetch?: typeof globalThis.fetch, timeoutMs?: number } = {}): WebReader {
  compiled ??= compileContract(WEB_READER_CONTRACT as any);
  const client = openHttpClient(compiled, {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    timeoutMs: options.timeoutMs ?? 30_000,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const invoke = async (op: string, input: unknown) => {
    const outcome: any = await client.invoke(op, input);
    if (outcome.ok) return outcome.value;
    const detail = String(outcome.error?.details?.detail ?? outcome.error?.message ?? outcome.kind);
    if (outcome.kind === 'failure' && outcome.error?.code === 'refused') throw coded(WEB_CODES.refused, detail);
    if (outcome.kind === 'failure' && outcome.error?.code === 'unreadable') throw coded(WEB_CODES.unreadable, detail);
    throw Object.assign(coded(WEB_CODES.unreadable, `the web reader at ${baseUrl} did not answer: ${detail}`), { unanswered: true });
  };
  return {
    read: (input) => invoke('web.read', input),
    search: (input) => invoke('web.search', input),
  };
}
