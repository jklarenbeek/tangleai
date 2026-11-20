/**
 * Settings: the assistant's providers (each with its own key, region or
 * address), the models (starred ones are one click away), the desktop's
 * appearance, and what this browser keeps. Shipped code in the desktop's own
 * page; a key is shown only in a password field and sent only to its own
 * provider.
 */
import { PROVIDERS, probeProvider } from '@tangleai/models/providers';
import type { SettingsSection } from '@tangleai/os/settings';
import { THEME_KITS, composeTheme, emptyDock, patternBackground, type Kernel } from '@tangleai/os';

import {
  ACCENT_SWATCHES, PROVIDER_KINDS, RECOMMENDED_MODELS, VENICE_BASE, cleanCustom, toAiSettings,
  type Preferences, type ProviderKind, type Scheme,
} from './preferences.ts';
import { englishOf, localizedKeywords, localizedText, t } from './i18n.ts';
import { LANGUAGES, resolveLanguage } from './language.ts';

/** The wallpaper patterns, by what they look like. */
/** A theme kit's name and line in the desktop's language (a kit a host adds keeps its own). */
const kitText = (id: string): [string, string] | undefined => ({
  loom: [t('appearance/kit-loom'), t('appearance/kit-loom-about')],
  topograph: [t('appearance/kit-topograph'), t('appearance/kit-topograph-about')],
  risograph: [t('appearance/kit-risograph'), t('appearance/kit-risograph-about')],
  cyanotype: [t('appearance/kit-cyanotype'), t('appearance/kit-cyanotype-about')],
  tide: [t('appearance/kit-tide'), t('appearance/kit-tide-about')],
} as Record<string, [string, string]>)[id];
const patternNames = (): Record<string, string> => ({ weave: t('appearance/pattern-weave'), contours: t('appearance/pattern-contours'), halftone: t('appearance/pattern-halftone'), sunprint: t('appearance/pattern-sunprint'), moire: t('appearance/pattern-moire') });
/** A provider's name as the person reads it: product names as written, the generic endpoint in their language. */
export const providerLabel = (kind: ProviderKind) => kind === 'custom' ? t('providers/custom') : PROVIDER_KINDS[kind].label;

type ModelRow = { id: string, name: string, context?: number, prompt?: number, completion?: number, tools: boolean, privacy?: string };

const OPENROUTER = 'https://openrouter.ai/api/v1';
/**
 * OpenRouter has no base URL to type, only a region: any region (it may use
 * every provider of a model, wherever it runs), or in-region routing (Business
 * and Enterprise plans) that keeps inference in Europe or the United States
 * and fails rather than leave it.
 */
export const OPENROUTER_REGIONS = ['', 'https://eu.openrouter.ai/api/v1', 'https://us.openrouter.ai/api/v1'] as const;
/** The region menu: each region's address and its label. */
const regionChoices = (): [string, string][] => [
  ['', t('providers/region-any')],
  [OPENROUTER_REGIONS[1], t('providers/region-eu', { host: 'eu.openrouter.ai' })],
  [OPENROUTER_REGIONS[2], t('providers/region-us', { host: 'us.openrouter.ai' })],
];
const regionOf = (baseUrl: string) => OPENROUTER_REGIONS.some(url => url && url === baseUrl) ? baseUrl : '';
const LIST_LIMIT = 80;

/** Where a provider's requests go, for the sentence that says so. */
export function hostOf(kind: ProviderKind, baseUrl: string) {
  const raw = kind === 'venice' ? VENICE_BASE : baseUrl.trim() || (PROVIDERS as any)[kind]?.baseUrl || '';
  try { return new URL(raw).host; } catch { return ''; }
}

