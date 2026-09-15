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
  ['chat', 'Chat'], ['loom', 'Loom'], ['memory', 'Memory'], ['skills', 'Skills'], ['documents', 'Documents'],
  ['reports', 'Reports'], ['settings', 'Settings'],
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

/**
 * What was recorded against a reply. A verdict is the OPERATOR's
 * assertion and says so; the memory count is the number the projection
 * receipt answered, not a claim that anything got better.
 */
function recordedVerdict(verdict: string, reason: string | null, changed: number | null): any {
  return ['div', { class: 'feedback-recorded' },
    ['span', { class: 'verdict-recorded' }, `recorded: ${verdict}`],
    ['span', { class: 'verdict-label' }, 'your assertion about this reply'],
    reason === null || reason === '' ? null : ['span', { class: 'reason-recorded' }, reason],
    changed === null ? null : ['span', { class: 'writes-recorded' }, `${changed} memory confidences changed`],
  ];
}

/** The form a thumb opens. Nothing here submits until the bounds it publishes are met. */
function feedbackForm(feedback: any): any {
  if (feedback.receipt !== null) {
    return recordedVerdict(feedback.receipt.outcome, feedback.reason, feedback.receipt.changedMemoryWrites);
  }
  const form = feedback.form;
  if (form === null) return ['div', { class: 'feedback-form pending' }, '…'];
  if (form.submitted !== null) return recordedVerdict(form.submitted.verdict, null, null);
  if (form.eligible !== true) {
    return ['div', { class: 'feedback-form ineligible' },
      form.issues.map((issue: any) => ['span', { key: issue.code, class: 'issue' }, `${issue.code}: ${issue.detail}`])];
  }
  const reason = String(feedback.reason ?? '').trim();
  const note = String(feedback.note ?? '').trim();
  const named = feedback.refs.length + (note === '' ? 0 : 1);
  const ready = reason.length >= form.constraints.reasonMinChars
    && reason.length <= form.constraints.reasonMaxChars
    && named > 0 && named <= form.constraints.maxEvidence;
  return ['div', { class: 'feedback-form' },
    ['div', { class: 'verdicts' },
      form.verdicts.map((verdict: string) => ['button', {
        key: verdict,
        class: feedback.verdict === verdict ? 'verdict active' : 'verdict',
        on: { click: on('feedback/verdict', verdict) },
      }, verdict])],
    ['textarea', {
      class: 'feedback-reason', placeholder: 'what actually happened…', value: feedback.reason,
      on: { input: on('feedback/reason', undefined, ['value']) },
    }],
    ['div', { class: 'feedback-count' }, `${reason.length}/${form.constraints.reasonMinChars} characters`],
    form.evidence.length === 0
      ? ['div', { class: 'feedback-count' }, 'this reply cited nothing; a typed note is the evidence']
      : ['div', { class: 'feedback-evidence' },
          form.evidence.map((option: any) => ['label', { key: option.sourceId, class: 'evidence-option' },
            ['input', {
              type: 'checkbox', checked: feedback.refs.includes(option.ref) ? true : null,
              on: { change: on('feedback/toggle', option.ref) },
            }],
            ['span', {}, option.label]])],
    form.noteAllowed
      ? ['textarea', {
          class: 'feedback-note', placeholder: 'a note, if what this is about is not listed…', value: feedback.note,
          on: { input: on('feedback/note', undefined, ['value']) },
        }]
      : null,
    feedback.error === null ? null : ['div', { class: 'error' }, String(feedback.error)],
    ['div', { class: 'feedback-actions' },
      ['button', { class: 'feedback-submit', disabled: ready ? null : true, on: { click: on('feedback/submit') } }, 'record verdict'],
      ['button', { class: 'feedback-cancel', on: { click: on('feedback/close') } }, 'cancel'],
    ],
  ];
}

