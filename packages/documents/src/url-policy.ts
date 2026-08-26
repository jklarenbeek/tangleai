import { lookup as nodeLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { DocumentError } from './contracts.ts';

export type AddressLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface UrlPolicyOptions {
  allowPrivate?: boolean;
  lookup?: AddressLookup;
}

export function normalizeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new DocumentError('invalid-url', 'The document URL is invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DocumentError('blocked-url', 'Only HTTP and HTTPS document URLs are allowed');
  }
  if (url.username !== '' || url.password !== '') {
    throw new DocumentError('blocked-url', 'Credentials are not allowed in document URLs');
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }
  return url.toString();
}

function ipv4Parts(address: string): number[] | undefined {
  if (isIP(address) !== 4) return undefined;
  const parts = address.split('.').map(Number);
  return parts.length === 4 && parts.every((part) => part >= 0 && part <= 255) ? parts : undefined;
}

export function isReservedAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  const v4 = ipv4Parts(mapped ?? address);
  if (v4 !== undefined) {
    const [a, b, c] = v4;
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }

  if (isIP(address) !== 6) return true;
  const lower = address.toLowerCase();
  return lower === '::' || lower === '::1'
    || lower.startsWith('fc') || lower.startsWith('fd')
    || /^fe[89ab]/.test(lower)
    || lower.startsWith('ff')
    || lower.startsWith('2001:db8:');
}

const defaultLookup: AddressLookup = async (hostname) => {
  const literal = isIP(hostname);
  if (literal !== 0) return [{ address: hostname, family: literal }];
  return nodeLookup(hostname, { all: true, verbatim: true });
};

/** Resolve and validate every address immediately before each request. */
export async function assertPublicUrl(input: string, options: UrlPolicyOptions = {}): Promise<string> {
  const normalized = normalizeUrl(input);
  if (options.allowPrivate === true) return normalized;
  const url = new URL(normalized);
  const literal = isIP(url.hostname);
  const addresses = literal === 0
    ? await (options.lookup ?? defaultLookup)(url.hostname)
    : [{ address: url.hostname, family: literal }];
  if (addresses.length === 0) throw new DocumentError('dns-failed', `No address resolved for ${url.hostname}`);
  const blocked = addresses.find(({ address }) => isReservedAddress(address));
  if (blocked !== undefined) {
    throw new DocumentError('blocked-address', `The destination resolves to a protected address (${blocked.address})`);
  }
  return normalized;
}
