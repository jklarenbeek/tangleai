/**
 * The Tangle AI pages site — one @jarenjs/app document, and a live
 * demo that is NOT a mock: the real @tangleai/pipeline (the same
 * jaren-dag document the desktop executes) runs here in the browser
 * over the in-memory store with the built-in trigram embedder — zero
 * network, zero backend. The diagram is projected from the executable
 * document; the numbers on screen are a real run's numbers.
 */

import { createApp } from '@jarenjs/app';
import { renderMermaid } from '@jarenjs/mermaid';
import { createMemoryUnitStore, rankByEmbedding, type MemoryStore } from '@tangleai/memory';
import {
  createPipeline,
  dagToMermaid,
  trigramEmbedding,
  PIPELINE_NODES,
  type DagNodeRecord,
} from '@tangleai/pipeline';

// ---------------------------------------------------------------------------
// the demo corpus — the walking skeleton's scenario
// ---------------------------------------------------------------------------

const OBSERVATIONS = [
  { text: 'The staging database lives on host db-staging.internal port 5432', evidence: 'ops handbook §3', tags: ['ops'], at: '2026-08-20T09:00:00Z' },
  { text: 'The staging database lives on host db-staging.internal port 5432.', evidence: 'ops handbook §3 (retold)', tags: ['ops'], at: '2026-08-21T09:00:00Z' },
  { text: 'The staging database is on db-staging.internal at port 5432', evidence: 'deploy log 2026-08-22', tags: ['ops'], at: '2026-08-22T10:00:00Z' },
  { text: 'Deploys must run the full gate before shipping', evidence: 'CONTRIBUTING.md', tags: ['ops'], at: '2026-08-22T11:00:00Z' },
  { text: 'The API rate limit is 100 requests per minute', evidence: 'gateway config v1', tags: ['api'], at: '2026-08-19T08:00:00Z' },
  { text: 'The API rate limit is 500 requests per minute', evidence: 'gateway config v2', tags: ['api'], at: '2026-08-23T08:00:00Z' },
];

let store: MemoryStore = createMemoryUnitStore();

// ---------------------------------------------------------------------------
// vnode helpers
// ---------------------------------------------------------------------------

const MERMAID_TEXT = dagToMermaid();
const DAG_SVG = renderMermaid(MERMAID_TEXT, { theme: 'host' });

const STATUS_GLYPH: Record<string, string> = { ok: '✓', error: '✕' };

function nodeStrip(records: DagNodeRecord[]): any {
  const byId = new Map(records.map((r) => [r.id, r]));
  return ['div', { class: 'nodes' },
    [...PIPELINE_NODES].map((id) => {
      const record = byId.get(id);
      return ['div', { key: id, class: record ? `node ${record.status}` : 'node idle' },
        ['span', {}, id],
        record ? ['span', { class: 'node-ms' }, `${STATUS_GLYPH[record.status] ?? '·'} ${Math.round(record.ms * 100) / 100}ms`] : null];
    })];
}

function reportView(report: any): any {
  if (report === null) return null;
  return ['div', { class: 'report' },
    ['div', { class: 'stat' }, ['b', {}, String(report.observations)], ' observations in'],
    ['div', { class: 'stat' }, ['b', {}, String(report.novelty.filtered)], ' near-verbatim repeat gated'],
    ['div', { class: 'stat' }, ['b', {}, String(report.contradiction.contradictions)], ' contradiction resolved'],
    ['div', { class: 'stat' }, ['b', {}, String(report.crystallize.merged)], ' paraphrase crystallized'],
    ['div', { class: 'stat' }, ['b', {}, `${report.memories.live} live`], ` of ${report.memories.total} records — the rest is audit trail`],
  ];
}

function answerView(answer: any): any {
  if (answer === null) return null;
  return ['div', { class: 'answer' },
    answer.results.length === 0
      ? ['p', {}, 'nothing recalled — run the loop first']
      : answer.results.map((r: any, index: number) => ['div', { key: String(index), class: 'hit' },
          ['span', { class: 'score' }, r.score],
          ['span', { class: 'hit-text' }, r.text],
          ['span', { class: 'hit-evidence' }, r.evidence]]),
  ];
}

