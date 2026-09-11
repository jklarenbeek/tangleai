/**
 * Vnode builders — the host side of the view. The app document's
 * stylesheet is a single splice of `$.ui.root`; everything below builds
 * plain @jarenjs/view JSON (arrays and strings), computed in the
 * viewModel so unchanged subtrees keep reference identity and patch in
 * O(1).
 *
 * Rendering machinery from the suite: mermaid SVG via `renderMermaid`
 * (memoized on source text), charts via `compileChart`, assistant
 * markdown via `createMdComponent` (hash-cached).
 */

import { renderMermaid } from '@jarenjs/mermaid';
import { compileChart } from '@jarenjs/charts';
import { createMdComponent } from '@jarenjs/md/component';

const md = createMdComponent({ headingIds: false });

let mermaidSource = '';
let mermaidVnode: any = null;
function mermaidSvg(source: string): any {
  if (source !== mermaidSource) {
    mermaidSource = source;
    mermaidVnode = source === '' ? null : renderMermaid(source, { theme: 'host' });
  }
  return mermaidVnode;
}

const on = (action: string, withValue?: any, event?: string[]): any => {
  const binding: any = withValue === undefined ? action : { action, with: withValue };
  if (event !== undefined) return { ...(typeof binding === 'string' ? { action: binding } : binding), event };
  return binding;
};

const PAGES: Array<[string, string]> = [
  ['chat', 'Chat'], ['loom', 'Loom'], ['memory', 'Memory'], ['documents', 'Documents'], ['settings', 'Settings'],
];

function header(state: any): any {
  const counts = state.status?.counts;
  return ['header', { class: 'top' },
    ['div', { class: 'brand' }, ['span', { class: 'knot' }, '◉'], ' tangle'],
    ['nav', { class: 'tabs' },
      PAGES.map(([id, label]) => ['button', {
        key: id,
        class: state.page === id ? 'tab active' : 'tab',
        on: { click: on('nav', id) },
      }, label])],
    ['div', { class: 'meta' },
      counts ? `${counts.live} live · ${counts.sources ?? 0} sources · ${counts.runs} runs` : '…'],
  ];
}

// -- chat -------------------------------------------------------------------

function message(m: any, index: number): any {
  const body = m.role === 'assistant' ? md.view(m.text) : ['p', {}, m.text];
  return ['div', { key: m.id ?? `local-${index}`, class: `msg ${m.role}` },
    ['div', { class: 'msg-body' }, body],
    m.provider ? ['div', { class: 'msg-meta' }, `via ${m.provider}`] : null,
  ];
}

function chatPage(state: any): any {
  const chat = state.chat;
  return ['section', { class: 'page chat' },
    ['div', { class: 'messages' },
      chat.messages.length === 0
        ? ['div', { class: 'empty' },
            ['h2', {}, 'Ask your folder anything'],
            ['p', {}, 'Point Tangle at a folder in Settings, sync it on the Loom page, and chat over the curated memory. Without a model configured, answers are grounded recall — memories, cited.']]
        : chat.messages.map(message),
      chat.busy ? ['div', { class: 'msg assistant pending', key: 'pending' }, ['div', { class: 'msg-body' }, '…thinking']] : null,
    ],
    chat.error ? ['div', { class: 'error' }, String(chat.error)] : null,
    chat.citations.length > 0
      ? ['div', { class: 'citations' },
          ['h3', {}, 'grounded on'],
          chat.citations.map((c: any) => ['div', { key: c.id, class: 'citation', on: { click: on('memory/select', c) } },
            ['span', { class: 'cite-text' }, c.text],
            ['span', { class: 'cite-evidence' }, c.evidence]])]
      : null,
    chat.documentCitations.length > 0
      ? ['div', { class: 'citations' },
          ['h3', {}, 'document sources'],
          chat.documentCitations.map((item: any) => ['a', {
            key: item.chunk.id, class: 'citation', href: item.citation.url, target: '_blank', rel: 'noreferrer',
          },
            ['span', { class: 'cite-text' }, item.chunk.text],
            ['span', { class: 'cite-evidence' }, `${item.source.title ?? item.citation.url}${item.citation.page ? ` · page ${item.citation.page}` : ''}`]])]
      : null,
    ['form', { class: 'composer', on: { submit: { action: 'chat/send', preventDefault: true } } },
      ['input', {
        class: 'chat-input', type: 'text', placeholder: 'ask the memory…',
        value: chat.input, disabled: chat.busy ? true : null,
        on: { input: on('chat/input', undefined, ['value']) },
      }],
      ['button', { class: 'send', type: 'submit', disabled: chat.busy || state.chat.input === '' ? true : null }, 'send'],
    ],
  ];
}

