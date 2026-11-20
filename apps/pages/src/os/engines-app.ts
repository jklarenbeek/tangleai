/**
 * Charts and Collections: Jaren's chart engine fed by a run in this browser,
 * and its virtual collection over rows in memory and in SQLite.
 *
 * Charts runs the real memory loop (`@tangleai/pipeline` over an in-memory
 * store and the offline embedder) over one more observation at each step and
 * streams what each step measured into two charts; a third chart is a JSON document the
 * person edits, checked against the chart schema before it replaces the last
 * valid one. Collections mounts `@jarenjs/collection` over a range provider:
 * 10,000 rows in memory, or rows stored in a SQLite database opened in this
 * page. Every number on screen comes from these runs and sources.
 */
import { createApp, createArrayRangeProvider, createCollectionCoordinator } from '@jarenjs/app';
import { compileChart } from '@jarenjs/charts';
import { createChartComponent } from '@jarenjs/charts/component';
import chartSchema from '@jarenjs/charts/schemas/chart-definition.schema.json' with { type: 'json' };
import { mountProviderCollection } from '@jarenjs/collection/component';
import { compileMessageCatalog } from '@jarenjs/core/message';
import { ar, de, es, fr, ja, ko, nl, pt, ru, tr, zhTW } from '@jarenjs/locales';
import { OUR_SCHEMA_OPTIONS } from '@jarenjs/studio/component';
import { JarenValidator } from '@jarenjs/validate';
import { createMemoryUnitStore, recallByEmbedding } from '@tangleai/memory';
import { createOfflineEmbedder, createPipeline, PIPELINE_NODES, type DagNodeRecord } from '@tangleai/pipeline';
import type { ShippedMount } from '@tangleai/os/shell';
import { OBSERVATIONS } from '../loop-data.ts';
import { t } from './i18n.ts';

const PACKS: Record<string, Record<string, unknown>> = { ar, de, es, fr, ja, ko, nl, pt, ru, tr, 'zh-TW': zhTW };
const compiled = new Map<string, Readonly<Record<string, unknown>>>();
/** Jaren's catalogue for a language, compiled once; English is the components' own. */
function jarenMessages(locale: string) {
  const pack = PACKS[locale] ?? PACKS[locale.split('-')[0]];
  if (!pack) return undefined;
  let catalogue = compiled.get(locale);
  if (!catalogue) { catalogue = compileMessageCatalog(pack as any); compiled.set(locale, catalogue); }
  return catalogue;
}

// ── the run ─────────────────────────────────────────────────────────────

/** The question each step's recall answers; the observations are English, so it asks in English. */
export const PROBE = 'What is the current API rate limit?';

/** What one observation's step of the memory loop measured. */
export type IngestStep = {
  /** 1-based: how many observations the store has taken in after this step. */
  n: number,
  live: number, total: number,
  /** The probe's best cosine score over the live memories, or null while none ranks. */
  recall: number | null,
  /** Milliseconds per pipeline stage, as @jarenjs/flow reported them. */
  ms: Record<string, number>,
};

/**
 * Run the memory loop once per prefix of the observations (the first one,
 * the first two, …), each run a fresh store, as the Memory loop application
 * runs its whole corpus: the novelty and contradiction gates compare within
 * one run, so a step shows what the loop keeps after that many observations.
 * `onStep` receives each step as soon as it is measured. Nothing is
 * estimated: the counts are the pipeline's report, the recall a ranking over
 * the stored units, the milliseconds the DAG's records.
 */
