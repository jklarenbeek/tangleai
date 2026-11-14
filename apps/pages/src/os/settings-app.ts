/**
 * Settings: the assistant's providers (each with its own key, region or
 * address), the models (starred ones are one click away), the desktop's
 * appearance, and what this browser keeps. Shipped code in the desktop's own
 * page; a key is shown only in a password field and sent only to its own
 * provider.
 */
import { PROVIDERS, probeProvider } from '@tangleai/models/providers';
import type { ShippedMount } from '@tangleai/os/shell';
import {
  ACCENTS, PROVIDER_KINDS, RECOMMENDED_MODELS, VENICE_BASE, WALLPAPERS, toAiSettings,
  type Preferences, type ProviderKind, type Scheme,
} from './preferences.ts';

type ModelRow = { id: string, name: string, context?: number, prompt?: number, completion?: number, tools: boolean, privacy?: string };

const OPENROUTER = 'https://openrouter.ai/api/v1';
/**
 * OpenRouter has no base URL to type, only a region: any region (it may use
 * every provider of a model, wherever it runs), or in-region routing (Business
 * and Enterprise plans) that keeps inference in Europe or the United States
 * and fails rather than leave it.
 */
export const OPENROUTER_REGIONS: [string, string][] = [
  ['', 'Any region (default)'],
  ['https://eu.openrouter.ai/api/v1', 'Europe · eu.openrouter.ai'],
  ['https://us.openrouter.ai/api/v1', 'United States · us.openrouter.ai'],
];
const regionOf = (baseUrl: string) => OPENROUTER_REGIONS.some(([url]) => url && url === baseUrl) ? baseUrl : '';
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

