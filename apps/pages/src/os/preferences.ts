/**
 * The desktop's preferences and the assistant's connections, kept in this
 * browser only.
 *
 * - `tangle-os-providers` holds one connection per provider (its key, region or
 *   address, and last model), which provider is active, and the person's
 *   starred models. Each key stays with its own provider: switching providers
 *   never sends one provider's key to another.
 * - `tangle-ai` mirrors the active connection in the shape the Pages assistant
 *   reads, so a key entered on the desktop also works on the Pages home page
 *   (and the first visit imports what the home page saved there).
 * - With "remember" off, keys live in this tab's sessionStorage
 *   (`tangle-os-session-keys`) and neither localStorage slot holds a key.
 * - `tangle-os` holds the desktop's own preferences (theme, accent, wallpaper,
 *   the address of the host's web reader: not a secret).
 *
 * Nothing here is handed to a module, a contract, the kernel's ledger or the
 * assistant's tools: framed modules run in other origins (or an opaque one) and
 * cannot read this storage, and a key leaves the browser only in the
 * Authorization header of a request to its own provider.
 */
import { THEME_KITS, composeTheme, type ThemeCustom, type ThemeDocument } from '@tangleai/os';
import { webReaderAddress } from './web-access.ts';
import { jobQueueAddress } from './job-access.ts';

export type AiSettings = { provider: string, baseUrl: string, model: string, apiKey: string };
export type Scheme = 'system' | 'light' | 'dark';
/** The desktop's look: a theme kit and what the person changed on it, plus the scheme. */
export type DesktopPreferences = { scheme: Scheme, kit: string, custom: ThemeCustom, rememberKey: boolean, /** `system` follows the browser; otherwise a language code. */ language: string, /** The host's web reader (`''` for none): see `web-access.ts`. */ webReader: string, /** The host's job queue (`''` for none): see `job-access.ts`. */ jobQueue: string };
export type ProviderKind = 'openrouter' | 'venice' | 'ollama' | 'lmstudio' | 'custom';
export type Connection = { apiKey: string, baseUrl: string, model: string };
export type Favourite = { kind: ProviderKind, model: string };

export const AI_SLOT = 'tangle-ai';
export const PROVIDERS_SLOT = 'tangle-os-providers';
export const SESSION_KEYS_SLOT = 'tangle-os-session-keys';
export const OS_SLOT = 'tangle-os';
export const CHAT_SLOT = 'tangle-os-chat';
/** What the person decided on failed background jobs (the job watcher's memory). */
export const JOBS_DECIDED_SLOT = 'tangle-os-jobs-decided';
/** The slot an earlier build of this page kept a tab-only key in. */
const LEGACY_SESSION_KEY = 'tangle-ai-session-key';

export const VENICE_BASE = 'https://api.venice.ai/api/v1';
export const RECOMMENDED_MODELS = ['anthropic/claude-haiku-5.5', 'qwen/qwen3.8-27b'];

/**
 * The providers the desktop offers. Venice speaks the OpenAI protocol, so the
 * chat client reaches it as an OpenAI-compatible endpoint at its fixed URL.
 */
export const PROVIDER_KINDS: Record<ProviderKind, { label: string, needsKey: boolean, local: boolean, defaultModel: string }> = {
  openrouter: { label: 'OpenRouter', needsKey: true, local: false, defaultModel: RECOMMENDED_MODELS[0] },
  venice: { label: 'Venice', needsKey: true, local: false, defaultModel: '' },
  ollama: { label: 'Ollama', needsKey: false, local: true, defaultModel: '' },
  lmstudio: { label: 'LM Studio', needsKey: false, local: true, defaultModel: '' },
  custom: { label: 'OpenAI-compatible', needsKey: true, local: false, defaultModel: '' },
};
const KINDS = Object.keys(PROVIDER_KINDS) as ProviderKind[];
const isKind = (value: unknown): value is ProviderKind => typeof value === 'string' && (KINDS as string[]).includes(value);

/** The chat client's view of a connection. */
export function toAiSettings(kind: ProviderKind, c: Connection): AiSettings {
  return kind === 'venice'
    ? { provider: 'custom', baseUrl: VENICE_BASE, model: c.model, apiKey: c.apiKey }
    : { provider: kind, baseUrl: c.baseUrl, model: c.model, apiKey: c.apiKey };
}
/** Which of the desktop's providers a chat client's settings describe. */
export function kindOf(s: Pick<AiSettings, 'provider' | 'baseUrl'>): ProviderKind {
  if (s.provider === 'custom' && s.baseUrl.replace(/\/+$/, '') === VENICE_BASE) return 'venice';
  return isKind(s.provider) ? s.provider : 'openrouter';
}

const DEFAULT_PREFS: DesktopPreferences = { scheme: 'system', kit: 'loom', custom: {}, rememberKey: true, language: 'system', webReader: '', jobQueue: '' };

/** Accent colours offered beside the colour picker. */
export const ACCENT_SWATCHES = ['#0a6d67', '#2d6959', '#b81c5c', '#1f5fa8', '#1b6a85', '#6d28d9', '#9a4708', '#334155'];