export async function runIngestion(onStep: (step: IngestStep) => void, options: { signal?: { aborted: boolean } } = {}): Promise<IngestStep[]> {
  const embedder = createOfflineEmbedder();
  const [probe] = await embedder.embed([PROBE]);
  const steps: IngestStep[] = [];
  for (let i = 0; i < OBSERVATIONS.length; i++) {
    if (options.signal?.aborted) break;
    const store = createMemoryUnitStore();
    const records: DagNodeRecord[] = [];
    const report = await createPipeline({ store, embedder }).run(OBSERVATIONS.slice(0, i + 1), { onNode: (record) => records.push(record) });
    const units = await store.list();
    const { ranked } = recallByEmbedding(units, probe, { k: 1, minScore: -1, identity: { model: embedder.model, dims: embedder.dims } });
    const ms: Record<string, number> = {};
    for (const record of records) ms[record.id] = (ms[record.id] ?? 0) + record.ms;
    const step: IngestStep = { n: i + 1, live: report.memories.live, total: report.memories.total, recall: ranked[0]?.score ?? null, ms };
    steps.push(step);
    onStep(step);
  }
  return steps;
}

/** A stage's name as the Memory loop names it. */
const stageName = (id: string) => ({
  observations: t('loop/stage-observations'), embed: t('loop/stage-embed'), novelty: t('loop/stage-novelty'),
  contradiction: t('loop/stage-contradiction'), crystallize: t('loop/stage-crystallize'), report: t('loop/stage-report'),
} as Record<string, string>)[id] ?? id;
const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places;

/** Memories and the probe's recall after each step: a line chart, recall on its own right axis. */
export function growthChart(steps: readonly IngestStep[]) {
  const live = t('engines/series-live'), recall = t('engines/series-recall');
  return {
    type: 'line', title: t('engines/growth-title'), markers: true,
    xLabel: t('engines/x-observations'), yLabel: t('engines/y-memories'),
    y2: { series: [recall], label: t('engines/y-recall') },
    series: [
      { name: live, points: steps.map(s => ({ x: s.n, y: s.live })) },
      { name: recall, points: steps.flatMap(s => s.recall === null ? [] : [{ x: s.n, y: round(s.recall, 4) }]) },
    ],
  };
}

/** The milliseconds of each stage per step: a stacked bar chart, one stack per observation. */
export function stagesChart(steps: readonly IngestStep[]) {
  return {
    type: 'bar', stacked: true, title: t('engines/stages-title'), yLabel: t('engines/y-ms'),
    categories: steps.map(s => t('engines/observation', { n: s.n })),
    series: PIPELINE_NODES.map(id => ({ name: stageName(id), values: steps.map(s => round(s.ms[id] ?? 0, 3)) })),
  };
}

/** The editable chart's starting document: the last step's stage times, as a self-contained definition. */
export function editableChart(steps: readonly IngestStep[]) {
  const last = steps.at(-1);
  return {
    type: 'bar', title: t('engines/editor-title'), yLabel: t('engines/y-ms'),
    categories: PIPELINE_NODES.map(stageName),
    series: [{ name: t('engines/y-ms'), values: PIPELINE_NODES.map(id => round(last?.ms[id] ?? 0, 3)) }],
  };
}

/** How many points a pair of the run's charts draws (each line point, each bar segment). */
export const pointsOf = (steps: readonly IngestStep[]) =>
  growthChart(steps).series.reduce((n, s) => n + s.points.length, 0) + stagesChart(steps).series.reduce((n, s) => n + s.values.length, 0);

const validateDefinition = new JarenValidator(OUR_SCHEMA_OPTIONS).compile(chartSchema);
export type DefinitionCheck =
  | { ok: true, definition: Record<string, unknown> }
  | { ok: false, kind: 'json', reason: string }
  | { ok: false, kind: 'definition', issues: string[] };

/**
 * A chart definition typed by a person: parsed, checked against the chart
 * schema, then compiled once, so a document the renderer would refuse never
 * replaces the last valid chart. Issues are the schema's own pointers and
 * keywords (or the compiler's code), never a translation of them.
 */