function view(state: any): any {
  return ['div', { class: 'site' },
    ['header', { class: 'hero' },
      ['div', { class: 'brand' }, ['span', { class: 'knot' }, '◉'], ' tangle ', ['span', { class: 'ai' }, 'ai']],
      ['h1', {}, 'Memory that earns its keep.'],
      ['p', { class: 'tag' },
        'Self-improving memory and retrieval for agents — novelty gating, contradiction resolution, crystallization and outcome learning, built entirely on the ',
        ['a', { href: 'https://jklarenbeek.github.io/jarenjs/' }, 'jarenjs suite'],
        '. Documents run; policies are measured before they are believed.'],
      ['nav', { class: 'links' },
        ['a', { class: 'button', href: 'https://github.com/jklarenbeek/tangleai' }, 'GitHub'],
        ['a', { class: 'button ghost', href: 'https://github.com/jklarenbeek/tangleai#readme' }, 'README']],
    ],

    ['section', { class: 'panel' },
      ['h2', {}, 'The loop is a document'],
      ['p', {}, 'The pipeline below is a ', ['code', {}, 'jaren-dag'], ' document executed by @jarenjs/flow — the diagram is projected from the SAME document the desktop app runs, not drawn beside it.'],
      ['div', { class: 'dag' }, DAG_SVG]],

    ['section', { class: 'panel demo' },
      ['h2', {}, 'Run it. Here. Now.'],
      ['p', {}, 'This button executes the real pipeline in your browser — in-memory store, deterministic trigram embedder, no network. Six observations go in: a near-verbatim repeat, a paraphrase pair, and two rate limits that cannot both be true.'],
      ['button', { class: 'button', disabled: state.running ? true : null, on: { click: 'run' } },
        state.ran ? 'run it again' : 'run the loop'],
      nodeStrip(state.records),
      reportView(state.report),
      state.ran
        ? ['div', { class: 'ask' },
            ['h3', {}, 'now ask the memory'],
            ['form', { class: 'ask-row', on: { submit: { action: 'ask', preventDefault: true } } },
              ['input', { class: 'ask-input', type: 'text', value: state.question, placeholder: 'what is the current api rate limit?', on: { input: { action: 'question', event: ['value'] } } }],
              ['button', { class: 'button', type: 'submit' }, 'recall']],
            answerView(state.answer),
            state.answer !== null && state.answer.results.length > 0
              ? ['p', { class: 'note' }, 'The superseded 100-rpm record cannot surface — contradiction resolution marked it audit trail before crystallization could average it away. That ordering is a test-pinned design rule.']
              : null]
        : null],

    ['section', { class: 'panel columns' },
      ['div', {},
        ['h3', {}, 'Evidence-mandatory'],
        ['p', {}, 'A memory without evidence is a guess; the schema refuses it at the store boundary. Every answer cites its sources by record id.']],
      ['div', {},
        ['h3', {}, 'Losses beside wins'],
        ['p', {}, 'The campaign rule, learned the hard way: no self-evolving capability ships before the instrument that can call it an improvement. LoCoMo is the fitness signal; policies that do not move the number get demoted to opt-in.']],
      ['div', {},
        ['h3', {}, 'jarenjs below, Tangle above'],
        ['p', {}, 'Contracts and seams (@jarenjs/ai, /flow, /db, /contract) below the boundary; policies and infrastructure above. A curated Tangle memory projects losslessly into an unmodified @jarenjs/ai ledger.']]],

    ['footer', { class: 'footer' },
      ['p', {}, 'MIT · rebuilt from the memflow prototype on the jarenjs suite · this page is itself a @jarenjs/app document rendered by @jarenjs/view']],
  ];
}

// ---------------------------------------------------------------------------
// the app
// ---------------------------------------------------------------------------

const app = createApp({
  $app: '0.1',
  state: {
    ran: false,
    running: false,
    records: [] as DagNodeRecord[],
    report: null as any,
    question: '',
    answer: null as any,
  },
  view: [{ match: '$', body: '$.ui' }],
  actions: {
    run: {
      patch: [
        { op: 'replace', path: '/running', value: true },
        { op: 'replace', path: '/records', value: [] },
        { op: 'replace', path: '/answer', value: null },
      ],
      effects: [{ run: 'pipeline' }],
    },
    record: { patch: [{ op: 'add', path: '/records/-', value: '$payload' }] },
    'run/done': {
      patch: [
        { op: 'replace', path: '/running', value: false },
        { op: 'replace', path: '/ran', value: true },
        { op: 'replace', path: '/report', value: '$payload' },
      ],
    },
    question: { patch: [{ op: 'replace', path: '/question', value: '$event.value' }] },
    ask: {
      effects: [{ run: 'recall', with: { question: '$.question' } }],
    },
    'ask/done': { patch: [{ op: 'replace', path: '/answer', value: '$payload' }] },
  },
}, {
  node: document.getElementById('app'),
  viewModel: (state: any) => ({ ...state, ui: view(state) }),
  effects: {
    pipeline: (_props: any, dispatch: (a: string, p?: any) => void): void => {
      store = createMemoryUnitStore(); // each run starts from an empty loom
      const pipeline = createPipeline({ store });
      void pipeline.run(OBSERVATIONS, {
        onNode: (record) => dispatch('record', record),
      }).then((report) => dispatch('run/done', report));
    },
    recall: (props: any, dispatch: (a: string, p?: any) => void): void => {
      const question = typeof props.question === 'string' && props.question !== ''
        ? props.question
        : 'what is the current api rate limit?';
      void store.list().then((units) => {
        const ranked = rankByEmbedding(units, trigramEmbedding(question), { k: 3 });
        dispatch('ask/done', {
          results: ranked.map(({ unit, score }) => ({
            score: score.toFixed(3),
            text: unit.text,
            evidence: unit.evidence,
          })),
        });
      });
    },
  },
  onError: (report: any) => console.error('[tangle-pages]', report),
});

void app; // mounted; interaction drives everything else
