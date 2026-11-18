/**
 * The memory loop as a desktop application: the real @tangleai/pipeline (the
 * same jaren-dag document the desktop app executes) runs in this browser over
 * an in-memory store and the deterministic hash embedder, with no network.
 * The diagram is projected from the executable document; every number on
 * screen is a real run's.
 */
import { createApp } from '@jarenjs/app';
import { renderMermaid } from '@jarenjs/mermaid';
import { DEFAULT_MEMORY_POLICY, createMemoryUnitStore, recallByEmbedding, type MemoryStore } from '@tangleai/memory';
import { createOfflineEmbedder, createPipeline, dagToMermaid, PIPELINE_NODES, type DagNodeRecord } from '@tangleai/pipeline';
import type { ShippedMount } from '@tangleai/os/shell';
import integration from '../../../../benchmark/results/jaren-integration.json' with { type: 'json' };
import { OBSERVATIONS } from '../loop-data.ts';
import { t } from './i18n.ts';

/** The measured strategies, by what each puts in front of the model. */
const labels = (): Record<string, string> => ({
  'long-context': t('loop/strategy-long-context'), 'near-raw': t('loop/strategy-near-raw'), 'rag-observation': t('loop/strategy-rag-observation'),
  'rag-summary': t('loop/strategy-rag-summary'), 'long-horizon': t('loop/strategy-long-horizon'), near: t('loop/strategy-near'),
});
/** The question asked when the field is empty: the observations are English, so the recall asks in English. */
const DEFAULT_QUESTION = 'What is the current API rate limit?';

function nodes(records: DagNodeRecord[]): any {
  const byId = new Map(records.map(r => [r.id, r]));
  return ['ol', { class: 'loop-nodes', 'aria-label': t('loop/steps') }, [...PIPELINE_NODES].map((id) => {
    const record = byId.get(id);
    return ['li', { key: id, class: `loop-node ${record ? record.status : 'idle'}` },
      ['span', { class: 'loop-node-name' }, id],
      record ? ['span', { class: 'loop-node-ms' }, t('loop/ms', { value: Math.round(record.ms * 100) / 100 })] : null];
  })];
}

function view(state: any, diagram: any): any {
  const r = state.report;
  return ['div', { class: 'loop' },
    ['header', { class: 'loop-head' },
      ['h1', {}, t('loop/title')],
      ['p', {}, t('loop/lead')]],
    ['figure', { class: 'loop-diagram' }, diagram, ['figcaption', {}, t('loop/caption')]],
    ['section', { class: 'loop-run' },
      ['button', { type: 'button', class: 'primary', disabled: state.running ? true : null, on: { click: 'run' } }, state.ran ? t('loop/run-again') : t('loop/run')],
      ['p', { class: 'loop-policy' }, t('loop/policy', { novelty: DEFAULT_MEMORY_POLICY.novelty.enabled, contradiction: DEFAULT_MEMORY_POLICY.contradiction.enabled, crystallization: DEFAULT_MEMORY_POLICY.crystallization.enabled, dims: DEFAULT_MEMORY_POLICY.embedding.dims })],
      nodes(state.records),
      r ? ['dl', { class: 'loop-report' },
        ['div', {}, ['dt', {}, t('loop/observations')], ['dd', {}, String(r.observations)]],
        ['div', {}, ['dt', {}, t('loop/gated')], ['dd', {}, String(r.novelty.filtered)]],
        ['div', {}, ['dt', {}, t('loop/resolved')], ['dd', {}, String(r.contradiction.contradictions)]],
        ['div', {}, ['dt', {}, t('loop/merged')], ['dd', {}, String(r.crystallize.merged)]],
        ['div', {}, ['dt', {}, t('loop/live')], ['dd', {}, t('loop/live-of', { live: r.memories.live, total: r.memories.total })]]] : null],
    state.ran ? ['section', { class: 'loop-ask' },
      ['h2', {}, t('loop/ask')],
      ['form', { on: { submit: { action: 'ask', preventDefault: true } } },
        ['input', { type: 'text', value: state.question, placeholder: t('loop/question-placeholder'), 'aria-label': t('loop/question'), on: { input: { action: 'question', event: ['value'] } } }],
        ['button', { type: 'submit', class: 'primary' }, t('loop/recall')]],
      state.answer ? (state.answer.results.length === 0 ? ['p', { class: 'loop-empty' }, t('loop/nothing-recalled')]
        : ['ul', { class: 'loop-hits' }, state.answer.results.map((hit: any, i: number) => ['li', { key: String(i) },
          ['span', { class: 'loop-score' }, hit.score], ['span', { class: 'loop-text' }, hit.text], ['span', { class: 'loop-evidence' }, hit.evidence]])]) : null] : null,
    ['section', { class: 'loop-measured' },
      ['h2', {}, t('loop/measured')],
      ['p', {}, t('loop/history', { version: integration.jaren, date: integration.measuredAt })],
      ['table', {},
        ['thead', {}, ['tr', {}, ['th', {}, t('loop/runtime')], ['th', {}, t('loop/before')], ['th', {}, t('loop/cursor')], ['th', {}, t('loop/faster')]]],
        ['tbody', {}, integration.history.map((row: any) => ['tr', { key: row.runtime },
          ['td', {}, `${row.runtime} ${row.version}`], ['td', {}, t('loop/ms', { value: row.previousP95Ms.toFixed(2) })], ['td', {}, t('loop/ms', { value: row.boundedP95Ms.toFixed(2) })], ['td', {}, `${row.p95Speedup.toFixed(2)}×`]])]],
      ['p', {}, t('loop/answers', { model: integration.paid.model })],
      ['table', {},
        ['thead', {}, ['tr', {}, ['th', {}, t('loop/strategy')], ['th', {}, t('loop/valid')], ['th', {}, t('loop/f-score')], ['th', {}, t('loop/recall-column')]]],
        ['tbody', {}, integration.paid.qa.rows.map((row: any) => ['tr', { key: row.key },
          ['td', {}, labels()[row.key] ?? row.key],
          ['td', {}, row.key === 'long-horizon' ? `${integration.bounded.current.valid}/${integration.bounded.current.planned}` : `${row.answered - row.invalid}/${row.planned}`],
          ['td', {}, (row.key === 'long-horizon' ? integration.bounded.current.f1 : row.f1)?.toFixed(3) ?? '—'],
          ['td', {}, (row.key === 'long-horizon' ? integration.bounded.current.recall : row.ceiling)?.toFixed(3) ?? '—']])]],
      ['p', { class: 'loop-note' }, t('loop/note'),
        ['a', { href: 'https://github.com/jklarenbeek/tangleai/blob/main/docs/JARENJS_BENCHMARK.md', target: '_blank', rel: 'noopener' }, t('loop/methods')]]],
  ];
}