export function checkDefinition(text: string): DefinitionCheck {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch (error) { return { ok: false, kind: 'json', reason: (error as Error).message }; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, kind: 'definition', issues: ['/ — type'] };
  const outcome: any = validateDefinition(value);
  const valid = typeof outcome === 'object' && outcome !== null ? outcome.valid : outcome === true;
  if (!valid) {
    const issues = (outcome?.errors ?? []).filter((e: any) => e.keyword !== 'allOf' && e.keyword !== 'if')
      .map((e: any) => `${e.instancePath || '/'} — ${e.keyword}${e.params && Object.keys(e.params).length ? ` ${JSON.stringify(e.params)}` : ''}`);
    return { ok: false, kind: 'definition', issues: issues.length ? [...new Set(issues)] as string[] : ['/ — schema'] };
  }
  try { compileChart(value as any); }
  catch (error) { return { ok: false, kind: 'definition', issues: [`${(error as any).code ?? 'compile'} ${(error as any).pointer ?? ''}`.trim()] }; }
  return { ok: true, definition: value as Record<string, unknown> };
}

// ── Charts ──────────────────────────────────────────────────────────────

function chartsView(state: any, charts: ReturnType<typeof createChartComponent>): any {
  const steps: IngestStep[] = state.steps;
  const status = state.running ? t('engines/running', { done: steps.length, total: OBSERVATIONS.length })
    : state.ran ? t('engines/finished', { points: pointsOf(steps) }) : '';
  const check = state.check;
  return ['div', { class: 'engines' },
    ['section', { class: 'engines-run', 'aria-labelledby': 'engines-run-heading' },
      ['header', { class: 'engines-head' },
        ['h1', { id: 'engines-run-heading' }, t('engines/charts-heading')],
        ['p', {}, t('engines/charts-lead')]],
      ['div', { class: 'engines-bar' },
        ['button', { type: 'button', class: 'primary', disabled: state.running ? true : null, on: { click: 'run' } }, state.ran ? t('engines/run-again') : t('engines/run')],
        ['p', { class: 'engines-status', role: 'status', 'data-points': state.running ? null : String(pointsOf(steps)) }, status]],
      ['p', { class: 'engines-probe' }, t('engines/probe', { question: PROBE })],
      ['div', { class: 'engines-charts' },
        ['figure', { class: 'engines-chart', 'data-chart': 'growth' }, charts.view(state.growth, state.growth)],
        ['figure', { class: 'engines-chart', 'data-chart': 'stages' }, charts.view(state.stages, state.stages)]]],
    ['section', { class: 'engines-editor', 'aria-labelledby': 'engines-editor-heading' },
      ['h2', { id: 'engines-editor-heading' }, t('engines/editor-heading')],
      ['p', {}, t('engines/editor-lead')],
      ['div', { class: 'engines-editor-grid' },
        ['div', { class: 'engines-editor-source' },
          ['label', { for: 'engines-definition' }, t('engines/editor-label')],
          ['textarea', { id: 'engines-definition', spellcheck: 'false', autocomplete: 'off', dir: 'ltr', rows: '16', value: state.draft,
            placeholder: t('engines/editor-waiting'), on: { input: { action: 'edit', event: ['value'] } } }],
          ['div', { class: 'engines-editor-actions' },
            ['button', { type: 'button', disabled: state.ran ? null : true, on: { click: 'fill' } }, t('engines/editor-reset')]],
          ['p', { class: `engines-check ${check ? (check.ok ? 'ok' : 'fail') : ''}`, role: 'status', 'data-check': check ? (check.ok ? 'valid' : check.kind) : 'none' },
            !check ? '' : check.ok ? t('engines/editor-valid') : check.kind === 'json' ? t('engines/editor-not-json', { reason: check.reason }) : t('engines/editor-invalid', { count: check.issues.length })],
          check && !check.ok && check.kind === 'definition'
            ? ['ul', { class: 'engines-issues', dir: 'ltr' }, check.issues.map((issue: string, i: number) => ['li', { key: String(i) }, ['code', {}, issue]])] : null],
        ['figure', { class: 'engines-chart', 'data-chart': 'own' }, state.good ? charts.view(state.good, state.good) : null]]]];
}