// -- loom (DAG + runs) ------------------------------------------------------

const STATUS_GLYPH: Record<string, string> = { ok: '✓', error: '✕', aborted: '⊘', restored: '↺' };

function nodeStrip(nodes: string[], live: Record<string, any>, running: boolean): any {
  return ['div', { class: 'nodes' },
    nodes.map((id) => {
      const record = live[id];
      const cls = record === undefined ? (running ? 'node waiting' : 'node idle') : `node ${record.status}`;
      return ['div', { key: id, class: cls },
        ['span', { class: 'node-name' }, id],
        record ? ['span', { class: 'node-ms' }, `${STATUS_GLYPH[record.status] ?? record.status} ${record.ms}ms`] : null];
    })];
}

function memoryGrowthChart(runs: any[]): any {
  const points = runs
    .filter((r) => r.summary?.report)
    .map((r) => ({ x: r.startedAt, y: r.summary.report.memories.live }))
    .reverse();
  if (points.length < 2) return null;
  return ['div', { class: 'chart-card' },
    compileChart(
      { type: 'line', title: 'Live memories over runs', x: 'time' },
      { series: [{ name: 'live', points }] },
      { theme: 'host' },
    ).toVnode()];
}

function stageChart(detail: any): any {
  if (!detail) return null;
  const values = detail.events.map((e: any) => ({ label: e.node, value: e.ms }));
  if (values.length === 0) return null;
  return ['div', { class: 'chart-card' },
    compileChart(
      { type: 'bar', title: `Run ${detail.run.id} — ms per stage` },
      { values },
      { theme: 'host' },
    ).toVnode()];
}

function runRow(run: any, selected: boolean): any {
  const report = run.summary?.report;
  const label = report
    ? `+${report.novelty.admitted} admitted · ${report.contradiction.contradictions} contradictions · ${report.crystallize.merged} merged`
    : run.summary?.files ? 'no changes' : run.status;
  return ['tr', {
    key: run.id,
    class: selected ? 'run selected' : 'run',
    on: { click: on('run/select', run.id) },
  },
    ['td', { class: `run-status ${run.status}` }, run.status],
    ['td', {}, run.kind],
    ['td', { class: 'mono' }, run.startedAt],
    ['td', {}, label],
  ];
}

function loomPage(state: any): any {
  const loom = state.loom;
  const running = loom.live.run?.status === 'running';
  const nodeIds = ['document', 'documents'].includes(loom.live.run?.kind)
    ? ['fetch', 'extract', 'chunk', 'embed', 'store']
    : loom.nodes;
  return ['section', { class: 'page loom' },
    ['div', { class: 'loom-head' },
      ['h2', {}, 'The loom'],
      ['p', { class: 'hint' }, 'This diagram is the executable jaren-dag document — the picture is the pipeline.'],
      ['button', {
        class: 'send', disabled: loom.syncing ? true : null,
        on: { click: on('sync') },
      }, loom.syncing ? 'syncing…' : 'sync folder'],
    ],
    loom.syncError ? ['div', { class: 'error' }, String(loom.syncError)] : null,
    ['div', { class: 'dag-panel' },
      ['div', { class: 'dag-svg' }, mermaidSvg(loom.mermaid)],
      nodeStrip(nodeIds, loom.live.nodes, running),
    ],
    memoryGrowthChart(loom.runs),
    stageChart(loom.detail),
    ['div', { class: 'runs-panel' },
      ['h3', {}, 'run history'],
      loom.runs.length === 0
        ? ['p', { class: 'hint' }, 'No runs yet — set a folder in Settings and sync.']
        : ['table', { class: 'runs' },
            ['tbody', {}, loom.runs.map((r: any) => runRow(r, loom.detail?.run?.id === r.id))]],
      loom.detail
        ? ['div', { class: 'run-detail' },
            ['div', { class: 'detail-head' },
              ['h4', {}, loom.detail.run.id],
              ['button', { class: 'close', on: { click: on('run/close') } }, '×']],
            ['table', { class: 'events' },
              ['tbody', {},
                loom.detail.events.map((e: any) => ['tr', { key: e.id },
                  ['td', { class: 'mono' }, String(e.seq)],
                  ['td', {}, e.node],
                  ['td', { class: `run-status ${e.status}` }, e.status],
                  ['td', { class: 'mono' }, `${e.ms}ms`]])]]]
        : null,
    ],
  ];
}