function message(m: any, index: number, feedback: any): any {
  const body = m.role === 'assistant' ? md.view(m.text) : ['p', {}, m.text];
  const answered = m.role === 'assistant' && m.local !== true && typeof m.id === 'string';
  return ['div', { key: m.id ?? `local-${index}`, class: `msg ${m.role}` },
    ['div', { class: 'msg-body' }, body],
    m.provider ? ['div', { class: 'msg-meta' }, `via ${m.provider}`] : null,
    answered
      ? ['div', { class: 'feedback' },
          ['button', { class: 'thumb up', title: 'this answered it', on: { click: on('feedback/open', { messageId: m.id, verdict: 'success' }) } }, '👍'],
          ['button', { class: 'thumb down', title: 'this did not', on: { click: on('feedback/open', { messageId: m.id, verdict: 'failure' }) } }, '👎'],
          feedback.messageId === m.id ? feedbackForm(feedback) : null]
      : null,
  ];
}

/**
 * What the last answer cited, as the surface can show it. The reply row
 * names the ids the answer used; a cited memory the surface already
 * holds renders with its text and evidence, and one it does not renders
 * as the address itself — a citation is never dropped for want of a
 * summary.
 */
function citedBy(state: any): any[] {
  if (state.chat.citations.length > 0) return state.chat.citations;
  const answered = [...state.chat.messages].reverse()
    .find((message: any) => message.role === 'assistant' && message.local !== true);
  const ids: string[] = answered?.citations ?? [];
  const held = new Map<string, any>(state.memory.items.map((unit: any) => [unit.id, unit]));
  return ids.map((id) => held.get(id) ?? { id, text: id, evidence: 'cited by the answer' });
}