export const chartsMount: ShippedMount = (node, context) => {
  node.classList.add('tos-surface', 'tos-surface-charts');
  const host = node.ownerDocument.createElement('div');
  host.className = 'tos-engines';
  node.append(host);
  const charts = createChartComponent({ theme: 'host', messages: jarenMessages(context.locale) } as any);
  const run = { aborted: false };
  let live = true;
  const app = createApp({
    $app: '0.1',
    state: { running: false, ran: false, steps: [], growth: growthChart([]), stages: stagesChart([]), draft: '', edited: false, check: null, good: null },
    view: [{ match: '$', body: '$.ui' }],
    actions: {
      run: { patch: [{ op: 'replace', path: '/running', value: true }, { op: 'replace', path: '/steps', value: [] }], effects: [{ run: 'ingest', with: { edited: '$.edited' } }] },
      step: { patch: [{ op: 'add', path: '/steps/-', value: '$payload.step' }, { op: 'replace', path: '/growth', value: '$payload.growth' }, { op: 'replace', path: '/stages', value: '$payload.stages' }] },
      'run/done': { patch: [{ op: 'replace', path: '/running', value: false }, { op: 'replace', path: '/ran', value: true }] },
      fill: { effects: [{ run: 'fill', with: { steps: '$.steps' } }] },
      filled: { patch: [{ op: 'replace', path: '/draft', value: '$payload.draft' }, { op: 'replace', path: '/edited', value: false },
        { op: 'replace', path: '/check', value: { ok: true } }, { op: 'replace', path: '/good', value: '$payload.definition' }] },
      edit: { patch: [{ op: 'replace', path: '/draft', value: '$event.value' }, { op: 'replace', path: '/edited', value: true }], effects: [{ run: 'check', with: { text: '$event.value' } }] },
      'edit/good': { patch: [{ op: 'replace', path: '/check', value: { ok: true } }, { op: 'replace', path: '/good', value: '$payload' }] },
      'edit/bad': { patch: [{ op: 'replace', path: '/check', value: '$payload' }] },
    },
  } as any, {
    node: host,
    viewModel: (state: any) => ({ ...state, ui: chartsView(state, charts) }),
    effects: {
      ingest: (props: any, dispatch: (a: string, p?: unknown) => void) => {
        const steps: IngestStep[] = [];
        void runIngestion((step) => {
          steps.push(step);
          if (live) dispatch('step', { step, growth: growthChart(steps), stages: stagesChart(steps) });
        }, { signal: run }).then(() => {
          if (!live) return;
          dispatch('run/done');
          // the editable chart starts from this run, unless the person has made it their own
          if (!props.edited) { const definition = editableChart(steps); dispatch('filled', { draft: JSON.stringify(definition, null, 2), definition }); }
        }, (error) => { console.error('[tangle-os charts]', error); if (live) dispatch('run/done'); });
      },
      fill: (props: any, dispatch: (a: string, p?: unknown) => void) => {
        const definition = editableChart(props.steps ?? []);
        dispatch('filled', { draft: JSON.stringify(definition, null, 2), definition });
      },
      check: (props: any, dispatch: (a: string, p?: unknown) => void) => {
        const checked = checkDefinition(String(props.text ?? ''));
        if (checked.ok) dispatch('edit/good', checked.definition); else dispatch('edit/bad', checked);
      },
    },
    onError: (error: unknown) => console.error('[tangle-os charts]', error),
  });
  // a window opened on Charts shows a run, not an empty axis
  app.dispatch('run');
  return () => { live = false; run.aborted = true; app.destroy?.(); host.remove(); };
};

// ── Collections ─────────────────────────────────────────────────────────

/** Rows the in-memory source holds. */
export const MEMORY_ROWS = 10_000;
/** Rows the SQLite source stores (a resident snapshot: complete, and bounded). */
export const SQLITE_ROWS = 1_000;
type Row = { id: string, n: number, rank: number };
/** The in-memory rows: generated here, so the grid has something to scroll; nothing is measured in them. */
export const memoryRows = (count = MEMORY_ROWS): Row[] => Array.from({ length: count }, (_, i) => ({ id: `row-${i}`, n: i + 1, rank: (i * 7919) % count }));