// -- memory -----------------------------------------------------------------

function memoryRow(m: any): any {
  return ['div', { key: m.id, class: m.supersededBy ? 'unit superseded' : 'unit', on: { click: on('memory/select', m) } },
    ['div', { class: 'unit-text' }, m.text],
    ['div', { class: 'unit-meta' },
      ['span', { class: `kind ${m.kind}` }, m.kind],
      m.confidence !== undefined ? ['span', {}, `conf ${m.confidence}`] : null,
      ['span', { class: 'mono' }, m.evidence],
      m.supersededBy ? ['span', { class: 'superseded-tag' }, 'superseded'] : null,
    ]];
}

function memoryDetail(m: any): any {
  return ['div', { class: 'run-detail' },
    ['div', { class: 'detail-head' },
      ['h4', { class: 'mono' }, m.id],
      ['button', { class: 'close', on: { click: on('memory/close') } }, '×']],
    ['p', { class: 'unit-text' }, m.text],
    ['dl', { class: 'facts' },
      ['dt', {}, 'evidence'], ['dd', { class: 'mono' }, m.evidence],
      ['dt', {}, 'kind'], ['dd', {}, m.kind],
      ['dt', {}, 'at'], ['dd', { class: 'mono' }, m.at],
      ['dt', {}, 'tags'], ['dd', {}, m.tags.join(', ') || '—'],
      m.confidence !== undefined ? [['dt', {}, 'confidence'], ['dd', {}, String(m.confidence)]] : null,
      m.supersededBy ? [['dt', {}, 'superseded by'], ['dd', { class: 'mono' }, m.supersededBy]] : null,
      m.supersededReason ? [['dt', {}, 'reason'], ['dd', {}, m.supersededReason]] : null,
      m.mergedFrom ? [['dt', {}, 'merged from'], ['dd', { class: 'mono' }, m.mergedFrom.join(', ')]] : null,
    ]];
}

function memoryPage(state: any): any {
  const memory = state.memory;
  return ['section', { class: 'page memory' },
    ['div', { class: 'loom-head' },
      ['h2', {}, 'Memory'],
      ['input', {
        class: 'chat-input', type: 'search', placeholder: 'search text or evidence…', value: memory.q,
        on: { input: on('memory/q', undefined, ['value']) },
      }],
      ['label', { class: 'check' },
        ['input', { type: 'checkbox', checked: memory.superseded ? true : null,
          on: { change: on('memory/superseded', undefined, ['checked']) } }],
        ' show superseded'],
    ],
    memory.detail ? memoryDetail(memory.detail) : null,
    ['div', { class: 'units' },
      memory.items.length === 0
        ? ['p', { class: 'hint' }, 'Nothing here yet — sync a folder on the Loom page.']
        : memory.items.map(memoryRow)],
  ];
}

// -- documents --------------------------------------------------------------

