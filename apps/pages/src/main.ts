/**
 * The Tangle AI pages site — one @jarenjs/app document, and a live
 * demo that is NOT a mock: the real @tangleai/pipeline (the same
 * jaren-dag document the desktop executes) runs here in the browser
 * over the in-memory store with @tangleai/models's built-in hash embedder —
 * zero network, zero backend. The diagram is projected from the executable
 * document; the numbers on screen are a real run's numbers.
 */

import integration from '../../../benchmark/results/jaren-integration.json' with { type: 'json' };
import manifest from '../package.json' with { type: 'json' };
import release from '../../../release.config.json' with { type: 'json' };
import { bootDemos } from './demos/browser.ts';

import { createApp } from '@jarenjs/app';
import { renderMermaid } from '@jarenjs/mermaid';
import { DEFAULT_MEMORY_POLICY, POLICY_PROVENANCE, createMemoryUnitStore, recallByEmbedding, type MemoryStore } from '@tangleai/memory';
import {
  createOfflineEmbedder,
  createPipeline,
  dagToMermaid,
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
const embedder = createOfflineEmbedder();
const strategyLabels: Record<string, string> = {
  'long-context': 'Full conversation', 'near-raw': 'Raw dialogue',
  'rag-observation': 'Observations', 'rag-summary': 'Session summaries',
  'long-horizon': 'Bounded agent', near: 'Historical Tangle',
};

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
        ['a', { href: 'https://jklarenbeek.github.io/jarenjs/' }, `jarenjs ${manifest.dependencies['@jarenjs/app']}`],
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
      ['p', { 'data-policy-cell': POLICY_PROVENANCE.cellId }, `Selected default: novelty ${DEFAULT_MEMORY_POLICY.novelty.enabled ? 'on' : 'off'}, contradiction ${DEFAULT_MEMORY_POLICY.contradiction.enabled ? 'on' : 'off'}, crystallization ${DEFAULT_MEMORY_POLICY.crystallization.enabled ? 'on' : 'off'}. Local matching uses ${DEFAULT_MEMORY_POLICY.embedding.dims} hash dimensions.`],
      ['p', {}, 'This button executes the real pipeline in your browser — in-memory store, @tangleai/models\'s deterministic hash embedder, no network. Six observations go in: a near-verbatim repeat, a paraphrase pair, and two rate limits that cannot both be true.'],
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
              ? ['p', { class: 'note' }, state.report.contradiction.contradictions > 0 ? 'The resolved older record is retained as audit trail and excluded from recall.' : 'These are retrieved observations. With contradiction resolution off, conflicting records can both appear; matching text alone does not establish which statement is current.']
              : null]
        : null],

    ['section', { class: 'panel integration', 'data-jaren-version': manifest.dependencies['@jarenjs/app'], 'data-tangle-version': manifest.version },
      ['h2', {}, `Tangle ${manifest.version} · JarenJS ${manifest.dependencies['@jarenjs/app']}`],
      ['p', {}, `${release.packages.length} coordinated packages with JavaScript and TypeScript declarations. `, ['a', { href: 'https://github.com/jklarenbeek/tangleai/blob/main/CHANGELOG.md' }, 'Release notes']],
      ['p', {}, 'Verified workflow checkpoints, lease-aware jobs, atomic agent memory and scheduled document fetching run on the suite. Provider token limits are part of each run’s configuration identity.'],
      ['p', { class: 'note' }, `History measurements use JarenJS ${integration.jaren}, measured ${integration.measuredAt}. Historical paid answers are dated ${integration.paid.qa.at.slice(0, 10)} and retain their original execution identities.`],
      ['div', { class: 'report' },
        ['div', { class: 'stat' }, ['b', {}, `${integration.mas.integrated.runtimePass}/11`], ' workflow oracles'],
        ['div', { class: 'stat' }, ['b', {}, `${integration.mas.durability.passed}/${integration.mas.durability.total}`], ' durability checks'],
        ['div', { class: 'stat' }, ['b', {}, `${integration.config.byStatus.holds}/${integration.config.cases}`], ' configuration cases']],
      ['h3', {}, 'Less history loaded, same results'],
      ['p', {}, 'An ordered database cursor returns the same 50 runs while loading 50 records into the host instead of 5,000. These are warm, synthetic SQLite measurements; the database may still scan and sort the history.'],
      ['div', { class: 'benchmark-table history-table' }, ['table', {},
        ['thead', {}, ['tr', {}, ['th', {}, 'Runtime'], ['th', {}, 'Previous p95'], ['th', {}, 'Cursor p95'], ['th', {}, 'Speedup']]],
        ['tbody', {}, integration.history.map((row) => ['tr', { key: row.runtime },
          ['td', {}, `${row.runtime} ${row.version}`], ['td', {}, `${row.previousP95Ms.toFixed(2)} ms`],
          ['td', {}, `${row.boundedP95Ms.toFixed(2)} ms`], ['td', {}, `${row.p95Speedup.toFixed(2)}×`]])]]],
      ['p', {}, 'Exact vector search remains the default: upstream’s labelled BGE-M3 comparison did not find a projection strategy that met both recall and speed requirements. The keyless LoCoMo recall loss remains published; this upgrade is not a claim of better model answers.'],
      ['h3', {}, 'Dated answer measurements'],
      ['p', {}, `Historical answer measurement: ${integration.paid.model} with ${integration.paid.embedder.model}. Each direct-answer row uses the same 64 questions; the bounded agent uses 12. F1 measures answer overlap and recall measures how much gold evidence reached the model.`],
      ['div', { class: 'benchmark-table paid-table' }, ['table', {},
        ['thead', {}, ['tr', {}, ['th', {}, 'Strategy'], ['th', {}, 'Valid replies'], ['th', {}, 'F1'], ['th', {}, 'Recall']]],
        ['tbody', {}, integration.paid.qa.rows.map((row) => ['tr', { key: row.key },
          ['td', {}, strategyLabels[row.key] ?? row.key],
          ['td', {}, row.key === 'long-horizon' ? `${integration.bounded.current.valid}/${integration.bounded.current.planned}` : `${row.answered - row.invalid}/${row.planned}`],
          ['td', {}, (row.key === 'long-horizon' ? integration.bounded.current.f1 : row.f1)?.toFixed(3) ?? '—'],
          ['td', {}, (row.key === 'long-horizon' ? integration.bounded.current.recall : row.ceiling)?.toFixed(3) ?? '—']])]]],
      ['p', { class: 'note', 'data-bounded-policy': integration.bounded.policy },
        `Bounded agent remeasured ${integration.bounded.at.slice(0, 10)}: ${integration.bounded.current.valid} nonempty cited answers, `
        + `${integration.bounded.current.abstained} abstentions and ${integration.bounded.current.invalid} invalid results. `
        + `The earlier attempt produced ${integration.bounded.baseline.valid} usable answers; its one completed program returned empty text. `
        + `The repair covers the corpus within the same call cap; ${integration.bounded.current.subcalls.failed} chunk request failed. `
        + 'Valid citations do not guarantee a correct answer.'],
      ['p', { class: 'note' }, 'These historical answer measurements use different coverage for the agent. They do not establish current-stack answer quality or isolate an upgrade effect. Full reports include failures, adversarial judgments, grounding, citation outcomes and cost.'],
      ['nav', { class: 'links' },
        ['a', { href: 'https://github.com/jklarenbeek/tangleai/blob/main/docs/BOUNDED_AGENT_BENCHMARK.md' }, 'Bounded-agent repair and comparison'],
        ['a', { href: 'https://github.com/jklarenbeek/tangleai/blob/main/docs/PAID_REFRESH.md' }, 'Paid checks and limitations'],
        ['a', { href: 'https://github.com/jklarenbeek/tangleai/blob/main/docs/JARENJS_INTEGRATION.md' }, 'Integration audit'],
        ['a', { href: 'https://github.com/jklarenbeek/tangleai/blob/main/docs/JARENJS_BENCHMARK.md' }, 'Methods and raw results'],
        ['a', { href: 'https://github.com/jklarenbeek/tangleai/blob/main/docs/LOCOMO_RECALL.md' }, 'Retrieval wins and losses']]],

    ['section', { class: 'panel columns' },
      ['div', {},
        ['h3', {}, 'Evidence-mandatory'],
        ['p', {}, 'A memory without evidence is a guess; the schema refuses it at the store boundary. Every answer cites its sources by record id.']],
      ['div', {},
        ['h3', {}, 'Losses beside wins'],
        ['p', {}, 'The campaign rule, learned the hard way: no self-evolving capability ships before the instrument that can call it an improvement. LoCoMo is the fitness signal; policies that do not move the number get demoted to opt-in.']],
      ['div', {},
        ['h3', {}, 'jarenjs below, Tangle above'],
        ['p', {}, 'Jaren supplies the app, workflow, database and contract engines. Tangle adds models, context, agents and measured policies. A curated Tangle memory projects its evidence and embedding fields into the @tangleai/context ledger.']]],

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
      const pipeline = createPipeline({ store, embedder });
      void pipeline.run(OBSERVATIONS, {
        onNode: (record) => dispatch('record', record),
      }).then((report) => dispatch('run/done', report));
    },
    recall: (props: any, dispatch: (a: string, p?: any) => void): void => {
      const question = typeof props.question === 'string' && props.question !== ''
        ? props.question
        : 'what is the current api rate limit?';
      void Promise.all([store.list(), embedder.embed([question])]).then(([units, [vector]]) => {
        const identity = { model: embedder.model, dims: embedder.dims };
        const { ranked } = recallByEmbedding(units, vector, { identity });
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
bootDemos(window);