const CORNERS = ['sharp', 'soft', 'round'], SPACINGS = ['compact', 'comfortable'];
const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined;
/** Keep only well-formed changes: a stored or imported theme can carry nothing else. */
export function cleanCustom(raw: any): ThemeCustom {
  const c: ThemeCustom = {};
  if (!raw || typeof raw !== 'object') return c;
  if (hex(raw.accent)) c.accent = raw.accent;
  if (hex(raw.knot)) c.knot = raw.knot;
  if (typeof raw.pattern === 'string' && /^[a-z]{2,20}$/.test(raw.pattern)) c.pattern = raw.pattern;
  if (Number.isInteger(raw.seed) && raw.seed >= 0 && raw.seed < 2 ** 31) c.seed = raw.seed;
  if (typeof raw.density === 'number' && raw.density >= 0.3 && raw.density <= 2) c.density = raw.density;
  if (typeof raw.glass === 'number' && raw.glass >= 0 && raw.glass <= 1) c.glass = raw.glass;
  if (CORNERS.includes(raw.corners)) c.corners = raw.corners;
  if (SPACINGS.includes(raw.spacing)) c.spacing = raw.spacing;
  return c;
}

function readJson(storage: Storage | undefined, key: string): any {
  try { return JSON.parse(storage?.getItem(key) ?? 'null'); } catch { return null; }
}
function writeJson(storage: Storage | undefined, key: string, value: unknown) {
  try { storage?.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(storage: Storage | undefined, key: string) { try { storage?.removeItem(key); } catch { /* nothing kept */ } }
const str = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;

type ProvidersDoc = { active: ProviderKind, connections: Partial<Record<ProviderKind, Connection>>, favourites: Favourite[] };

export function createPreferences(win: Window) {
  const local = (() => { try { return win.localStorage; } catch { return undefined; } })();
  const session = (() => { try { return win.sessionStorage; } catch { return undefined; } })();
  const listeners = new Set<(what: 'ai' | 'desktop', source: string) => void>();
  const emit = (what: 'ai' | 'desktop', source: string) => { for (const l of listeners) l(what, source); };

  function desktop(): DesktopPreferences {
    const raw = readJson(local, OS_SLOT) ?? {};
    return {
      scheme: raw.scheme === 'light' || raw.scheme === 'dark' ? raw.scheme : 'system',
      kit: THEME_KITS.some(k => k.id === raw.kit) ? raw.kit : DEFAULT_PREFS.kit,
      custom: cleanCustom(raw.custom),
      rememberKey: raw.rememberKey !== false,
      language: typeof raw.language === 'string' && /^[a-z]{2}(-[A-Z]{2})?$|^system$/.test(raw.language) ? raw.language : 'system',
      webReader: webReaderAddress(raw.webReader) ?? '',
      jobQueue: jobQueueAddress(raw.jobQueue) ?? '',
    };
  }

  /** The providers document, imported from the Pages assistant's slot on a first visit. */
  function doc(): ProvidersDoc {
    const raw = readJson(local, PROVIDERS_SLOT);
    const connections: ProvidersDoc['connections'] = {};
    let active: ProviderKind = 'openrouter', favourites: Favourite[] = [];
    if (raw && typeof raw === 'object') {
      if (isKind(raw.active)) active = raw.active;
      for (const kind of KINDS) {
        const c = raw.connections?.[kind];
        if (c && typeof c === 'object') connections[kind] = { apiKey: str(c.apiKey), baseUrl: kind === 'venice' ? '' : str(c.baseUrl), model: str(c.model) };
      }
      if (Array.isArray(raw.favourites)) favourites = raw.favourites.filter((f: any) => isKind(f?.kind) && typeof f?.model === 'string' && f.model).map((f: any) => ({ kind: f.kind, model: f.model }));
    } else {
      const pages = readJson(local, AI_SLOT);
      if (pages && typeof pages === 'object') {
        const s = { provider: str(pages.provider, 'openrouter'), baseUrl: str(pages.baseUrl), model: str(pages.model), apiKey: str(pages.apiKey) };
        active = kindOf(s);
        connections[active] = { apiKey: s.apiKey || str(session?.getItem(LEGACY_SESSION_KEY)), baseUrl: active === 'venice' ? '' : s.baseUrl, model: s.model };
      }
    }
    // keys kept for this tab only fill in where the remembered document has none
    const tabKeys = readJson(session, SESSION_KEYS_SLOT) ?? {};
    for (const kind of KINDS) {
      const key = str(tabKeys[kind]);
      if (key && !connections[kind]?.apiKey) connections[kind] = { ...blank(kind), ...connections[kind], apiKey: key };
    }
    return { active, connections, favourites };
  }
  const blank = (kind: ProviderKind): Connection => ({ apiKey: '', baseUrl: '', model: PROVIDER_KINDS[kind].defaultModel });

  /** Persist the document: keys to local or session storage by the person's choice, the active one mirrored for the Pages assistant. */
  function save(next: ProvidersDoc, source: string) {
    const remember = desktop().rememberKey;
    const stored: ProvidersDoc = { active: next.active, favourites: next.favourites, connections: {} };
    const tabKeys: Partial<Record<ProviderKind, string>> = {};
    for (const kind of KINDS) {
      const c = next.connections[kind];
      if (!c) continue;
      stored.connections[kind] = { ...c, apiKey: remember ? c.apiKey : '' };
      if (!remember && c.apiKey) tabKeys[kind] = c.apiKey;
    }
    const ok = writeJson(local, PROVIDERS_SLOT, stored);
    if (Object.keys(tabKeys).length) writeJson(session, SESSION_KEYS_SLOT, tabKeys); else remove(session, SESSION_KEYS_SLOT);
    remove(session, LEGACY_SESSION_KEY);
    const active = toAiSettings(next.active, next.connections[next.active] ?? blank(next.active));
    writeJson(local, AI_SLOT, { ...active, apiKey: remember ? active.apiKey : '' });
    emit('ai', source);
    return ok;
  }

  const active = () => doc().active;
  const connection = (kind: ProviderKind): Connection => ({ ...blank(kind), ...doc().connections[kind] });

  /** Change one provider's connection; it becomes the active one unless `activate` is false. */
  function setConnection(kind: ProviderKind, patch: Partial<Connection>, source = 'settings', activate = true) {
    const d = doc();
    d.connections[kind] = { ...blank(kind), ...d.connections[kind], ...patch };
    if (activate) d.active = kind;
    return save(d, source);
  }
  function use(kind: ProviderKind, model?: string, source = 'settings') {
    const d = doc();
    d.active = kind;
    if (model !== undefined) d.connections[kind] = { ...blank(kind), ...d.connections[kind], model };
    return save(d, source);
  }

  /** The active connection in the chat client's shape (the assistant reads this). */
  const ai = (): AiSettings => { const d = doc(); return toAiSettings(d.active, { ...blank(d.active), ...d.connections[d.active] }); };
  /** The assistant panel's own settings form saves here: to the provider it describes. */
  function writeAi(next: AiSettings, source = 'assistant') {
    const d = doc(), kind = kindOf(next);
    // that form keeps one key field across its provider switch: a key it
    // carried over from another provider is not this provider's key
    const carried = kind !== d.active && next.apiKey !== '' && next.apiKey === (d.connections[d.active]?.apiKey ?? '');
    const apiKey = carried ? (d.connections[kind]?.apiKey ?? '') : next.apiKey;
    return setConnection(kind, { apiKey, baseUrl: kind === 'venice' ? '' : next.baseUrl, model: next.model }, source);
  }

  const favourites = () => doc().favourites;
  const isFavourite = (kind: ProviderKind, model: string) => doc().favourites.some(f => f.kind === kind && f.model === model);
  function toggleFavourite(kind: ProviderKind, model: string, source = 'settings') {
    const d = doc();
    d.favourites = isFavourite(kind, model) ? d.favourites.filter(f => !(f.kind === kind && f.model === model)) : [...d.favourites, { kind, model }];
    return save(d, source);
  }

  function writeDesktop(patch: Partial<DesktopPreferences>, source = 'settings') {
    const before = desktop();
    const next = { ...before, ...patch };
    writeJson(local, OS_SLOT, next);
    // moving the keys between local and session storage when "remember" flips
    if (before.rememberKey !== next.rememberKey) save(doc(), source);
    emit('desktop', source);
    return next;
  }

  function forgetKey(kind: ProviderKind = active()) { setConnection(kind, { apiKey: '' }, 'settings', false); }

  /** Remove everything this desktop and its assistant keep in this browser. */
  function forgetEverything() {
    for (const key of [AI_SLOT, PROVIDERS_SLOT, OS_SLOT, CHAT_SLOT, JOBS_DECIDED_SLOT]) remove(local, key);
    for (const key of [SESSION_KEYS_SLOT, LEGACY_SESSION_KEY]) remove(session, key);
    emit('ai', 'reset'); emit('desktop', 'reset');
  }

  /** The scheme to show now: an explicit choice, or the system's. */
  function effectiveScheme(prefs = desktop()): 'light' | 'dark' {
    if (prefs.scheme !== 'system') return prefs.scheme;
    return win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /** The person's theme for a scheme: their kit with their changes. */
  function theme(scheme: 'light' | 'dark', prefs = desktop()): ThemeDocument {
    return composeTheme(prefs.kit, scheme, prefs.custom);
  }

  return {
    ai, writeAi, active, connection, setConnection, use, favourites, isFavourite, toggleFavourite,
    forgetKey, desktop, writeDesktop, forgetEverything, effectiveScheme, theme,
    subscribe(listener: (what: 'ai' | 'desktop', source: string) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    /** The assistant's transcript slot for this desktop (separate from the Pages assistant's). */
    chat: {
      read: () => readJson(local, CHAT_SLOT),
      write: (value: unknown) => writeJson(local, CHAT_SLOT, value),
      clear: () => remove(local, CHAT_SLOT),
    },
  };
}

export type Preferences = ReturnType<typeof createPreferences>;