function documentPage(state: any): any {
  const documents = state.documents;
  const capability = documents.browser;
  return ['section', { class: 'page memory' },
    ['div', { class: 'loom-head' },
      ['h2', {}, 'Documents'],
      ['span', { class: capability?.available ? 'saved' : 'hint' },
        capability === null ? 'checking renderer…' : `${capability.mode}: ${capability.detail}`],
    ],
    ['form', { class: 'composer', on: { submit: { action: 'documents/ingest', preventDefault: true } } },
      ['input', {
        class: 'chat-input', type: 'url', placeholder: 'https://example.org/document', value: documents.url,
        disabled: documents.busy ? true : null,
        on: { input: on('documents/url', undefined, ['value']) },
      }],
      ['button', { class: 'send', type: 'submit', disabled: documents.busy || documents.url === '' ? true : null },
        documents.busy ? 'ingesting…' : 'ingest'],
    ],
    documents.error ? ['div', { class: 'error' }, documents.error] : null,
    ['div', { class: 'group' },
      ['h3', {}, 'Discover with SearxNG'],
      ['form', { class: 'composer', on: { submit: { action: 'documents/webSearch', preventDefault: true } } },
        ['input', {
          class: 'chat-input', type: 'search', placeholder: 'find documents on the web…', value: documents.webQ,
          on: { input: on('documents/webQ', undefined, ['value']) },
        }],
        ['button', { class: 'send', type: 'submit', disabled: documents.webBusy || documents.webQ === '' ? true : null },
          documents.webBusy ? 'searching…' : 'search']],
      documents.webError ? ['div', { class: 'error-inline' }, documents.webError] : null,
      documents.webResults.length > 0
        ? ['div', { class: 'actions-row' },
            ['button', {
              class: 'send', disabled: documents.busy || documents.webSelected.length === 0 ? true : null,
              on: { click: on('documents/webIngest') },
            }, documents.busy ? 'ingesting…' : `ingest selected (${documents.webSelected.length})`]]
        : null,
      documents.webResults.map((result: any) => {
        const selected = documents.webSelected.includes(result.url);
        const next = selected
          ? documents.webSelected.filter((url: string) => url !== result.url)
          : [...documents.webSelected, result.url];
        return ['div', { key: result.url, class: 'unit' },
          ['div', { class: 'unit-text' }, result.title || result.url],
          result.content ? ['p', { class: 'hint' }, result.content] : null,
          ['div', { class: 'unit-meta' },
            ['label', { class: 'check' },
              ['input', { type: 'checkbox', checked: selected ? true : null, on: { change: on('documents/webSelected', next) } }],
              ' select'],
            ['a', { href: result.url, target: '_blank', rel: 'noreferrer' }, result.url],
            ['button', { class: 'tab', disabled: documents.busy ? true : null, on: { click: on('documents/ingestUrl', result.url) } }, 'ingest one']]];
      }),
      documents.webIngestResults.length > 0
        ? ['div', { class: 'units' }, documents.webIngestResults.map((result: any) =>
            ['div', { key: result.url, class: 'unit-meta' },
              ['span', { class: `run-status ${result.outcome ? 'ok' : 'error'}` }, result.outcome?.status ?? result.error?.code ?? 'error'],
              ['span', {}, result.url],
              result.error ? ['span', {}, result.error.message] : null])]
        : null],
    ['div', { class: 'loom-head' },
      ['h3', {}, 'Search the corpus'],
      ['input', {
        class: 'chat-input', type: 'search', placeholder: 'semantic search…', value: documents.q,
        on: { input: on('documents/q', undefined, ['value']) },
      }],
    ],
    documents.results.length > 0
      ? ['div', { class: 'units' }, documents.results.map((result: any) =>
          ['div', { key: result.chunk.id, class: 'unit' },
            ['div', { class: 'unit-text' }, result.chunk.text],
            ['div', { class: 'unit-meta' },
              ['span', {}, result.score.toFixed(3)],
              ['a', { href: result.citation.url, target: '_blank', rel: 'noreferrer' },
                `${result.source.title ?? result.citation.url}${result.citation.page ? ` · page ${result.citation.page}` : ''}`],
              result.citation.headingPath.length > 0
                ? ['span', {}, result.citation.headingPath.join(' › ')]
                : null],
          ])]
      : null,
    ['h3', {}, 'Sources'],
    ['div', { class: 'units' },
      documents.items.length === 0
        ? ['p', { class: 'hint' }, 'No web documents ingested yet.']
        : documents.items.map((source: any) => ['div', { key: source.id, class: 'unit' },
            ['div', { class: 'unit-text' }, source.title ?? source.canonicalUrl],
            ['div', { class: 'unit-meta' },
              ['span', { class: `run-status ${source.status === 'ready' ? 'ok' : 'error'}` }, source.status],
              ['span', {}, source.mimeType],
              ['span', {}, source.fetchMode],
              ['a', { href: source.canonicalUrl, target: '_blank', rel: 'noreferrer' }, source.canonicalUrl]]])],
  ];
}

// -- settings ---------------------------------------------------------------

function field(label: string, action: string, value: any, placeholder = ''): any {
  return ['label', { class: 'field' },
    ['span', {}, label],
    ['input', {
      type: 'text', value: value ?? '', placeholder,
      on: { input: on(action, undefined, ['value']) },
    }]];
}

function select(label: string, action: string, value: any, options: Array<string | null>): any {
  return ['label', { class: 'field' },
    ['span', {}, label],
    ['select', { on: { change: on(action, undefined, ['value']) } },
      options.map((o) => ['option', {
        key: String(o), value: o ?? '', selected: (value ?? '') === (o ?? '') ? true : null,
      }, o ?? '(none)'])]];
}

