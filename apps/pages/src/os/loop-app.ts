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

const LABELS: Record<string, string> = {
  'long-context': 'Full conversation', 'near-raw': 'Raw dialogue', 'rag-observation': 'Observations',
  'rag-summary': 'Session summaries', 'long-horizon': 'Bounded agent', near: 'Historical Tangle',
};

function nodes(records: DagNodeRecord[]): any {
  const byId = new Map(records.map(r => [r.id, r]));
  return ['ol', { class: 'loop-nodes', 'aria-label': 'Pipeline steps' }, [...PIPELINE_NODES].map((id) => {
    const record = byId.get(id);
    return ['li', { key: id, class: `loop-node ${record ? record.status : 'idle'}` },
      ['span', { class: 'loop-node-name' }, id],
      record ? ['span', { class: 'loop-node-ms' }, `${Math.round(record.ms * 100) / 100} ms`] : null];
  })];
}

function view(state: any, diagram: any): any {
  const r = state.report;
  return ['div', { class: 'loop' },
    ['header', { class: 'loop-head' },
      ['h1', {}, 'The memory loop'],
      ['p', {}, 'Six observations go in: a repeat, a paraphrase, and two rate limits that cannot both be true. The loop keeps what is new, merges what is the same, and resolves what conflicts, with evidence on every record.']],
    ['figure', { class: 'loop-diagram' }, diagram, ['figcaption', {}, 'Drawn from the same jaren-dag document the pipeline executes; every stage also writes its counts to the report.']],
    ['section', { class: 'loop-run' },
      ['button', { type: 'button', class: 'primary', disabled: state.running ? true : null, on: { click: 'run' } }, state.ran ? 'Run it again' : 'Run the loop'],
      ['p', { class: 'loop-policy' }, `Novelty ${DEFAULT_MEMORY_POLICY.novelty.enabled ? 'on' : 'off'}, contradiction ${DEFAULT_MEMORY_POLICY.contradiction.enabled ? 'on' : 'off'}, crystallization ${DEFAULT_MEMORY_POLICY.crystallization.enabled ? 'on' : 'off'}; ${DEFAULT_MEMORY_POLICY.embedding.dims}-dimension hash matching in this browser.`],
      nodes(state.records),
      r ? ['dl', { class: 'loop-report' },
        ['div', {}, ['dt', {}, 'Observations'], ['dd', {}, String(r.observations)]],
        ['div', {}, ['dt', {}, 'Repeats gated'], ['dd', {}, String(r.novelty.filtered)]],
        ['div', {}, ['dt', {}, 'Contradictions resolved'], ['dd', {}, String(r.contradiction.contradictions)]],
        ['div', {}, ['dt', {}, 'Paraphrases merged'], ['dd', {}, String(r.crystallize.merged)]],
        ['div', {}, ['dt', {}, 'Live records'], ['dd', {}, `${r.memories.live} of ${r.memories.total}`]]] : null],
    state.ran ? ['section', { class: 'loop-ask' },
      ['h2', {}, 'Ask the memory'],
      ['form', { on: { submit: { action: 'ask', preventDefault: true } } },
        ['input', { type: 'text', value: state.question, placeholder: 'What is the current API rate limit?', 'aria-label': 'Question', on: { input: { action: 'question', event: ['value'] } } }],
        ['button', { type: 'submit', class: 'primary' }, 'Recall']],
      state.answer ? (state.answer.results.length === 0 ? ['p', { class: 'loop-empty' }, 'Nothing recalled. Run the loop first.']
        : ['ul', { class: 'loop-hits' }, state.answer.results.map((hit: any, i: number) => ['li', { key: String(i) },
          ['span', { class: 'loop-score' }, hit.score], ['span', { class: 'loop-text' }, hit.text], ['span', { class: 'loop-evidence' }, hit.evidence]])]) : null] : null,
    ['section', { class: 'loop-measured' },
      ['h2', {}, 'Measured, losses included'],
      ['p', {}, `History measured on JarenJS ${integration.jaren}, ${integration.measuredAt}. An ordered cursor returns the same 50 runs while loading 50 records instead of 5,000.`],
      ['table', {},
        ['thead', {}, ['tr', {}, ['th', {}, 'Runtime'], ['th', {}, 'Before, p95'], ['th', {}, 'Cursor, p95'], ['th', {}, 'Faster']]],
        ['tbody', {}, integration.history.map((row: any) => ['tr', { key: row.runtime },
          ['td', {}, `${row.runtime} ${row.version}`], ['td', {}, `${row.previousP95Ms.toFixed(2)} ms`], ['td', {}, `${row.boundedP95Ms.toFixed(2)} ms`], ['td', {}, `${row.p95Speedup.toFixed(2)}×`]])]],
      ['p', {}, `Dated answer measurements with ${integration.paid.model}: F1 is answer overlap, recall is how much gold evidence reached the model.`],
      ['table', {},
        ['thead', {}, ['tr', {}, ['th', {}, 'Strategy'], ['th', {}, 'Valid replies'], ['th', {}, 'F1'], ['th', {}, 'Recall']]],
        ['tbody', {}, integration.paid.qa.rows.map((row: any) => ['tr', { key: row.key },
          ['td', {}, LABELS[row.key] ?? row.key],
          ['td', {}, row.key === 'long-horizon' ? `${integration.bounded.current.valid}/${integration.bounded.current.planned}` : `${row.answered - row.invalid}/${row.planned}`],
          ['td', {}, (row.key === 'long-horizon' ? integration.bounded.current.f1 : row.f1)?.toFixed(3) ?? '—'],
          ['td', {}, (row.key === 'long-horizon' ? integration.bounded.current.recall : row.ceiling)?.toFixed(3) ?? '—']])]],
      ['p', { class: 'loop-note' }, 'These are historical measurements with different coverage per strategy; they do not establish current answer quality. ',
        ['a', { href: 'https://github.com/jklarenbeek/tangleai/blob/main/docs/JARENJS_BENCHMARK.md', target: '_blank', rel: 'noopener' }, 'Methods and raw results']]],
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
        const question = typeof props.question === 'string' && props.question !== '' ? props.question : 'What is the current API rate limit?';
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
