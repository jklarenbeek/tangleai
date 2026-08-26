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
  ['chat', 'Chat'], ['loom', 'Loom'], ['memory', 'Memory'], ['settings', 'Settings'],
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
      counts ? `${counts.live} live · ${counts.memories} total · ${counts.runs} runs` : '…'],
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
      nodeStrip(loom.nodes, loom.live.nodes, running),
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

function settingsPage(state: any): any {
  const draft = state.settings.draft;
  if (draft === null) return ['section', { class: 'page' }, ['p', { class: 'hint' }, 'loading…']];
  const probe = state.settings.probe;
  const embedProbe = state.settings.embedProbe;
  return ['section', { class: 'page settings' },
    ['h2', {}, 'Settings'],
    ['div', { class: 'group' },
      ['h3', {}, 'Folder'],
      field('path', 'settings/folder', draft.folder, '/path/to/your/notes'),
      ['p', { class: 'hint' }, 'The folder Tangle curates memory from. Sync happens on the Loom page; unchanged files are skipped by content hash.']],
    ['div', { class: 'group' },
      ['h3', {}, 'Chat model'],
      select('provider', 'settings/chat-provider', draft.chat.provider, [null, 'ollama', 'lmstudio', 'openrouter', 'custom']),
      field('base url', 'settings/chat-baseurl', draft.chat.baseUrl, 'http://localhost:11434'),
      field('model', 'settings/chat-model', draft.chat.model, 'qwen3:4b'),
      field('api key', 'settings/chat-apikey', draft.chat.apiKey),
      ['p', { class: 'hint' }, 'Optional. Without one, chat answers are grounded recall — cited memories, no generation.']],
    ['div', { class: 'group' },
      ['h3', {}, 'Embeddings'],
      select('provider', 'settings/embed-provider', draft.embed.provider, ['builtin', 'ollama', 'lmstudio', 'openrouter', 'custom']),
      field('base url', 'settings/embed-baseurl', draft.embed.baseUrl, 'http://localhost:11434'),
      field('model', 'settings/embed-model', draft.embed.model, 'nomic-embed-text'),
      field('api key', 'settings/embed-apikey', draft.embed.apiKey),
      ['p', { class: 'hint' }, '`builtin` is @jarenjs/ai\'s deterministic hash-trigram embedder — lexical, demo-grade, zero setup. Configure a real model for semantic recall; memories synced under one embedder are only ever ranked by that embedder.']],
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
    : settingsPage(state);
  return ['div', { class: 'shell' }, header(state), page];
}