/** A write-only credential input: blank after every save (the key re-mounts it), badge says configured, clearing is an explicit checkbox. Uncontrolled on purpose — a controlled empty value would wipe each keystroke, and the typed value must never render back. */
function secretField(label: string, action: string, clearAction: string, configured: boolean, pendingClear: boolean, epoch: number): any {
  return ['div', { class: 'field secret' },
    ['label', { class: 'field' },
      ['span', {}, label],
      ['input', {
        key: `${action}-${epoch}`,
        placeholder: configured ? '(configured — type to replace)' : '(not configured)',
        on: { input: on(action, undefined, ['value']) },
      }]],
    ['label', { class: 'check' },
      ['input', { type: 'checkbox', checked: pendingClear ? true : null,
        on: { change: on(clearAction, undefined, ['checked']) } }],
      ` clear the stored ${label} on save`],
    ['span', { class: configured ? 'saved' : 'hint' }, configured ? 'configured' : 'not configured']];
}

/** The read-only config inspection — what the resolver says about the current stack. */
function configPanel(state: any): any {
  const inspect = state.settings.inspect;
  if (inspect === null || inspect === undefined) return null;
  const identity = inspect.identity;
  const resolution = inspect.resolution;
  return ['div', { class: 'group' },
    ['h3', {}, 'Effective configuration'],
    ['p', { class: 'hint' },
      `registry ${String(inspect.registry.revision).slice(0, 12)}… · intents ${inspect.registry.tags.map((t: any) => t.tag).join(', ')} · request ${inspect.request.kind}`],
    ['p', { class: resolution.state === 'ready' ? 'saved' : resolution.state === 'provisional' ? 'hint' : 'error-inline' },
      resolution.state === 'ready' ? 'resolved'
        : resolution.state === 'provisional' ? 'provisional — the embedding width is unproven until a reply confirms it'
        : 'refused'],
    resolution.issues.length > 0
      ? ['ul', { class: 'hint' }, resolution.issues.map((issue: any) =>
          ['li', { key: `${issue.code}${issue.path}` }, `${issue.code} ${issue.path} — ${issue.detail}`])]
      : null,
    identity !== null && identity !== undefined
      ? ['p', { class: 'hint' },
          `identity ${String(identity.identityId).slice(0, 12)}…`
          + (identity.roles.chat !== undefined ? ` · chat ${identity.roles.chat.provider}/${identity.roles.chat.model}` : ' · no chat wire')
          + (identity.embedding !== null ? ` · embeddings ${identity.embedding.model} @ ${identity.embedding.dims}` : ' · no embedding identity')
          + (identity.components.policy !== null ? ` · policies ${identity.components.policy.id}` : '')]
      : null,
    ['p', { class: 'hint' },
      `key slots — chat: ${inspect.slots.chatKey ? 'configured' : 'none'} · embeddings: ${inspect.slots.embedKey ? 'configured' : 'none'} · renderer: ${inspect.slots.browserToken ? 'configured' : 'none'}. Values are write-only and never shown.`]];
}