/** OpenRouter's public catalogue: no key is sent to read it. */
async function openRouterModels(base: string, signal: AbortSignal): Promise<ModelRow[]> {
  const response = await fetch(`${base}/models`, { credentials: 'omit', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return (Array.isArray(body?.data) ? body.data : []).filter((m: any) => typeof m?.id === 'string').map((m: any): ModelRow => {
    const prompt = Number(m.pricing?.prompt), completion = Number(m.pricing?.completion);
    return {
      id: m.id, name: typeof m.name === 'string' ? m.name : m.id,
      context: Number.isFinite(m.context_length) ? m.context_length : undefined,
      prompt: Number.isFinite(prompt) ? prompt * 1e6 : undefined, completion: Number.isFinite(completion) ? completion * 1e6 : undefined,
      tools: Array.isArray(m.supported_parameters) && m.supported_parameters.includes('tools'),
    };
  });
}

/** Venice's public catalogue of text models: no key is sent to read it. */
async function veniceModels(signal: AbortSignal): Promise<ModelRow[]> {
  const response = await fetch(`${VENICE_BASE}/models?type=text`, { credentials: 'omit', signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  return (Array.isArray(body?.data) ? body.data : []).filter((m: any) => typeof m?.id === 'string' && m?.model_spec?.offline !== true).map((m: any): ModelRow => {
    const spec = m.model_spec ?? {}, input = Number(spec.pricing?.input?.usd), output = Number(spec.pricing?.output?.usd);
    return {
      id: m.id, name: typeof spec.name === 'string' ? spec.name : m.id,
      context: Number.isFinite(spec.availableContextTokens) ? spec.availableContextTokens : Number.isFinite(m.context_length) ? m.context_length : undefined,
      prompt: Number.isFinite(input) ? input : undefined, completion: Number.isFinite(output) ? output : undefined,
      tools: spec.capabilities?.supportsFunctionCalling === true,
      privacy: typeof spec.privacy === 'string' ? spec.privacy : undefined,
    };
  });
}

const money = (perMillion?: number) => perMillion === undefined ? '' : perMillion === 0 ? t('models/free') : `$${perMillion.toFixed(perMillion < 10 ? 2 : 0)}`;
/** Venice's privacy mark of a model, in the person's language when it is one of the two Venice names. */
const privacyLabel = (mark: string) => mark === 'private' ? t('models/private') : mark === 'anonymized' ? t('models/anonymized') : mark;
const tokens = (n?: number) => n === undefined ? '' : n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`;

type SectionId = 'providers' | 'model' | 'appearance' | 'privacy';
const keyReady = (prefs: Preferences) => { const k = prefs.active(); return !PROVIDER_KINDS[k].needsKey || prefs.connection(k).apiKey !== ''; };

/**
 * The site's own sections of the desktop's Settings (`@tangleai/os/settings`):
 * providers and keys, models, appearance, privacy. Each draws into the pane
 * Settings gives it and redraws itself when its preferences change.
 */
export function settingsSections(prefs: Preferences, kernel?: Kernel): SettingsSection[] {
  return [
    { id: 'providers', title: localizedText(englishOf('providers/title'), t('providers/title')), keywords: localizedKeywords(englishOf('providers/keywords'), t('providers/keywords')), mount: sectionMount(prefs, 'providers') },
    { id: 'model', title: localizedText(englishOf('models/title'), t('models/title')), keywords: localizedKeywords(englishOf('models/keywords'), t('models/keywords')), mount: sectionMount(prefs, 'model') },
    { id: 'appearance', title: localizedText(englishOf('appearance/title'), t('appearance/title')), keywords: localizedKeywords(englishOf('appearance/keywords'), t('appearance/keywords')), mount: sectionMount(prefs, 'appearance', kernel) },
    { id: 'privacy', title: localizedText(englishOf('privacy/title'), t('privacy/title')), keywords: localizedKeywords(englishOf('privacy/keywords'), t('privacy/keywords')), mount: sectionMount(prefs, 'privacy') },
  ];
}
/** Settings opens on the models once a provider is ready, on the providers before. */
export const initialSection = (prefs: Preferences): SectionId => keyReady(prefs) ? 'model' : 'providers';

function sectionMount(prefs: Preferences, id: SectionId, kernel?: Kernel): SettingsSection['mount'] {
  return (node) => {
    const doc = node.ownerDocument;
    const win = doc.defaultView!;
    const lifetime = new AbortController();
    type Child = Node | string | null | undefined | false;
    const h = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...children: Child[]) => {
      const el = doc.createElement(tag);
      for (const [k, v] of Object.entries(props)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k in el && typeof v !== 'string') (el as any)[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
      for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
      return el;
    };

    // Settings gives this section its pane; the section owns everything in it
    const pane = node;
    /** Append to the pane, skipping the `false` a conditional row leaves. */
    const put = (...items: Child[]) => { for (const item of items) if (item !== null && item !== undefined && item !== false) pane.append(item); };
    const current: SectionId = id;
    const renders: Record<SectionId, () => void> = { providers: () => renderProviders(), model: () => renderModel(), appearance: () => renderAppearance(), privacy: () => renderPrivacy() };
    /** Every change this section makes redraws this section. */
    function show(_section: SectionId) {
      pane.replaceChildren();
      renders[current]();
    }

    // ── providers ──────────────────────────────────────────────────────────
    function renderProviders() {
      const kind = prefs.active(), info = PROVIDER_KINDS[kind], label = providerLabel(kind), conn = prefs.connection(kind), desk = prefs.desktop();
      const status = h('p', { class: 'tos-settings-status', role: 'status' });
      const say = (text: string, tone: 'ok' | 'fail' | 'muted' = 'muted') => { status.textContent = text; status.dataset.tone = tone; };

      const provider = h('select', { id: 'tos-provider', onchange: () => { prefs.use(provider.value as ProviderKind); show('providers'); } },
        ...(Object.keys(PROVIDER_KINDS) as ProviderKind[]).map(k => h('option', { value: k, selected: k === kind }, providerLabel(k)))) as HTMLSelectElement;

      const key = h('input', {
        id: 'tos-key', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
        placeholder: kind === 'openrouter' ? 'sk-or-v1-…' : t('providers/key-placeholder'), value: conn.apiKey,
        'data-lpignore': 'true', 'data-1p-ignore': 'true',
        oninput: () => say(t('providers/not-saved')),
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } },
      }) as HTMLInputElement;
      const reveal = h('button', { type: 'button', class: 'tos-btn', 'aria-pressed': 'false', onclick: () => {
        const shown = key.type === 'text'; key.type = shown ? 'password' : 'text';
        reveal.textContent = shown ? t('providers/show') : t('providers/hide'); reveal.setAttribute('aria-pressed', String(!shown));
      } }, t('providers/show'));
      function saveKey() {
        key.value = key.value.trim();
        const ok = prefs.setConnection(kind, { apiKey: key.value });
        say(ok ? (key.value ? t('providers/key-saved', { provider: label }) : t('providers/key-removed')) : t('providers/save-refused'), ok ? 'ok' : 'fail');
        renderOverview();
      }
      const save = h('button', { type: 'button', class: 'tos-btn primary', onclick: saveKey }, t('providers/save'));
      const check = h('button', { type: 'button', class: 'tos-btn', onclick: () => checkKey() }, info.needsKey && kind !== 'custom' ? t('providers/check') : t('providers/test'));
      const forget = h('button', { type: 'button', class: 'tos-btn', onclick: () => { prefs.forgetKey(kind); key.value = ''; say(t('providers/key-forgotten', { provider: label }), 'ok'); renderOverview(); } }, t('providers/forget'));

      async function checkKey() {
        const apiKey = key.value.trim(), c = prefs.connection(kind);
        if (info.needsKey && kind !== 'custom' && !apiKey) { say(t('providers/enter-key'), 'fail'); return; }
        say(t('providers/checking'));
        try {
          if (kind === 'openrouter') {
            const r = await fetch(`${regionOf(c.baseUrl) || OPENROUTER}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, credentials: 'omit', signal: lifetime.signal });
            if (r.status === 401 || r.status === 403) { say(t('providers/key-refused', { provider: 'OpenRouter' }), 'fail'); return; }
            if (!r.ok) { say(t('providers/http-status', { provider: 'OpenRouter', status: r.status }), 'fail'); return; }
            const data = (await r.json())?.data ?? {};
            const used = typeof data.usage === 'number' ? `$${data.usage.toFixed(2)}` : undefined;
            const limit = typeof data.limit === 'number' ? `$${data.limit.toFixed(2)}` : data.limit === null ? null : undefined;
            say(t('providers/key-works', { used, limit, freeTier: !!data.is_free_tier }), 'ok');
          } else if (kind === 'venice') {
            const r = await fetch(`${VENICE_BASE}/api_keys/rate_limits`, { headers: { Authorization: `Bearer ${apiKey}` }, credentials: 'omit', signal: lifetime.signal });
            if (r.status === 401 || r.status === 403) { say(t('providers/key-refused', { provider: 'Venice' }), 'fail'); return; }
            say(r.ok ? t('providers/key-works', {}) : t('providers/http-status', { provider: 'Venice', status: r.status }), r.ok ? 'ok' : 'fail');
          } else {
            const s = toAiSettings(kind, { ...c, apiKey });
            const result = await probeProvider({ provider: s.provider, baseUrl: s.baseUrl, apiKey: s.apiKey });
            say(result.ok ? t('providers/connected', { count: result.models.length }) : t('providers/no-connection', { detail: String(result.error) }), result.ok ? 'ok' : 'fail');
          }
        } catch (error: any) { if (error?.name !== 'AbortError') say(t('providers/no-connection', { detail: String(error?.message ?? error) }), 'fail'); }
      }

      // what else a provider needs: OpenRouter a region, a local runtime its
      // server's address, a generic endpoint its base URL; Venice nothing
      const preset = (((PROVIDERS as any)[kind]?.baseUrl as string | null) ?? '').replace(/\/v1$/, '');
      const region = h('select', { id: 'tos-region', onchange: () => { prefs.setConnection(kind, { baseUrl: region.value }); say(t('providers/region-saved'), 'ok'); } },
        ...regionChoices().map(([value, text]) => h('option', { value, selected: value === regionOf(conn.baseUrl) }, text))) as HTMLSelectElement;
      const baseUrl = h('input', {
        id: 'tos-base-url', type: 'url', spellcheck: 'false', autocomplete: 'off',
        placeholder: info.local ? preset : 'https://api.example.com/v1', value: conn.baseUrl,
        onchange: () => { prefs.setConnection(kind, { baseUrl: baseUrl.value.trim() }); show('providers'); },
      }) as HTMLInputElement;
      const origin = win.location.origin;
      const endpoint =
        kind === 'openrouter' ? h('div', { class: 'tos-field' },
          h('label', { for: 'tos-region' }, t('providers/region')), region,
          h('p', { class: 'tos-muted' }, t('providers/region-hint')))
        : kind === 'venice' ? h('p', { class: 'tos-muted' }, t('providers/venice-hint'))
        : info.local ? h('div', { class: 'tos-field' },
          h('label', { for: 'tos-base-url' }, t('providers/server-address')), baseUrl,
          h('p', { class: 'tos-muted' }, kind === 'ollama'
            ? t('providers/ollama-hint', { origin, address: preset })
            : t('providers/lmstudio-hint', { address: preset })))
        : h('div', { class: 'tos-field' },
          h('label', { for: 'tos-base-url' }, t('providers/base-url')), baseUrl,
          h('p', { class: 'tos-muted' }, t('providers/custom-hint')));

      const remember = h('input', { id: 'tos-remember', type: 'checkbox', checked: desk.rememberKey, onchange: () => {
        prefs.writeDesktop({ rememberKey: remember.checked });
        say(remember.checked ? t('providers/remembered') : t('providers/session-only'), 'ok');
      } }) as HTMLInputElement;

      const overview = h('div', { class: 'tos-overview' });
      function renderOverview() {
        const active = prefs.active();
        overview.replaceChildren(h('table', { class: 'tos-table' },
          h('thead', {}, h('tr', {}, h('th', {}, t('providers/column-provider')), h('th', {}, t('providers/column-key')), h('th', {}, t('providers/column-model')))),
          h('tbody', {}, ...(Object.keys(PROVIDER_KINDS) as ProviderKind[]).map(k => {
            const c = prefs.connection(k);
            return h('tr', { class: k === active ? 'is-active' : '', 'data-provider': k },
              h('td', {}, providerLabel(k), k === active ? h('span', { class: 'tos-badge-soft' }, t('providers/badge-in-use')) : null),
              h('td', {}, PROVIDER_KINDS[k].needsKey ? (c.apiKey ? t('providers/key-present') : '—') : t('providers/key-not-needed')),
              h('td', {}, c.model ? h('code', {}, c.model) : '—'));
          }))));
      }
      renderOverview();

      const host = hostOf(kind, conn.baseUrl);
      put(
        h('h2', {}, t('providers/title')),
        h('p', { class: 'tos-muted' }, t('providers/lead')),
        h('label', { class: 'tos-field', for: 'tos-provider' }, h('span', {}, t('providers/in-use')), provider),
        info.needsKey && h('div', { class: 'tos-field' },
          h('label', { for: 'tos-key' }, t('providers/key-label', { provider: label })),
          h('div', { class: 'tos-row' }, key, reveal),
          kind === 'openrouter' && h('p', { class: 'tos-muted' }, t('providers/openrouter-hint'))),
        info.needsKey && h('div', { class: 'tos-row' }, save, check, forget),
        !info.needsKey && h('div', { class: 'tos-row' }, check),
        endpoint,
        h('label', { class: 'tos-check' }, remember, h('span', {}, t('providers/remember'))),
        status,
        host && h('p', { class: 'tos-note' }, info.needsKey
          ? t('providers/requests-key', { host })
          : t('providers/requests-local', { host })),
        h('h3', {}, t('providers/yours')),
        overview,
      );
    }

    // ── models ─────────────────────────────────────────────────────────────
    /** One loaded catalogue per provider and address, kept while the window is open. */
    const catalogues = new Map<string, { rows: ModelRow[] | null, error: string }>();
    function renderModel() {
      const kind = prefs.active(), conn = prefs.connection(kind);
      const cacheKey = `${kind} ${kind === 'openrouter' ? regionOf(conn.baseUrl) : conn.baseUrl}`;
      const entry = catalogues.get(cacheKey) ?? { rows: null, error: '' };
      catalogues.set(cacheKey, entry);
      const chosen = h('p', { class: 'tos-chosen' });
      const favs = h('div', { class: 'tos-row tos-wrap' });
      const refresh = () => {
        const active = prefs.active(), c = prefs.connection(active);
        chosen.replaceChildren(t('models/in-use'), h('strong', {}, providerLabel(active)), ' · ', h('code', {}, c.model || t('models/none-yet')));
        const list = prefs.favourites();
        favs.replaceChildren(...(list.length ? list.map(f => h('button', {
          type: 'button', class: `tos-chip${f.kind === active && f.model === c.model ? ' is-chosen' : ''}`, 'data-favourite': `${f.kind}:${f.model}`,
          title: t('models/use-favourite', { model: f.model, provider: providerLabel(f.kind) }),
          onclick: () => { prefs.use(f.kind, f.model); show('model'); },
        }, f.model, h('span', { class: 'tos-chip-provider' }, providerLabel(f.kind)))) : [h('p', { class: 'tos-muted' }, t('models/no-favourites'))]));
      };
      refresh();
      const pick = (id: string) => { prefs.setConnection(kind, { model: id }); refresh(); renderList(); };

      const search = h('input', { id: 'tos-model-search', type: 'search', placeholder: t('models/search'), spellcheck: 'false', autocomplete: 'off', oninput: () => renderList() }) as HTMLInputElement;
      const toolsOnly = h('input', { type: 'checkbox', checked: true, onchange: () => renderList() }) as HTMLInputElement;
      const list = h('div', { class: 'tos-models', role: 'list', 'aria-label': t('models/list') });
      const note = h('p', { class: 'tos-muted', role: 'status' });
      const listed = PROVIDER_KINDS[kind].local || kind === 'custom';

      function renderList() {
        const query = search.value.trim().toLowerCase();
        const model = prefs.connection(kind).model;
        list.replaceChildren();
        const rows = (entry.rows ?? []).filter(m => (!toolsOnly.checked || m.tools) && (!query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)));
        rows.sort((a, b) => Number(RECOMMENDED_MODELS.includes(b.id)) - Number(RECOMMENDED_MODELS.includes(a.id)) || a.name.localeCompare(b.name));
        for (const m of rows.slice(0, LIST_LIMIT)) {
          const meta = [m.context ? t('models/context', { tokens: tokens(m.context) }) : '', m.prompt !== undefined ? t('models/price', { prompt: money(m.prompt), completion: money(m.completion) }) : '', m.tools ? t('models/tools') : ''].filter(Boolean).join(' · ');
          const starred = prefs.isFavourite(kind, m.id);
          list.append(h('div', { class: 'tos-model-row', role: 'listitem' },
            h('button', {
              type: 'button', class: `tos-model${m.id === model ? ' is-chosen' : ''}`, 'aria-pressed': String(m.id === model),
              'data-model': m.id, onclick: () => pick(m.id),
            }, h('span', { class: 'tos-model-name' }, m.name,
              RECOMMENDED_MODELS.includes(m.id) && kind === 'openrouter' ? h('span', { class: 'tos-badge-soft' }, t('models/recommended')) : null,
              m.privacy ? h('span', { class: `tos-badge-soft${m.privacy === 'private' ? '' : ' is-muted'}` }, privacyLabel(m.privacy)) : null),
            h('code', {}, m.id), meta ? h('span', { class: 'tos-muted' }, meta) : null),
            h('button', {
              type: 'button', class: `tos-star${starred ? ' is-on' : ''}`, 'aria-pressed': String(starred), 'data-star': m.id,
              'aria-label': starred ? t('models/unstar', { model: m.name }) : t('models/star', { model: m.name }), title: starred ? t('models/unstar-title') : t('models/star-title'),
              onclick: () => { prefs.toggleFavourite(kind, m.id); refresh(); renderList(); },
            }, starred ? '★' : '☆')));
        }
        if (entry.error) note.textContent = t('models/list-failed', { detail: entry.error });
        else if (!entry.rows) note.textContent = listed ? t('models/load-hint') : t('models/loading');
        else note.textContent = rows.length > LIST_LIMIT ? t('models/match-limited', { count: rows.length, limit: LIST_LIMIT }) : t('models/match', { count: rows.length });
        if (query && !rows.some(m => m.id.toLowerCase() === query)) {
          const id = search.value.trim();
          list.prepend(h('div', { class: 'tos-model-row' }, h('button', { type: 'button', class: 'tos-model', onclick: () => pick(id) }, h('span', { class: 'tos-model-name' }, t('models/use-id')), h('code', {}, id))));
        }
      }

      async function load() {
        entry.error = ''; note.textContent = t('models/loading');
        try {
          if (kind === 'openrouter') entry.rows = await openRouterModels(regionOf(conn.baseUrl) || OPENROUTER, lifetime.signal);
          else if (kind === 'venice') entry.rows = await veniceModels(lifetime.signal);
          else {
            const s = toAiSettings(kind, conn);
            const r = await probeProvider({ provider: s.provider, baseUrl: s.baseUrl, apiKey: s.apiKey });
            if (!r.ok) throw new Error(r.error);
            entry.rows = r.models.map(id => ({ id, name: id, tools: true }));
          }
        } catch (error: any) { if (error?.name === 'AbortError') return; entry.error = String(error?.message ?? error); }
        if (current === 'model' && prefs.active() === kind) renderList();
      }

      put(
        h('h2', {}, t('models/title')),
        h('p', { class: 'tos-muted' }, t('models/lead')),
        chosen,
        h('div', { class: 'tos-field' }, h('span', {}, t('models/yours')), favs),
        h('label', { class: 'tos-field', for: 'tos-model-search' }, h('span', {}, t('models/search-label', { provider: providerLabel(kind) })), search),
        h('label', { class: 'tos-check' }, toolsOnly, h('span', {}, t('models/tools-only'))),
        note, list,
        listed && h('div', { class: 'tos-row' }, h('button', { type: 'button', class: 'tos-btn', onclick: load }, t('models/load'))),
      );
      if (!listed && !entry.rows && !entry.error) void load(); else renderList();
    }

    // ── appearance ─────────────────────────────────────────────────────────
    function renderAppearance() {
      const desk = prefs.desktop();
      const scheme = prefs.effectiveScheme();
      const custom = desk.custom;
      // a click redraws this section (its marks move); a drag does not, so a slider keeps the pointer
      const redraw = () => show('appearance');
      const setCustom = (patch: Record<string, unknown>, again = true) => { prefs.writeDesktop({ custom: cleanCustom({ ...prefs.desktop().custom, ...patch }) }); if (again) redraw(); };
      const composed = composeTheme(desk.kit, scheme, custom);
      const preview = (kitId: string, extra: Record<string, unknown> = {}) => {
        const background = patternBackground(composeTheme(kitId, scheme, { ...extra, density: 0.8 }).tokens) ?? 'none';
        return h('span', { class: 'tos-preview', style: `background:${background}`, 'aria-hidden': 'true' });
      };
      const choices = <T extends string>(name: string, legend: string, options: [T, string][], value: T, onPick: (v: T) => void) =>
        h('fieldset', { class: 'tos-choices' }, h('legend', {}, legend),
          ...options.map(([v, label]) => h('label', { class: 'tos-choice' },
            h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onPick(v) }), h('span', {}, label))));
      const slider = (label: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void) => {
        const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
        input.addEventListener('input', () => onInput(Number(input.value)));
        return h('label', { class: 'tos-field tos-slider' }, h('span', {}, label), input);
      };

      // one language for the whole desktop: the browser's, or the person's; it starts again in it
      const languagePicker = () => {
        const browser = LANGUAGES.find(l => l.code === resolveLanguage('system', navigator.languages ?? [navigator.language]))!;
        const select = h('select', { id: 'tos-language', onchange: () => {
          prefs.writeDesktop({ language: select.value });
          // the person's choice outranks a language the link carried
          const url = new URL(location.href); url.searchParams.delete('lang'); location.replace(url.href);
        } },
          h('option', { value: 'system', selected: desk.language === 'system' }, t('appearance/language-system', { language: browser.name })),
          ...LANGUAGES.map(l => h('option', { value: l.code, lang: l.code, selected: desk.language === l.code }, l.name))) as HTMLSelectElement;
        return h('div', { class: 'tos-field' }, h('label', { for: 'tos-language' }, t('appearance/language')), select, h('p', { class: 'tos-muted' }, t('appearance/language-note')));
      };
      // the kits, each previewed with its own wallpaper in the current scheme
      const gallery = h('div', { class: 'tos-kits', role: 'radiogroup', 'aria-label': t('appearance/theme') },
        ...THEME_KITS.map(kit => h('button', {
          type: 'button', role: 'radio', class: 'tos-kit', 'aria-checked': String(kit.id === desk.kit), 'data-kit': kit.id,
          onclick: () => { prefs.writeDesktop({ kit: kit.id, custom: {} }); redraw(); },
        }, preview(kit.id), h('span', { class: 'tos-kit-name' }, kitText(kit.id)?.[0] ?? kit.name), h('span', { class: 'tos-kit-text' }, kitText(kit.id)?.[1] ?? kit.description))));

      const accentPicker = h('input', { type: 'color', value: custom.accent ?? composed.tokens['--accent'].slice(0, 7), 'aria-label': t('appearance/accent-colour') }) as HTMLInputElement;
      accentPicker.addEventListener('input', () => setCustom({ accent: accentPicker.value }, false));
      const knotPicker = h('input', { type: 'color', value: custom.knot ?? composed.tokens['--os-knot'], 'aria-label': t('appearance/knot-colour') }) as HTMLInputElement;
      knotPicker.addEventListener('input', () => setCustom({ knot: knotPicker.value }, false));
      const accents = h('div', { class: 'tos-field' }, h('span', {}, t('appearance/accent')),
        h('div', { class: 'tos-swatches' },
          ...ACCENT_SWATCHES.map(colour => h('button', { type: 'button', class: 'tos-swatch-btn', style: `--swatch:${colour}`, 'aria-label': colour, 'aria-pressed': String(custom.accent === colour), onclick: () => setCustom({ accent: colour }) })),
          accentPicker,
          custom.accent && h('button', { type: 'button', class: 'tos-link', onclick: () => setCustom({ accent: undefined }) }, t('appearance/theme-own'))));
      const knot = h('div', { class: 'tos-field' }, h('span', {}, t('appearance/highlights')), h('div', { class: 'tos-swatches' }, knotPicker,
        custom.knot && h('button', { type: 'button', class: 'tos-link', onclick: () => setCustom({ knot: undefined }) }, t('appearance/theme-own'))));

      const pattern = custom.pattern ?? THEME_KITS.find(k => k.id === desk.kit)!.pattern;
      const patterns = h('div', { class: 'tos-field' }, h('span', {}, t('appearance/wallpaper')),
        h('div', { class: 'tos-patterns', role: 'radiogroup', 'aria-label': t('appearance/wallpaper-pattern') },
          ...Object.entries(patternNames()).map(([id, label]) => h('button', {
            type: 'button', role: 'radio', class: 'tos-pattern', 'aria-checked': String(id === pattern),
            onclick: () => setCustom({ pattern: id }),
          }, preview(desk.kit, { ...custom, pattern: id }), h('span', {}, label)))),
        h('div', { class: 'tos-row' },
          h('button', { type: 'button', class: 'tos-btn', onclick: () => setCustom({ seed: Math.floor(Math.random() * 2 ** 31) }) }, t('appearance/shuffle')),
          h('span', { class: 'tos-muted' }, t('appearance/pattern-number', { number: custom.seed ?? 7 }))));
      const shape = THEME_KITS.find(k => k.id === desk.kit)!.shape;

      // a theme is a document: it can leave this browser as text and come back
      const status = h('p', { class: 'tos-muted', role: 'status' });
      const exportTheme = () => {
        const text = JSON.stringify({ $tangletheme: '0.1', kit: desk.kit, custom, scheme: desk.scheme }, null, 2);
        const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
        const link = h('a', { href: url, download: `tangle-theme-${desk.kit}.json` }); doc.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 0);
        status.textContent = t('appearance/exported');
      };
      const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true }) as HTMLInputElement;
      file.addEventListener('change', async () => {
        try {
          const value = JSON.parse(await file.files![0].text());
          if (value?.$tangletheme !== '0.1' || !THEME_KITS.some(k => k.id === value.kit)) throw new Error(t('appearance/not-a-theme'));
          prefs.writeDesktop({ kit: value.kit, custom: cleanCustom(value.custom), ...(['system', 'light', 'dark'].includes(value.scheme) ? { scheme: value.scheme } : {}) });
          redraw();
        } catch (error: any) { status.textContent = t('appearance/import-failed', { detail: String(error?.message ?? error) }); }
      });

      put(
        h('h2', {}, t('appearance/title')),
        choices<Scheme>('tos-scheme', t('appearance/mode'), [['system', t('appearance/mode-system')], ['light', t('appearance/mode-light')], ['dark', t('appearance/mode-dark')]], desk.scheme, (v) => { prefs.writeDesktop({ scheme: v }); redraw(); }),
        languagePicker(),
        h('h3', {}, t('appearance/theme')), gallery,
        h('h3', {}, t('appearance/make-yours')),
        accents, knot, patterns,
        slider(t('appearance/density'), 0.3, 2, 0.1, custom.density ?? 1, (v) => setCustom({ density: v }, false)),
        slider(t('appearance/glass'), 0, 1, 0.05, custom.glass ?? shape.glass, (v) => setCustom({ glass: v }, false)),
        choices('tos-corners', t('appearance/corners'), [['sharp', t('appearance/corners-sharp')], ['soft', t('appearance/corners-soft')], ['round', t('appearance/corners-round')]], custom.corners ?? shape.corners, (v) => setCustom({ corners: v })),
        choices('tos-spacing', t('appearance/spacing'), [['compact', t('appearance/spacing-compact')], ['comfortable', t('appearance/spacing-comfortable')]], custom.spacing ?? shape.spacing, (v) => setCustom({ spacing: v })),
        h('div', { class: 'tos-row' },
          h('button', { type: 'button', class: 'tos-btn', onclick: exportTheme }, t('appearance/export')),
          h('button', { type: 'button', class: 'tos-btn', onclick: () => file.click() }, t('appearance/import')),
          h('button', { type: 'button', class: 'tos-btn', onclick: () => { prefs.writeDesktop({ custom: {} }); redraw(); } }, t('appearance/reset'))),
        file, status,
        kernel && h('h3', {}, t('appearance/dock')),
        kernel && h('p', { class: 'tos-muted' }, t('appearance/dock-note')),
        // an empty layout is the default: every icon is placed again as its manifest says
        kernel && h('div', { class: 'tos-row' }, h('button', { type: 'button', class: 'tos-btn', id: 'tos-dock-reset', onclick: () => {
          const outcome = kernel.setDock(emptyDock());
          status.textContent = outcome.ok ? t('appearance/dock-reset-done') : t('appearance/dock-reset-failed');
        } }, t('appearance/dock-reset'))),
      );
    }

    // ── privacy and data ───────────────────────────────────────────────────
    function renderPrivacy() {
      const status = h('p', { class: 'tos-settings-status', role: 'status' });
      const done = (text: string) => { status.textContent = text; status.dataset.tone = 'ok'; };
      let armed = false, timer = 0;
      const everything = h('button', { type: 'button', class: 'tos-btn danger', onclick: () => {
        if (!armed) { armed = true; everything.textContent = t('privacy/confirm'); timer = win.setTimeout(() => { armed = false; everything.textContent = t('privacy/forget-everything'); }, 4000); return; }
        win.clearTimeout(timer); armed = false; everything.textContent = t('privacy/forget-everything');
        prefs.forgetEverything(); done(t('privacy/everything-removed'));
      } }, t('privacy/forget-everything'));
      put(
        h('h2', {}, t('privacy/title')),
        h('ul', { class: 'tos-facts' },
          h('li', {}, t('privacy/fact-storage')),
          h('li', {}, t('privacy/fact-header')),
          h('li', {}, t('privacy/fact-frames')),
          h('li', {}, t('privacy/fact-shared'))),
        h('div', { class: 'tos-row tos-wrap' },
          h('button', { type: 'button', class: 'tos-btn', onclick: () => { for (const k of Object.keys(PROVIDER_KINDS) as ProviderKind[]) prefs.forgetKey(k); done(t('privacy/keys-removed')); } }, t('privacy/forget-keys')),
          h('button', { type: 'button', class: 'tos-btn', onclick: () => { prefs.chat.clear(); prefs.use(prefs.active(), undefined, 'chat'); done(t('privacy/chat-cleared')); } }, t('privacy/clear-chat')),
          everything),
        status,
      );
    }

    const unsubscribe = prefs.subscribe((what, source) => {
      // a change made elsewhere (the dock's theme switch, the assistant window) shows here
      if (source === 'settings') return;
      if (source === 'reset' || (what === 'desktop' ? current === 'appearance' : current === 'providers' || current === 'model')) show(current);
    });
    show(current);
    return () => { unsubscribe(); lifetime.abort(); pane.replaceChildren(); };
  };
}
