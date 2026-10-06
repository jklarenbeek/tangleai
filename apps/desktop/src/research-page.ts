/** A view of recorded research, with no local scoring, comparison or polling. */
const action = (name: string, value?: string) => value === undefined ? name : { action: name, with: value };
const button = (label: string, name: string, value?: string) => ['button', { on: { click: action(name, value) } }, label];
const code = (value: unknown) => ['code', {}, String(value ?? 'unrecorded')];
const table = (head: string[], rows: any[][], className = '') => ['table', { class: className },
  ['thead', {}, ['tr', {}, head.map(label => ['th', {}, label])]], ['tbody', {}, rows.map((row, i) => ['tr', { key: i }, row.map(value => ['td', {}, value])])]];
const cost = (value: any) => `${value.calls} calls · ${value.tokens} tokens · ${value.physical} executions · ${value.ms} ms`;
const records = (title: string, rows: any[], cells: (row: any) => any[], headings: string[]) => ['section', {}, ['h3', {}, title],
  rows.length ? table(headings, rows.map(cells)) : ['p', { class: 'empty' }, 'No retained records.']];
const provenance = (rows: any[]) => ['details', { class: 'research-provenance' }, ['summary', {}, 'Record and report references'],
  table(['Field', 'Record', 'Path'], rows.map(row => [row.field, code(row.recordId), code(row.path)]))];