function settingsPage(state: any): any {
  const draft = state.settings.draft;
  if (draft === null) return ['section', { class: 'page' }, ['p', { class: 'hint' }, 'loading…']];
  const probe = state.settings.probe;
  const embedProbe = state.settings.embedProbe;
  return ['section', { class: 'page settings' },
    ['h2', {}, 'Settings'],
    configPanel(state),
    ['div', { class: 'group' },
      ['h3', {}, 'Folder'],
      field('path', 'settings/folder', draft.folder, '/path/to/your/notes'),
      ['p', { class: 'hint' }, 'The folder Tangle curates memory from. Sync happens on the Loom page; unchanged files are skipped by content hash.']],
    ['div', { class: 'group' },
      ['h3', {}, 'Chat model'],
      select('provider', 'settings/chat-provider', draft.chat.provider, [null, 'ollama', 'lmstudio', 'openrouter', 'custom']),
      field('base url', 'settings/chat-baseurl', draft.chat.baseUrl, 'http://localhost:11434'),
      field('model', 'settings/chat-model', draft.chat.model, 'qwen3:4b'),
      field('completion token limit', 'settings/chat-max-tokens', draft.chat.maxTokens ?? null, 'provider default'),
      select('token limit field', 'settings/chat-max-field', draft.chat.maxTokensField ?? 'max_tokens', ['max_tokens', 'max_completion_tokens']),
      secretField('api key', 'settings/chat-apikey', 'settings/clear-chat-key', state.settings.draft?.slots?.chatKey === true, state.settings.clear.chatKey, state.settings.saveCount),
      ['p', { class: 'hint' }, 'Optional. Without one, chat answers are grounded recall — cited memories, no generation.']],
    ['div', { class: 'group' },
      ['h3', {}, 'Embeddings'],
      select('provider', 'settings/embed-provider', draft.embed.provider, ['builtin', 'ollama', 'lmstudio', 'openrouter', 'custom']),
      field('base url', 'settings/embed-baseurl', draft.embed.baseUrl, 'http://localhost:11434'),
      field('model', 'settings/embed-model', draft.embed.model, 'nomic-embed-text'),
      secretField('api key', 'settings/embed-apikey', 'settings/clear-embed-key', state.settings.draft?.slots?.embedKey === true, state.settings.clear.embedKey, state.settings.saveCount),
      ['p', { class: 'hint' }, '`builtin` is @jarenjs/ai\'s deterministic hash-trigram embedder — lexical, demo-grade, zero setup. Configure a real model for semantic recall; memories synced under one embedder are only ever ranked by that embedder.']],
    ['div', { class: 'group' },
      ['h3', {}, 'Document corpus'],
      select('chunker', 'settings/document-chunker', draft.documents.chunker, ['recursive', 'semantic-boundary', 's2']),
      field('maximum tokens', 'settings/document-max', draft.documents.maxTokens, '450'),
      field('overlap tokens', 'settings/document-overlap', draft.documents.overlapTokens, '48'),
      ['p', { class: 'hint' }, 'Recursive heading-aware chunking is the safe default. Semantic-boundary and corrected S2 remain measurable experiments.']],
    ['div', { class: 'group' },
      ['h3', {}, 'Dynamic-page fallback'],
      select('mode', 'settings/browser-mode', draft.browser.mode, ['disabled', 'webview', 'remote']),
      field('remote endpoint', 'settings/browser-endpoint', draft.browser.endpoint, 'http://127.0.0.1:4720'),
      secretField('renderer token', 'settings/browser-token', 'settings/clear-browser-token', state.settings.draft?.slots?.browserToken === true, state.settings.clear.browserToken, state.settings.saveCount),
      ['label', { class: 'check' },
        ['input', { type: 'checkbox', checked: draft.browser.allowUnsafeLocal ? true : null,
          on: { change: on('settings/browser-unsafe', undefined, ['checked']) } }],
        ' permit experimental local WebView for trusted pages'],
      ['p', { class: 'hint' }, 'Static fetch always runs first. Use the remote Playwright service for untrusted dynamic pages; WebView cannot enforce the full subresource address policy.']],
    ['div', { class: 'group' },
      ['h3', {}, 'Web discovery'],
      field('SearxNG URL', 'settings/search-url', draft.search.searxngUrl, 'http://127.0.0.1:8080')],
    ['div', { class: 'actions-row' },
      ['button', { class: 'send', on: { click: on('settings/save') } }, 'save'],
      ['button', { class: 'tab', on: { click: on('probe') } }, 'probe chat provider'],
      ['button', { class: 'tab', on: { click: on('embedProbe') } }, 'probe embedder'],
      state.settings.saved ? ['span', { class: 'saved' }, 'saved ✓'] : null,
      probe ? ['span', { class: probe.ok ? 'saved' : 'error-inline' },
        probe.pending ? 'probing…' : probe.ok ? `reachable — ${(probe.models ?? []).length} models` : `unreachable: ${probe.error ?? probe.status ?? ''}`] : null,
      embedProbe ? ['span', { class: embedProbe.ok ? 'saved' : 'error-inline' },
        embedProbe.pending ? 'probing…' : embedProbe.ok ? `embeds — ${embedProbe.model} @ ${embedProbe.dims} dims` : `cannot embed: ${embedProbe.error ?? embedProbe.status ?? ''}`] : null],
  ];
}

// -- root -------------------------------------------------------------------

export function rootView(state: any): any {
  const page = state.page === 'chat' ? chatPage(state)
    : state.page === 'loom' ? loomPage(state)
    : state.page === 'memory' ? memoryPage(state)
    : state.page === 'documents' ? documentPage(state)
    : settingsPage(state);
  return ['div', { class: 'shell' }, header(state), page];
}