type Opened = { provider: any, close: () => Promise<void> };
async function openSource(kind: 'memory' | 'sqlite'): Promise<Opened> {
  if (kind === 'memory') return { provider: createArrayRangeProvider(memoryRows()), close: async () => {} };
  // a separate script beside this one, fetched on first use: the desktop's bundle carries no SQLite
  const { openSqliteRows } = await import(new URL('./os-sqlite.js', import.meta.url).href);
  return openSqliteRows(memoryRows(SQLITE_ROWS));
}

export const collectionsMount: ShippedMount = (node, context) => {
  node.classList.add('tos-surface', 'tos-surface-collections');
  const doc = node.ownerDocument;
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, string> = {}, ...children: (Node | string)[]) => {
    const e = doc.createElement(tag);
    for (const [k, v] of Object.entries(props)) k === 'class' ? (e.className = v) : e.setAttribute(k, v);
    e.append(...children);
    return e;
  };
  const root = el('div', { class: 'tos-engines engines' });
  const buttons = { memory: el('button', { type: 'button', 'data-source': 'memory' }, t('engines/source-memory', { count: MEMORY_ROWS })),
    sqlite: el('button', { type: 'button', 'data-source': 'sqlite' }, t('engines/source-sqlite', { count: SQLITE_ROWS })) };
  const status = el('p', { class: 'engines-status', role: 'status' });
  const grid = el('div', { class: 'engines-collection' });
  root.append(
    el('header', { class: 'engines-head' }, el('h1', {}, t('engines/collections-heading')), el('p', {}, t('engines/collections-lead'))),
    el('div', { class: 'engines-bar', role: 'group', 'aria-label': t('engines/source') }, buttons.memory, buttons.sqlite),
    status, grid);
  node.append(root);
  const messages = jarenMessages(context.locale);
  let current: { kind: string, handle: any, close: () => Promise<void> } | null = null;
  let ticket = 0, live = true;
  const report = (handle: any, rows: number) => {
    const range = handle?.mounted?.controller?.layout?.().rowRange;
    const total = handle?.coordinator?.logicalCount?.() ?? 0;
    if (!range || total === 0) return;
    status.textContent = t('engines/status', { mounted: rows, total, first: Math.min(range.start + 1, total), last: Math.min(range.end, total) });
    status.dataset.total = String(total);
  };
  async function show(kind: 'memory' | 'sqlite') {
    const mine = ++ticket;
    for (const [k, b] of Object.entries(buttons)) b.setAttribute('aria-pressed', String(k === kind));
    status.textContent = t('engines/opening'); delete status.dataset.total;
    const previous = current; current = null;
    if (previous) { await previous.handle.dispose(); await previous.close(); }
    grid.replaceChildren();
    try {
      const opened = await openSource(kind);
      if (!live || mine !== ticket) { await opened.provider.dispose?.(); await opened.close(); return; }
      let handle: any = null;
      handle = mountProviderCollection(grid, createCollectionCoordinator(opened.provider), {
        height: 420, columnCount: 2, rowSize: 40, overscan: 8, columnSize: 220, columnOverscan: 1,
        label: t('engines/grid'), messages,
        renderCell: (row: Row, column: number) => column === 0 ? (kind === 'sqlite' ? t('engines/stored-row', { n: row.n }) : t('engines/row', { n: row.n })) : t('engines/rank', { n: row.rank }),
        onChange: (state: any) => queueMicrotask(() => report(handle, state.rows ?? 0)),
      });
      current = { kind, handle, close: opened.close };
      grid.dataset.source = kind;
      queueMicrotask(() => report(handle, handle.mounted?.controller?.stats?.().rows ?? 0));
    } catch (error) {
      if (live && mine === ticket) status.textContent = t('engines/unavailable', { reason: (error as Error).message });
    }
  }
  buttons.memory.addEventListener('click', () => { void show('memory'); });
  buttons.sqlite.addEventListener('click', () => { void show('sqlite'); });
  void show('memory');
  return () => {
    live = false; ticket++;
    const last = current; current = null;
    if (last) void Promise.resolve(last.handle.dispose()).then(() => last.close());
    root.remove();
  };
};
