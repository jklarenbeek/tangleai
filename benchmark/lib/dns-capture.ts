/**
 * The web row's name resolutions, recorded beside its HTTP capture.
 *
 * The safe fetcher resolves every host before it fetches, and refuses a
 * name that resolves to a private address. The HTTP capture holds the
 * exchanges but not those answers, so a replay that resolved names again
 * would depend on today's DNS, and one that invented an address could
 * admit a URL the run refused. This log keeps each host's answers in the
 * order the run received them — addresses, or the failure's code and
 * message — and a replay serves them in that order without resolving
 * anything. A host the run never resolved is a named failure, counted.
 *
 * The log lives in the gitignored `benchmark/cache/` beside the capture,
 * so a replay works on the machine that bought the run.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { AddressLookup } from '@tangleai/documents';

type Address = { address: string, family: number };
type Answer = { addresses: Address[] } | { error: { code: string | null, message: string } };

export interface DnsLog {
  version: 1;
  hosts: Record<string, Answer[]>;
}

/** The log that belongs to a capture file: `grounding-http.sqlite` → `grounding-http-dns.json`. */
export function dnsLogPathOf(capturePath: string): string {
  return `${capturePath.replace(/\.sqlite$/, '')}-dns.json`;
}

/** Resolve through `inner` and keep every answer, failures included. */
export function recordingLookup(inner: AddressLookup): { lookup: AddressLookup, log: DnsLog } {
  const log: DnsLog = { version: 1, hosts: {} };
  const lookup: AddressLookup = async (hostname) => {
    const answers = (log.hosts[hostname] ??= []);
    try {
      const addresses = await inner(hostname);
      answers.push({ addresses: addresses.map(({ address, family }) => ({ address, family })) });
      return addresses;
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      answers.push({ error: { code: typeof code === 'string' ? code : null, message: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
  };
  return { lookup, log };
}

/** Serve a recorded log in order, the last answer repeating; never resolve. */
export function replayingLookup(log: DnsLog): { lookup: AddressLookup, misses: () => number } {
  const served = new Map<string, number>();
  let misses = 0;
  const lookup: AddressLookup = async (hostname) => {
    const answers = Object.hasOwn(log.hosts, hostname) ? log.hosts[hostname] : [];
    if (answers.length === 0) {
      misses++;
      throw new Error(`no recorded resolution for ${hostname}; a replay never resolves names`);
    }
    const index = Math.min(served.get(hostname) ?? 0, answers.length - 1);
    served.set(hostname, index + 1);
    const answer = answers[index];
    if ('error' in answer) throw Object.assign(new Error(answer.error.message), answer.error.code === null ? {} : { code: answer.error.code });
    return answer.addresses.map(({ address, family }) => ({ address, family }));
  };
  return { lookup, misses: () => misses };
}

export async function writeDnsLog(path: string, log: DnsLog): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(log, null, 2)}\n`);
}

/** Read a log, refusing anything that is not one: a replay must not run on a guess. */
export async function readDnsLog(path: string): Promise<DnsLog> {
  const log = JSON.parse(await readFile(path, 'utf8')) as DnsLog;
  const valid = log?.version === 1 && typeof log.hosts === 'object' && log.hosts !== null
    && Object.values(log.hosts).every((answers) => Array.isArray(answers) && answers.every((answer) =>
      (Array.isArray((answer as { addresses?: unknown }).addresses)
        && (answer as { addresses: Address[] }).addresses.every((a) => typeof a.address === 'string' && Number.isInteger(a.family)))
      || typeof (answer as { error?: { message?: unknown } }).error?.message === 'string'));
  if (!valid) throw new Error(`${path} is not a recorded DNS log`);
  return log;
}