export function researchPage(state: any, renderLineage: (source: string) => any): any {
  const research = state.research, detail = research.detail, report = research.report;
  return ['section', { class: 'page research' },
    ['div', { class: 'section-head' }, ['h2', {}, 'Research'], button('refresh', 'research/refresh')],
    research.error ? ['p', { class: 'error-inline' }, research.error] : null,
    ['p', {}, 'Stored runs and committed measurements. Eligibility is shown as recorded by the instrument.'],
    research.runs.length ? table(['Project', 'Profile', 'State', 'Stage', 'Spend', 'Identity', 'Lesson set'], research.runs.map((row: any) =>
      [button(row.projectId, 'research/select', row.projectId), row.profileId, row.status, row.stage, cost(row.spend), row.identityStatus, code(row.lessonSetHash)]), 'research-runs')
      : ['p', { class: 'empty research-empty' }, 'No research runs are stored.'],
    detail ? ['section', { class: 'research-detail' },
      ['div', { class: 'section-head' }, ['h3', {}, detail.project.question], button('close run', 'research/close')],
      ['p', {}, code(detail.project.id), ' · ', detail.project.domainProfile, ' · ', detail.project.mode, ' · ', cost(detail.spend)],
      ['h3', {}, 'Retained lineage'], ['div', { class: 'dag-svg research-lineage' }, renderLineage(detail.mermaid)],
      records('States', detail.states, row => [row.revision, row.status, code(row.contractHash), code(row.planHash)], ['Revision', 'State', 'Contract', 'Plan']),
      records('Attempts', detail.attempts, row => [code(row.attempt.id), row.attempt.stage, row.attempt.stopReason, cost(row.attempt.spend)], ['Record', 'Stage', 'Stop reason', 'Spend']),
      records('Artifacts', detail.artifacts, row => [code(row.id), code(row.artifact.id), row.artifact.verification, row.parents.map((parent: any) => code(parent.admissionId ?? parent.artifactId))], ['Admission', 'Artifact', 'Verification', 'Parents']),
      records('Branches', detail.branches, row => [code(row.id), ['pre', {}, JSON.stringify(row, null, 2)]], ['Record', 'Retained branch']),
      records('Gate and intervention timeline', detail.interventions, row => [code(row.id), row.gate, row.actor, row.action, row.substantive ? 'substantive guidance' : 'non-substantive', code(row.reviewedManifestHash)],
        ['Record', 'Gate', 'Actor', 'Action', 'Classification', 'Reviewed manifest']),
      records('Claims', detail.claims, row => [code(row.id), row.text, detail.verification.flatMap((verified: any) => verified.claims.filter((check: any) => check.claimId === row.id).map((check: any) => `${check.status} (${verified.id})`)).join('; ') || 'unrecorded', row.observationIds.map(code), row.evidenceIds.map(code)], ['Record', 'Claim', 'Support', 'Observations', 'Evidence']),
      records('Verification failures', detail.verificationFailures, row => [code(row.id), row.state, row.issues.map((issue: any) => `${issue.code} ${issue.path}: ${issue.detail}`).join('\n')], ['Record', 'State', 'Issues']),
      records('Injected lessons', detail.lessons.injected, row => [code(row.id), code(row.lessonSetHash), code(row.activationEventId)], ['Record', 'Lesson set', 'Activation']),
      records('Proposed lessons', detail.lessons.proposed, row => [button(row.id, 'research/lessonSelect', row.id), row.validation.state, row.origin.kind], ['Record', 'Validation', 'Origin']),
      ['h3', {}, 'Reproduction'], ...detail.reproduce.map((command: string) => ['pre', { class: 'research-command' }, command]),
      records('Recorded execution inputs', detail.execution, row => [code(row.id), row.entrypoint ?? row.programId, row.seed, ['pre', {}, JSON.stringify(row.params, null, 2)]], ['Record', 'Entrypoint / program', 'Seed', 'Parameters']),
      ...detail.limitations.map((line: string) => ['p', { class: 'note' }, line]),
      records('Run frames', research.frames, row => [row.seq, row.kind, ['pre', {}, JSON.stringify(row.body)]], ['Sequence', 'Kind', 'Stored frame']),
      provenance(detail.provenance),
    ] : null,
    records('Lessons', research.lessons, row => [button(row.lesson.id, 'research/lessonSelect', row.lesson.id), row.lesson.validation.state,
      row.lesson.origin.kind, row.lesson.corroboration === null ? 'absent' : 'recorded', code(row.lesson.promotion?.activationEventId)], ['Record', 'Validation', 'Origin', 'Corroboration', 'Promotion event']),
    research.lesson ? ['section', { class: 'research-lesson' }, ['h3', {}, 'Retained lesson'], code(research.lesson.lesson.id),
      ['pre', {}, JSON.stringify(research.lesson.lesson, null, 2)], ['h4', {}, 'Validation runs'],
      ['pre', {}, JSON.stringify(research.lesson.validationRuns, null, 2)], ['h4', {}, 'Stored outcome head'],
      ['pre', {}, JSON.stringify(research.lesson.outcome, null, 2)], provenance(research.lesson.provenance)] : null,
    ['h3', {}, 'Committed ablation report'],
    research.reportError ? ['p', { class: 'error-inline research-report-error' }, research.reportError] : null,
    report ? ['section', { class: 'research-report' },
      ['p', {}, 'Report ', code(report.reportId), ' · Source ', code(report.generatedFrom)],
      ['p', { class: 'research-gates' }, `Writeback eligible: ${report.gate.writebackEligible} · Full auto eligible: ${report.gate.fullAutoEligible}`],
      table(['Row', 'State', 'Scope', 'Spend', 'Refusals'], report.rows.map((row: any) => [code(row.id), row.state, row.scope, cost(row.spend), row.refusals.join('; ')]), 'research-matrix'),
      table(['Pair', 'Comparable', 'Delta', 'Interval', 'Losses', 'Refusals'], report.pairs.map((pair: any) => [button(pair.id, 'research/pairSelect', pair.id),
        String(pair.comparable), pair.delta === null ? 'unavailable' : String(pair.delta), pair.interval === null ? 'unavailable' : `[${pair.interval.low}, ${pair.interval.high}]`,
        pair.losses.map((loss: any) => `${loss.topicId}: ${loss.delta}`).join('; '), pair.refusals.map((refusal: any) => `${refusal.code} ${refusal.path}: ${refusal.detail}`).join('; ')]), 'research-pairs'),
      records('Independent artifact audit', report.audit, row => [row.rowId, row.checked, row.resolved, row.unresolved, row.fabricated, row.missing, row.auditDisagreements],
        ['Run', 'Checked', 'Resolved', 'Unresolved', 'Fabricated', 'Missing', 'Disagreements']),
      ...report.limitations.map((line: string) => ['p', { class: 'note' }, line]), ['p', {}, code(report.document)], provenance(report.provenance),
    ] : null,
    research.pair ? ['section', { class: 'research-pair' }, ['h3', {}, 'Recorded comparison'], ['pre', {}, JSON.stringify(research.pair.pair, null, 2)], provenance(research.pair.provenance)] : null,
  ];
}