export const loopMount: ShippedMount = (node) => {
  const host = node.ownerDocument.createElement('div');
  host.className = 'tos-surface tos-loop';
  node.append(host);
  // the pipeline's own projection as a chain, left to right: the fan-in edges
  // (every stage also reports its counts) would cross every node in one row,
  // so the caption says it instead
  const chain = dagToMermaid().split('\n')
    .filter(line => !/^\w+ -->\|[^|]*\| report$/.test(line) || line.startsWith('crystallize '))
    .join('\n').replace(/^flowchart TD/m, 'flowchart LR').replace(/-->\|[^|]*\|/g, '-->').replace(/\[\[([^\]]+)\]\]/g, '($1)');
  const diagram = renderMermaid(chain, { theme: 'host' });
  const embedder = createOfflineEmbedder();
  let store: MemoryStore = createMemoryUnitStore();
  let live = true;
  const app = createApp({
    $app: '0.1',
    state: { ran: false, running: false, records: [], report: null, question: '', answer: null },
    view: [{ match: '$', body: '$.ui' }],
    actions: {
      run: { patch: [{ op: 'replace', path: '/running', value: true }, { op: 'replace', path: '/records', value: [] }, { op: 'replace', path: '/answer', value: null }], effects: [{ run: 'pipeline' }] },
      record: { patch: [{ op: 'add', path: '/records/-', value: '$payload' }] },
      'run/done': { patch: [{ op: 'replace', path: '/running', value: false }, { op: 'replace', path: '/ran', value: true }, { op: 'replace', path: '/report', value: '$payload' }] },
      question: { patch: [{ op: 'replace', path: '/question', value: '$event.value' }] },
      ask: { effects: [{ run: 'recall', with: { question: '$.question' } }] },
      'ask/done': { patch: [{ op: 'replace', path: '/answer', value: '$payload' }] },
    },
  } as any, {
    node: host,
    viewModel: (state: any) => ({ ...state, ui: view(state, diagram) }),
    effects: {
      pipeline: (_: unknown, dispatch: (a: string, p?: unknown) => void) => {
        store = createMemoryUnitStore();
        void createPipeline({ store, embedder }).run(OBSERVATIONS, { onNode: (record) => { if (live) dispatch('record', record); } })
          .then((report) => { if (live) dispatch('run/done', report); });
      },
      recall: (props: any, dispatch: (a: string, p?: unknown) => void) => {
        const question = typeof props.question === 'string' && props.question !== '' ? props.question : DEFAULT_QUESTION;
        void Promise.all([store.list(), embedder.embed([question])]).then(([units, [vector]]) => {
          const { ranked } = recallByEmbedding(units, vector, { identity: { model: embedder.model, dims: embedder.dims } });
          if (live) dispatch('ask/done', { results: ranked.map(({ unit, score }: any) => ({ score: score.toFixed(3), text: unit.text, evidence: unit.evidence })) });
        });
      },
    },
    onError: (error: unknown) => console.error('[tangle-os loop]', error),
  });
  return () => { live = false; app.destroy?.(); host.remove(); };
};