function chatPage(state: any): any {
  const chat = state.chat;
  const citations = citedBy(state);
  const run = chat.run;
  return ['section', { class: 'page chat' },
    ['div', { class: 'messages' },
      chat.messages.length === 0
        ? ['div', { class: 'empty' },
            ['h2', {}, 'Ask your folder anything'],
            ['p', {}, 'Point Tangle at a folder in Settings, sync it on the Loom page, and chat over the curated memory. Without a model configured, answers are grounded recall — memories, cited.']]
        : chat.messages.map((m: any, index: number) => message(m, index, chat.feedback)),
      chat.busy
        ? ['div', { class: 'msg assistant pending', key: 'pending' },
            ['div', { class: 'msg-body' },
              run === null ? '…thinking'
                : `…answering${run.chars > 0 ? ` · ${run.chars} characters` : ''}${run.status === 'running' ? '' : ` · ${run.status}`}`],
            run !== null && run.degraded.length > 0
              ? ['div', { class: 'msg-meta' }, run.degraded.map((entry: any) => `degraded: ${entry.reason}`).join(' · ')]
              : null,
            run !== null && run.status === 'running'
              ? ['button', { class: 'close', on: { click: on('chat/stop', run.runId) } }, 'stop']
              : null]
        : null,
    ],
    chat.error ? ['div', { class: 'error' }, String(chat.error)] : null,
    citations.length > 0
      ? ['div', { class: 'citations' },
          ['h3', {}, 'grounded on'],
          citations.map((c: any) => ['div', { key: c.id, class: 'citation', on: { click: on('memory/select', c) } },
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

/** What a watched run's node frames say each stage did — the run's own record, not a remembered slot. */
function nodeStatuses(frames: { rows: any[] }): Record<string, { status: string, ms: number }> {
  const nodes: Record<string, { status: string, ms: number }> = {};
  for (const row of frames.rows) {
    if (row.kind !== 'node') continue;
    nodes[row.body.node] = { status: row.body.status, ms: Math.round(row.body.ms * 100) / 100 };
  }
  return nodes;
}

/**
 * What the host's watcher has observed, as numbers. Every value here is
 * read from `folder.watch.get`; nothing is summarized into a verdict,
 * and a watcher the host did not construct says so.
 */
function watchLine(watcher: any): any {
  if (watcher === null || watcher === undefined) return null;
  if (watcher.enabled !== true) {
    return ['p', { class: 'hint watch-line' }, 'This host watches no folder — sync runs when you click.'];
  }
  const scans = watcher.scans ?? { start: 0, change: 0, overflow: 0, tick: 0 };
  const where = watcher.folder === null ? 'no folder set' : String(watcher.folder);
  return ['div', { class: 'watch-line' },
    ['p', { class: 'hint' },
      `watching ${where} · ${String(watcher.mode)} · scans: ${scans.start} start, ${scans.change} change, `
      + `${scans.overflow} overflow, ${scans.tick} tick · ${watcher.overflows ?? 0} overflows`],
    watcher.lastError === null || watcher.lastError === undefined
      ? null
      : ['p', { class: 'hint error-note' }, `last watch error: ${String(watcher.lastError)}`],
    (watcher.issues ?? []).length === 0
      ? null
      : ['ul', { class: 'watch-issues' },
          (watcher.issues ?? []).map((issue: any) => ['li', {}, `${String(issue.code)} ${String(issue.detail)}`])],
  ];
}

/**
 * What configuration a run resolved: how it was asked for, which chat
 * role answered, and which embedding identity its vectors carry. A row
 * from before identities were recorded says that, rather than nothing.
 */
function runIdentity(detail: any): any {
  const identity = detail.identity ?? null;
  if (identity === null) {
    return ['p', { class: 'hint' }, detail.run.identityStatus === 'legacy-unrecorded'
      ? 'no configuration identity was recorded for this run'
      : 'the configuration identity this run names is not stored'];
  }
  const requested = identity.requested ?? {};
  const asked = requested.kind === 'profile' ? `profile ${String(requested.profile)}`
    : requested.kind === 'tag' ? `tag ${String(requested.tag)}`
    : 'settings projection';
  const chat = identity.roles?.chat;
  return ['p', { class: 'hint run-identity' },
    `requested ${String(requested.kind)} · ${asked}`
    + ` · identity ${String(identity.identityId).slice(0, 12)}…`
    + (chat === undefined ? ' · no chat wire' : ` · chat ${chat.provider}/${chat.model}`)
    + (identity.embedding === null ? ' · no embedding identity' : ` · embeddings ${identity.embedding.provider}/${identity.embedding.model} @ ${identity.embedding.dims}`)];
}

function loomPage(state: any): any {
  const loom = state.loom;
  const watched = loom.runs.rows.find((row: any) => row.id === loom.watch) ?? null;
  const running = watched?.status === 'running';
  const nodeIds = ['document', 'documents'].includes(watched?.kind)
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
    loom.syncNote ? ['p', { class: 'hint sync-note' }, String(loom.syncNote)] : null,
    ['div', { class: 'dag-panel' },
      ['div', { class: 'dag-svg' }, mermaidSvg(loom.mermaid)],
      // the frames slot is addressed: a picture is only ever drawn from
      // the run it belongs to
      nodeStrip(nodeIds, nodeStatuses(loom.frames.runId === loom.watch ? loom.frames : { rows: [] }), running),
      watchLine(loom.watcher),
    ],
    memoryGrowthChart(loom.runs.rows),
    stageChart(loom.detail),
    ['div', { class: 'runs-panel' },
      ['h3', {}, 'run history'],
      loom.runs.rows.length === 0
        ? ['p', { class: 'hint' }, 'No runs yet — set a folder in Settings and sync.']
        : ['table', { class: 'runs' },
            ['tbody', {}, loom.runs.rows.map((r: any) => runRow(r, loom.detail?.run?.id === r.id))]],
      loom.detail
        ? ['div', { class: 'run-detail' },
            ['div', { class: 'detail-head' },
              ['h4', {}, loom.detail.run.id],
              ['button', { class: 'close', on: { click: on('run/close') } }, '×']],
            runIdentity(loom.detail),
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

// -- skills ----------------------------------------------------------------

/**
 * What a skill-evolution run did, read from stored rows. Nothing here claims
 * an improvement: the only numbers it shows are the evaluation's own, and
 * every write — evolving, activating, rolling back — stays a host action.
 */
function skillsPage(state: any): any {
  const skills = state.skills;
  const detail = skills.detail;
  const evaluation = skills.evaluation;
  const candidate = skills.candidate?.candidate;
  const merges = skills.merges;
  return ['section', { class: 'page skills' },
    ['div', { class: 'group' },
      ['h3', {}, 'Skill directories'],
      ['button', { class: 'tab', on: { click: on('skills/refresh') } }, 'refresh'],
      skills.error ? ['div', { class: 'error' }, String(skills.error)] : null,
      skills.runs.length === 0
        ? ['p', { class: 'empty skills-empty' }, 'No evolution run is stored. A run is driven outside this surface; this page shows what one did.']
        : ['table', { class: 'skill-runs' },
            ['tbody', {}, skills.runs.map((run: any) => ['tr', {
              key: run.id, class: 'skill-run', on: { click: on('skills/select', run.id) },
            },
              ['td', {}, String(run.scopeKey)],
              ['td', {}, String(run.mode)],
              ['td', {}, String(run.status)],
              ['td', { class: 'addr' }, String(run.id).slice(0, 12)],
            ])]],
    ],
    detail === null ? null : ['div', { class: 'group skill-detail' },
      ['h3', {}, `run ${String(detail.run.id).slice(0, 12)}`],
      ['button', { class: 'tab', on: { click: on('skills/close') } }, 'close'],
      ['p', { class: 'skill-counts' },
        `${detail.counts.rollouts} rollouts · ${detail.counts.analyses} analyses · ${detail.counts.patches} patches `
        + `· ${detail.counts.merges} merges · ${detail.counts.candidates} candidates · ${detail.counts.evaluations} evaluations`],
      merges === null ? null : ['div', { class: 'skill-merges' },
        ['h4', {}, `merge tree — ${merges.levels} level(s), ${merges.groups} group(s), ${merges.withheld} withheld`],
        ['table', {}, ['tbody', {}, merges.nodes.map((node: any) => ['tr', { key: node.id, class: 'merge-node' },
          ['td', {}, `L${node.level}G${node.groupIndex}`],
          ['td', {}, `${node.inputPatchIds.length} in`],
          ['td', {}, `${node.unique} unique`],
          ['td', {}, `${node.withheld} withheld`],
          ['td', { class: 'addr' }, String(node.outputPatchId ?? '—').slice(0, 12)],
        ])]]],
      candidate === undefined || candidate === null ? null : ['div', { class: 'skill-candidate' },
        ['h4', {}, `candidate ${String(candidate.id).slice(0, 12)}`],
        ['p', { class: 'skill-diff' },
          `directory ${String(candidate.bundleId).slice(0, 12)} · +${candidate.diffSummary.filesAdded} file(s), `
          + `${candidate.diffSummary.filesChanged} changed, +${candidate.diffSummary.linesAdded} −${candidate.diffSummary.linesRemoved} line(s)`],
        ['p', {}, `structural ${candidate.structural.valid ? 'valid' : 'refused'} · semantic ${candidate.semantic.valid ? 'valid' : 'refused'}`],
        ['ul', { class: 'skill-files' }, (skills.candidate.files ?? []).map((file: any) =>
          ['li', { key: file.path }, `${file.path} · ${file.size} bytes`])]],
      evaluation === null ? null : ['div', { class: 'skill-evaluation' },
        ['h4', {}, `held-out evaluation ${String(evaluation.id).slice(0, 12)}`],
        ['p', { class: 'skill-verdict' },
          `mean delta ${evaluation.meanDelta.toFixed(3)} · eligible ${String(evaluation.eligible)} `
          + `· ${evaluation.failures} failed · ${evaluation.skips} skipped · ${evaluation.leakage} leakage`],
        ['table', {}, ['tbody', {}, evaluation.results.map((row: any) => ['tr', {
          key: row.taskId,
          class: row.candidateScore < row.baselineScore ? 'held-out regression' : 'held-out',
        },
          ['td', {}, row.taskId],
          ['td', {}, row.baselineScore.toFixed(3)],
          ['td', {}, row.candidateScore.toFixed(3)],
          ['td', {}, (row.candidateScore - row.baselineScore).toFixed(3)],
        ])]],
        evaluation.issues.length === 0 ? null
          : ['ul', { class: 'skill-clauses' }, evaluation.issues.map((issue: any, index: number) =>
              ['li', { key: `${issue.code}-${index}` }, `${issue.code} ${issue.path}: ${issue.detail}`])]],
      skills.head === null ? null : ['p', { class: 'skill-head' },
        `active head ${String(skills.head.versionId ?? 'none').slice(0, 12)} at revision ${skills.head.revision}`],
    ],
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

// -- reports ----------------------------------------------------------------

/**
 * What a running report is saying, read from the frames the run window
 * is already subscribed to. No second stream exists for this page: a
 * report is a run, and a run's frames have one address.
 */
function reportProgress(state: any): any {
  const frames = state.loom.frames;
  const watched = state.loom.runs.rows.find((row: any) => row.id === frames.runId) ?? null;
  if (watched === null || watched.kind !== 'report') return null;
  const lines = frames.rows
    .filter((row: any) => row.kind === 'progress')
    .flatMap((row: any) => (row.body.lines ?? []).map((line: string) => String(line)));
  const dropped = frames.rows
    .filter((row: any) => row.kind === 'progress')
    .reduce((total: number, row: any) => total + Number(row.body.suppressed ?? 0), 0);
  if (lines.length === 0 && watched.status !== 'running') return null;
  return ['div', { class: 'report-progress' },
    ['h3', {}, `${String(watched.id)} · ${String(watched.status)}`],
    ['pre', { class: 'report-lines' }, lines.slice(-40).join('\n')],
    dropped === 0 ? null : ['p', { class: 'hint' }, `${dropped} further lines were not kept`],
  ];
}

/** A stored report, as a row: identity, where it came from, how big it is. */
function reportRow(row: any, selected: boolean, comparable: boolean): any {
  return ['tr', {
    key: row.reportId,
    class: selected ? 'selected' : null,
    on: { click: on('reports/open', row.reportId) },
  },
    ['td', { class: 'mono' }, String(row.reportId).slice(0, 12)],
    ['td', {}, String(row.instrument)],
    ['td', { class: 'mono' }, String(row.bytes)],
    ['td', { class: 'mono' }, String(row.at)],
    ['td', { class: 'hint' }, comparable ? 'comparable' : ''],
  ];
}

function reportsPage(state: any): any {
  const reports = state.reports;
  const chosen = reports.detail;
  const comparableTo = (row: any): boolean => chosen !== null
    && chosen.reportId !== row.reportId
    && chosen.instrument === row.instrument
    && chosen.schemaId === row.schemaId;
  return ['section', { class: 'page reports' },
    ['div', { class: 'reports-head' },
      ['h2', {}, 'Reports'],
      ['p', { class: 'hint' },
        'An instrument\u2019s numbers are that instrument\u2019s claim. Two reports are comparable when their instrument and schema agree \u2014 nothing here says one is better.'],
    ],
    reports.error ? ['div', { class: 'error' }, String(reports.error)] : null,
    (reports.issues ?? []).length === 0
      ? null
      : ['ul', { class: 'report-issues' },
          reports.issues.map((issue: any) => ['li', { key: issue.code + issue.path }, `${String(issue.code)} ${String(issue.detail)}`])],
    reports.instruments.length === 0
      ? ['p', { class: 'hint' }, 'This build registers no instrument.']
      : ['ul', { class: 'instruments' },
          reports.instruments.map((entry: any) => ['li', { key: entry.id },
            ['div', { class: 'instrument-name' }, String(entry.title)],
            ['div', { class: 'hint mono' }, `${String(entry.entry)} \u00b7 ${String(entry.schemaId)}`],
            ['button', {
              class: 'send', disabled: reports.busy ? true : null,
              on: { click: on('reports/run', entry.id) },
            }, reports.busy ? 'running\u2026' : 'run'],
          ])],
    reports.receipt
      ? ['p', { class: 'hint receipt' },
          `run ${String(reports.runId)} \u00b7 ${String(reports.receipt.stored)} \u00b7 exit ${String(reports.receipt.exitCode)}`
          + (reports.receipt.reportId === null ? '' : ` \u00b7 ${String(reports.receipt.reportId).slice(0, 12)}`)]
      : null,
    reportProgress(state),
    ['div', { class: 'stored-reports' },
      ['h3', {}, 'stored reports'],
      reports.rows.length === 0
        ? ['p', { class: 'hint' }, 'No report has been kept yet.']
        : ['table', { class: 'runs' },
            ['tbody', {}, reports.rows.map((row: any) => reportRow(row, chosen?.reportId === row.reportId, comparableTo(row)))]],
      chosen
        ? ['div', { class: 'run-detail' },
            ['div', { class: 'detail-head' },
              ['h4', {}, String(chosen.reportId)],
              ['button', { class: 'close', on: { click: on('reports/close') } }, '\u00d7']],
            ['p', { class: 'hint' },
              `${String(chosen.instrument)} \u00b7 ${String(chosen.schemaId)} \u00b7 run ${String(chosen.runId)} \u00b7 `
              + (chosen.verified === true
                ? 'identity verified against the stored bytes'
                : `identity DOES NOT match the stored bytes \u2014 they hash to ${String(chosen.recomputed).slice(0, 12)}`)],
            ['pre', { class: 'report-document' }, JSON.stringify(chosen.document, null, 2)]]
        : null,
    ],
  ];
}

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

/** Resolver issues, verbatim: the code to look up, the path to fix, the reason. */
function issueList(issues: any[]): any {
  return issues.length === 0 ? null : ['ul', { class: 'hint issues' }, issues.map((issue: any) =>
    ['li', { key: `${issue.code}${issue.path}` }, `${issue.code} ${issue.path} — ${issue.detail}`])];
}

/**
 * The profile selector and what the selection resolves to right now.
 *
 * The registry's own stated limitations are rendered beside it verbatim:
 * its tag orderings are operator-declared and nothing here has measured
 * that one profile answers better than another.
 */
function profileGroup(state: any): any {
  const inspect = state.settings.inspect;
  const draft = state.settings.draft;
  if (inspect === null || inspect === undefined || draft === null) return null;
  const profiles: any[] = inspect.registry.profiles ?? [];
  const preview = state.settings.preview;
  const selected = draft.profile ?? null;
  const described = profiles.find((entry: any) => entry.id === selected) ?? null;
  // a stored name the registry no longer declares stays VISIBLE and stays
  // selected: showing "(none)" would say the host is projecting its settings
  // while the resolver is refusing that name
  const stale = selected !== null && described === null;
  return ['div', { class: 'group profile' },
    ['h3', {}, 'Profile'],
    select('registry profile', 'settings/profile', selected,
      [null, ...profiles.map((entry: any) => String(entry.id)), ...(stale ? [String(selected)] : [])]),
    stale
      ? ['p', { class: 'error-inline' }, `'${String(selected)}' names no profile in this registry — pick one below or clear the selection.`]
      : described === null
        ? ['p', { class: 'hint' }, 'No profile selected — the wire settings below are projected into the request.']
        : ['p', { class: 'hint' }, String(described.description ?? '')],
    preview === null || preview === undefined ? null : ['div', { class: 'preview' },
      ['p', { class: preview.state === 'ready' ? 'saved' : preview.state === 'provisional' ? 'hint' : 'error-inline' },
        `${String(preview.profile)} — ${preview.state === 'ready' ? 'resolves' : preview.state === 'provisional' ? 'provisional' : 'refused; fix the items below, then save'}`],
      issueList(preview.issues ?? []),
      preview.identity === null || preview.identity === undefined ? null : ['p', { class: 'hint' },
        `identity ${String(preview.identity.identityId).slice(0, 12)}…`
        + (preview.identity.roles.chat !== undefined ? ` · chat ${preview.identity.roles.chat.provider}/${preview.identity.roles.chat.model}` : ' · no chat wire')
        + (preview.identity.embedding !== null ? ` · embeddings ${preview.identity.embedding.model} @ ${preview.identity.embedding.dims}` : '')]],
    ['ul', { class: 'hint limitations' }, (inspect.registry.tags ?? []).map((tag: any) =>
      ['li', { key: String(tag.tag) }, `${String(tag.tag)} — ${String(tag.limitations)}`])],
  ];
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
    issueList(resolution.issues),
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
    profileGroup(state),
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
      ['p', { class: 'hint' }, '`builtin` is @tangleai/models\'s deterministic hash-trigram embedder — lexical, demo-grade, zero setup. Configure a real model for semantic recall; memories synced under one embedder are only ever ranked by that embedder.']],
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
    : state.page === 'skills' ? skillsPage(state)
    : state.page === 'documents' ? documentPage(state)
    : state.page === 'reports' ? reportsPage(state)
    : settingsPage(state);
  return ['div', { class: 'shell' }, header(state), page];
}