const money = (perMillion?: number) => perMillion === undefined ? '' : perMillion === 0 ? 'free' : `$${perMillion.toFixed(perMillion < 10 ? 2 : 0)}`;
const tokens = (n?: number) => n === undefined ? '' : n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`;

export function settingsMount(prefs: Preferences): ShippedMount {
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

    const root = h('div', { class: 'tos-settings' });
    const nav = h('nav', { class: 'tos-settings-nav', 'aria-label': 'Settings sections' });
    const pane = h('div', { class: 'tos-settings-pane' });
    /** Append to the pane, skipping the `false` a conditional row leaves. */
    const put = (...items: Child[]) => { for (const item of items) if (item !== null && item !== undefined && item !== false) pane.append(item); };
    root.append(nav, pane);
    node.append(root);

    const sections = [
      { id: 'providers', label: 'Providers', render: renderProviders },
      { id: 'model', label: 'Models', render: renderModel },
      { id: 'appearance', label: 'Appearance', render: renderAppearance },
      { id: 'privacy', label: 'Privacy and data', render: renderPrivacy },
    ];
    const ready = () => { const k = prefs.active(); return !PROVIDER_KINDS[k].needsKey || prefs.connection(k).apiKey !== ''; };
    let current = ready() ? 'model' : 'providers';

    function show(id: string) {
      current = id;
      nav.replaceChildren(...sections.map(s => h('button', {
        type: 'button', class: s.id === id ? 'is-current' : '', 'aria-current': s.id === id ? 'page' : undefined,
        'data-section': s.id, onclick: () => show(s.id),
      }, s.label)));
      pane.replaceChildren();
      sections.find(s => s.id === id)!.render();
    }

    // ── providers ──────────────────────────────────────────────────────────
    function renderProviders() {
      const kind = prefs.active(), info = PROVIDER_KINDS[kind], conn = prefs.connection(kind), desk = prefs.desktop();
      const status = h('p', { class: 'tos-settings-status', role: 'status' });
      const say = (text: string, tone: 'ok' | 'fail' | 'muted' = 'muted') => { status.textContent = text; status.dataset.tone = tone; };

      const provider = h('select', { id: 'tos-provider', onchange: () => { prefs.use(provider.value as ProviderKind); show('providers'); } },
        ...(Object.keys(PROVIDER_KINDS) as ProviderKind[]).map(k => h('option', { value: k, selected: k === kind }, PROVIDER_KINDS[k].label))) as HTMLSelectElement;

      const key = h('input', {
        id: 'tos-key', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
        placeholder: kind === 'openrouter' ? 'sk-or-v1-…' : 'API key', value: conn.apiKey,
        'data-lpignore': 'true', 'data-1p-ignore': 'true',
        oninput: () => say('Not saved yet.'),
        onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); saveKey(); } },
      }) as HTMLInputElement;
      const reveal = h('button', { type: 'button', class: 'tos-btn', 'aria-pressed': 'false', onclick: () => {
        const shown = key.type === 'text'; key.type = shown ? 'password' : 'text';
        reveal.textContent = shown ? 'Show' : 'Hide'; reveal.setAttribute('aria-pressed', String(!shown));
      } }, 'Show');
      function saveKey() {
        key.value = key.value.trim();
        const ok = prefs.setConnection(kind, { apiKey: key.value });
        say(ok ? (key.value ? `${info.label} key saved in this browser.` : 'Key removed.') : 'This browser refused to save it (private mode or storage full).', ok ? 'ok' : 'fail');
        renderOverview();
      }
      const save = h('button', { type: 'button', class: 'tos-btn primary', onclick: saveKey }, 'Save key');
      const check = h('button', { type: 'button', class: 'tos-btn', onclick: () => checkKey() }, info.needsKey && kind !== 'custom' ? 'Check key' : 'Test connection');
      const forget = h('button', { type: 'button', class: 'tos-btn', onclick: () => { prefs.forgetKey(kind); key.value = ''; say(`${info.label} key removed from this browser.`, 'ok'); renderOverview(); } }, 'Forget key');

      async function checkKey() {
        const apiKey = key.value.trim(), c = prefs.connection(kind);
        if (info.needsKey && kind !== 'custom' && !apiKey) { say('Enter a key first.', 'fail'); return; }
        say('Checking…');
        try {
          if (kind === 'openrouter') {
            const r = await fetch(`${regionOf(c.baseUrl) || OPENROUTER}/key`, { headers: { Authorization: `Bearer ${apiKey}` }, credentials: 'omit', signal: lifetime.signal });
            if (r.status === 401 || r.status === 403) { say('OpenRouter refused this key.', 'fail'); return; }
            if (!r.ok) { say(`OpenRouter answered HTTP ${r.status}.`, 'fail'); return; }
            const data = (await r.json())?.data ?? {};
            const used = typeof data.usage === 'number' ? `$${data.usage.toFixed(2)} used` : '';
            const limit = typeof data.limit === 'number' ? ` of $${data.limit.toFixed(2)}` : data.limit === null ? ', no limit' : '';
            say(`The key works${used ? ` · ${used}${limit}` : ''}${data.is_free_tier ? ' · free tier' : ''}.`, 'ok');
          } else if (kind === 'venice') {
            const r = await fetch(`${VENICE_BASE}/api_keys/rate_limits`, { headers: { Authorization: `Bearer ${apiKey}` }, credentials: 'omit', signal: lifetime.signal });
            if (r.status === 401 || r.status === 403) { say('Venice refused this key.', 'fail'); return; }
            say(r.ok ? 'The key works.' : `Venice answered HTTP ${r.status}.`, r.ok ? 'ok' : 'fail');
          } else {
            const s = toAiSettings(kind, { ...c, apiKey });
            const result = await probeProvider({ provider: s.provider, baseUrl: s.baseUrl, apiKey: s.apiKey });
            say(result.ok ? `Connected · ${result.models.length} models available.` : `No connection: ${result.error}`, result.ok ? 'ok' : 'fail');
          }
        } catch (error: any) { if (error?.name !== 'AbortError') say(`No connection: ${error?.message ?? error}`, 'fail'); }
      }

      // what else a provider needs: OpenRouter a region, a local runtime its
      // server's address, a generic endpoint its base URL; Venice nothing
      const preset = (((PROVIDERS as any)[kind]?.baseUrl as string | null) ?? '').replace(/\/v1$/, '');
      const region = h('select', { id: 'tos-region', onchange: () => { prefs.setConnection(kind, { baseUrl: region.value }); say('Region saved.', 'ok'); } },
        ...OPENROUTER_REGIONS.map(([value, label]) => h('option', { value, selected: value === regionOf(conn.baseUrl) }, label))) as HTMLSelectElement;
      const baseUrl = h('input', {
        id: 'tos-base-url', type: 'url', spellcheck: 'false', autocomplete: 'off',
        placeholder: info.local ? preset : 'https://api.example.com/v1', value: conn.baseUrl,
        onchange: () => { prefs.setConnection(kind, { baseUrl: baseUrl.value.trim() }); show('providers'); },
      }) as HTMLInputElement;
      const origin = win.location.origin;
      const endpoint =
        kind === 'openrouter' ? h('div', { class: 'tos-field' },
          h('label', { for: 'tos-region' }, 'Region'), region,
          h('p', { class: 'tos-muted' }, 'Any region lets OpenRouter use every provider of a model, wherever it runs. Europe and United States keep inference in that region; they need an OpenRouter Business or Enterprise plan, and a model with no endpoint there fails instead of leaving it.'))
        : kind === 'venice' ? h('p', { class: 'tos-muted' }, 'Create a key in your Venice account under API. The model list marks which models are private (Venice keeps no record of the prompt) and which are anonymized (served by a third party without your identity).')
        : info.local ? h('div', { class: 'tos-field' },
          h('label', { for: 'tos-base-url' }, 'Server address'), baseUrl,
          h('p', { class: 'tos-muted' }, kind === 'ollama'
            ? `Ollama must allow this page: start it with OLLAMA_ORIGINS=${origin}. Leave the address empty for ${preset}.`
            : `Turn on CORS in LM Studio's server settings so this page may call it. Leave the address empty for ${preset}.`))
        : h('div', { class: 'tos-field' },
          h('label', { for: 'tos-base-url' }, 'Base URL'), baseUrl,
          h('p', { class: 'tos-muted' }, 'Any OpenAI-compatible endpoint that answers /chat/completions and allows this page (CORS).'));

      const remember = h('input', { id: 'tos-remember', type: 'checkbox', checked: desk.rememberKey, onchange: () => {
        prefs.writeDesktop({ rememberKey: remember.checked });
        say(remember.checked ? 'Keys are kept in this browser until you forget them.' : 'Keys are kept only until this tab closes.', 'ok');
      } }) as HTMLInputElement;

      const overview = h('div', { class: 'tos-overview' });
      function renderOverview() {
        const active = prefs.active();
        overview.replaceChildren(h('table', { class: 'tos-table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Provider'), h('th', {}, 'Key'), h('th', {}, 'Model'))),
          h('tbody', {}, ...(Object.keys(PROVIDER_KINDS) as ProviderKind[]).map(k => {
            const c = prefs.connection(k);
            return h('tr', { class: k === active ? 'is-active' : '', 'data-provider': k },
              h('td', {}, PROVIDER_KINDS[k].label, k === active ? h('span', { class: 'tos-badge-soft' }, 'in use') : null),
              h('td', {}, PROVIDER_KINDS[k].needsKey ? (c.apiKey ? 'saved' : '—') : 'not needed'),
              h('td', {}, c.model ? h('code', {}, c.model) : '—'));
          }))));
      }
      renderOverview();

      const host = hostOf(kind, conn.baseUrl);
      put(
        h('h2', {}, 'Providers'),
        h('p', { class: 'tos-muted' }, 'The assistant talks to a model through the provider in use. Each provider keeps its own key, so you can set up several and switch between them; a key is only ever sent to its own provider.'),
        h('label', { class: 'tos-field', for: 'tos-provider' }, h('span', {}, 'Provider in use'), provider),
        info.needsKey && h('div', { class: 'tos-field' },
          h('label', { for: 'tos-key' }, `${info.label} API key`),
          h('div', { class: 'tos-row' }, key, reveal),
          kind === 'openrouter' && h('p', { class: 'tos-muted' }, 'Create one at openrouter.ai/keys. A key with a credit limit is the safest choice for a browser.')),
        info.needsKey && h('div', { class: 'tos-row' }, save, check, forget),
        !info.needsKey && h('div', { class: 'tos-row' }, check),
        endpoint,
        h('label', { class: 'tos-check' }, remember, h('span', {}, 'Remember keys in this browser')),
        status,
        host && h('p', { class: 'tos-note' }, info.needsKey
          ? `Requests go from this browser straight to ${host}. Applications on the desktop run in isolated frames and cannot read the key.`
          : `Requests go from this browser straight to ${host}; nothing passes through a Tangle server.`),
        h('h3', {}, 'Your providers'),
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
        chosen.replaceChildren('In use: ', h('strong', {}, PROVIDER_KINDS[active].label), ' · ', h('code', {}, c.model || 'no model yet'));
        const list = prefs.favourites();
        favs.replaceChildren(...(list.length ? list.map(f => h('button', {
          type: 'button', class: `tos-chip${f.kind === active && f.model === c.model ? ' is-chosen' : ''}`, 'data-favourite': `${f.kind}:${f.model}`,
          title: `Use ${f.model} through ${PROVIDER_KINDS[f.kind].label}`,
          onclick: () => { prefs.use(f.kind, f.model); show('model'); },
        }, f.model, h('span', { class: 'tos-chip-provider' }, PROVIDER_KINDS[f.kind].label))) : [h('p', { class: 'tos-muted' }, 'Star models below to keep them here, from any provider. The Assistant window switches between them too.')]));
      };
      refresh();
      const pick = (id: string) => { prefs.setConnection(kind, { model: id }); refresh(); renderList(); };

      const search = h('input', { id: 'tos-model-search', type: 'search', placeholder: 'Search models, or type a model id', spellcheck: 'false', autocomplete: 'off', oninput: () => renderList() }) as HTMLInputElement;
      const toolsOnly = h('input', { type: 'checkbox', checked: true, onchange: () => renderList() }) as HTMLInputElement;
      const list = h('div', { class: 'tos-models', role: 'list', 'aria-label': 'Models' });
      const note = h('p', { class: 'tos-muted', role: 'status' });
      const listed = PROVIDER_KINDS[kind].local || kind === 'custom';

      function renderList() {
        const query = search.value.trim().toLowerCase();
        const model = prefs.connection(kind).model;
        list.replaceChildren();
        const rows = (entry.rows ?? []).filter(m => (!toolsOnly.checked || m.tools) && (!query || m.id.toLowerCase().includes(query) || m.name.toLowerCase().includes(query)));
        rows.sort((a, b) => Number(RECOMMENDED_MODELS.includes(b.id)) - Number(RECOMMENDED_MODELS.includes(a.id)) || a.name.localeCompare(b.name));
        for (const m of rows.slice(0, LIST_LIMIT)) {
          const meta = [m.context ? `${tokens(m.context)} context` : '', m.prompt !== undefined ? `${money(m.prompt)} in · ${money(m.completion)} out per 1M` : '', m.tools ? 'tools' : ''].filter(Boolean).join(' · ');
          const starred = prefs.isFavourite(kind, m.id);
          list.append(h('div', { class: 'tos-model-row', role: 'listitem' },
            h('button', {
              type: 'button', class: `tos-model${m.id === model ? ' is-chosen' : ''}`, 'aria-pressed': String(m.id === model),
              'data-model': m.id, onclick: () => pick(m.id),
            }, h('span', { class: 'tos-model-name' }, m.name,
              RECOMMENDED_MODELS.includes(m.id) && kind === 'openrouter' ? h('span', { class: 'tos-badge-soft' }, 'recommended') : null,
              m.privacy ? h('span', { class: `tos-badge-soft${m.privacy === 'private' ? '' : ' is-muted'}` }, m.privacy) : null),
            h('code', {}, m.id), meta ? h('span', { class: 'tos-muted' }, meta) : null),
            h('button', {
              type: 'button', class: `tos-star${starred ? ' is-on' : ''}`, 'aria-pressed': String(starred), 'data-star': m.id,
              'aria-label': starred ? `Remove ${m.name} from your models` : `Add ${m.name} to your models`, title: starred ? 'Remove from your models' : 'Add to your models',
              onclick: () => { prefs.toggleFavourite(kind, m.id); refresh(); renderList(); },
            }, starred ? '★' : '☆')));
        }
        if (entry.error) note.textContent = `The model list did not load (${entry.error}). You can still type a model id.`;
        else if (!entry.rows) note.textContent = listed ? 'Load the models this provider serves, or type an id.' : 'Loading models…';
        else note.textContent = rows.length > LIST_LIMIT ? `${rows.length} models match; showing ${LIST_LIMIT}. Narrow the search.` : `${rows.length} models match.`;
        if (query && !rows.some(m => m.id.toLowerCase() === query)) {
          const id = search.value.trim();
          list.prepend(h('div', { class: 'tos-model-row' }, h('button', { type: 'button', class: 'tos-model', onclick: () => pick(id) }, h('span', { class: 'tos-model-name' }, 'Use this id'), h('code', {}, id))));
        }
      }

      async function load() {
        entry.error = ''; note.textContent = 'Loading models…';
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
        h('h2', {}, 'Models'),
        h('p', { class: 'tos-muted' }, 'The assistant writes Jaren JSON documents and calls tools; only a few models do that reliably. On OpenRouter, anthropic/claude-haiku-5.5 and qwen/qwen3.8-27b are a good start.'),
        chosen,
        h('div', { class: 'tos-field' }, h('span', {}, 'Your models'), favs),
        h('label', { class: 'tos-field', for: 'tos-model-search' }, h('span', {}, `${PROVIDER_KINDS[kind].label} models`), search),
        h('label', { class: 'tos-check' }, toolsOnly, h('span', {}, 'Only models that can use tools')),
        note, list,
        listed && h('div', { class: 'tos-row' }, h('button', { type: 'button', class: 'tos-btn', onclick: load }, 'Load models')),
      );
      if (!listed && !entry.rows && !entry.error) void load(); else renderList();
    }

    // ── appearance ─────────────────────────────────────────────────────────
    function renderAppearance() {
      const desk = prefs.desktop();
      const radios = <T extends string>(name: string, legend: string, options: [T, string][], value: T, onPick: (v: T) => void, swatch?: (v: T) => string) =>
        h('fieldset', { class: 'tos-choices' }, h('legend', {}, legend),
          ...options.map(([v, label]) => {
            const input = h('input', { type: 'radio', name, value: v, checked: v === value, onchange: () => onPick(v) });
            return h('label', { class: 'tos-choice' }, input, swatch ? h('span', { class: 'tos-swatch', style: `background:${swatch(v)}`, 'aria-hidden': 'true' }) : null, h('span', {}, label));
          }));
      const scheme = prefs.effectiveScheme();
      put(
        h('h2', {}, 'Appearance'),
        radios<Scheme>('tos-scheme', 'Theme', [['system', 'Follow the system'], ['light', 'Light'], ['dark', 'Dark']], desk.scheme, (v) => prefs.writeDesktop({ scheme: v })),
        radios('tos-accent', 'Accent colour', Object.entries(ACCENTS).map(([id, a]) => [id, a.label] as [string, string]), desk.accent, (v) => prefs.writeDesktop({ accent: v }),
          (v) => `hsl(${ACCENTS[v].hue} ${scheme === 'dark' ? '90% 76%' : '58% 50%'})`),
        radios('tos-wallpaper', 'Wallpaper', Object.entries(WALLPAPERS).map(([id, w]) => [id, w.label] as [string, string]), desk.wallpaper, (v) => prefs.writeDesktop({ wallpaper: v }),
          (v) => WALLPAPERS[v][scheme]),
      );
    }

    // ── privacy and data ───────────────────────────────────────────────────
    function renderPrivacy() {
      const status = h('p', { class: 'tos-settings-status', role: 'status' });
      const done = (text: string) => { status.textContent = text; status.dataset.tone = 'ok'; };
      let armed = false, timer = 0;
      const everything = h('button', { type: 'button', class: 'tos-btn danger', onclick: () => {
        if (!armed) { armed = true; everything.textContent = 'Click again to forget everything'; timer = win.setTimeout(() => { armed = false; everything.textContent = 'Forget everything'; }, 4000); return; }
        win.clearTimeout(timer); armed = false; everything.textContent = 'Forget everything';
        prefs.forgetEverything(); done('Removed every key, the models, the conversation and the appearance from this browser.');
      } }, 'Forget everything');
      put(
        h('h2', {}, 'Privacy and data'),
        h('ul', { class: 'tos-facts' },
          h('li', {}, 'Your keys, models and appearance are kept in this browser\'s storage, never on a server.'),
          h('li', {}, 'Each key is sent only to its own provider, in the request\'s Authorization header. It is never part of a page address.'),
          h('li', {}, 'Applications on the desktop run in isolated frames (another origin, or none) and cannot read this storage. The assistant\'s tools never see a key.'),
          h('li', {}, 'Other pages served from this same address (every github.io project of this account) share this browser storage. Use keys with a credit limit, and forget them on a shared computer.')),
        h('div', { class: 'tos-row tos-wrap' },
          h('button', { type: 'button', class: 'tos-btn', onclick: () => { for (const k of Object.keys(PROVIDER_KINDS) as ProviderKind[]) prefs.forgetKey(k); done('Every key removed.'); } }, 'Forget all keys'),
          h('button', { type: 'button', class: 'tos-btn', onclick: () => { prefs.chat.clear(); prefs.use(prefs.active(), undefined, 'chat'); done('Conversation cleared.'); } }, 'Clear the conversation'),
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
    return () => { unsubscribe(); lifetime.abort(); root.remove(); };
  };
}
