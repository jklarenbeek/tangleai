/**
 * Consent for applications a person joins: what an install sheet showed them
 * and what they allowed. A suite reached by a link installs nothing by itself;
 * the person sees each application's origin, the contracts it provides, what
 * it asks to use and whether the assistant may use it, and the kernel keeps
 * exactly that. When a later suite document asks for more than was shown (a
 * scope, a contract, another origin), the person is asked again; nothing
 * widens silently.
 */
import type { ModuleManifest } from './manifest.ts';

/** What a person allowed one joined application, bound to what they were shown. */
export type Consent = {
  /** The suite document the application came from, when it came from one. */
  source?: string,
  /** The origin its pages are served from (`null` for a document module). */
  origin: string | null,
  /** The scopes the sheet offered (`contract.op` or `contract.*`) and the ones the person allowed. */
  offered: string[],
  scopes: string[],
  /** The contracts it provides as shown; the assistant reaches these only with `assistant`. */
  provides: string[],
  assistant: boolean,
  at: number,
};

/** An application the person installed, as kept in their state: its manifest and their consent. */
export type InstalledApp = { manifest: ModuleManifest, consent: Consent };

/** The person's state document of joined applications. */
export const APPS_KEY = 'apps';

/** The scopes a manifest asks for: one per named operation, or the whole contract. */
export function scopesOf(manifest: Pick<ModuleManifest, 'requires'>): string[] {
  const out: string[] = [];
  for (const need of manifest.requires ?? []) {
    if (need.operations?.length) for (const op of need.operations) out.push(`${need.contract}.${op}`);
    else out.push(`${need.contract}.*`);
  }
  return [...new Set(out)];
}

/** Where a manifest's pages come from: an origin, or null for a document module. */
export function originOf(manifest: Pick<ModuleManifest, 'host'>): string | null {
  const host: any = manifest.host;
  if (host?.kind === 'origin' && typeof host.url === 'string') { try { return new URL(host.url).origin; } catch { return null; } }
  return null;
}

/** Whether an origin is on this device or the local network, where a browser may ask the person first. */
export function isLocalOrigin(origin: string | null): boolean {
  if (!origin) return false;
  let host: string;
  try { host = new URL(origin).hostname.replace(/^\[|\]$/g, ''); } catch { return false; }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1') return true;
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!v4) return /^(fc|fd|fe80)/i.test(host);
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}

/**
 * Whether installing `manifest` needs the person's consent, against what they
 * allowed before: none kept (`new`), another origin (`origin`), or a scope or
 * contract they were not shown (`more`, with what is new).
 */
export function consentNeeded(manifest: ModuleManifest, before: Consent | null): { needed: false } | { needed: true, reason: 'new' | 'origin' | 'more', scopes: string[], provides: string[] } {
  const scopes = scopesOf(manifest), provides = (manifest.provides ?? []).map(c => c.id);
  if (!before) return { needed: true, reason: 'new', scopes, provides };
  if (originOf(manifest) !== before.origin) return { needed: true, reason: 'origin', scopes, provides };
  const newScopes = scopes.filter(s => !before.offered.includes(s));
  const newProvides = provides.filter(p => !before.provides.includes(p));
  if (newScopes.length || newProvides.length) return { needed: true, reason: 'more', scopes: newScopes, provides: newProvides };
  return { needed: false };
}
