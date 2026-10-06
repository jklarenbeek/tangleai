/** Independent read-only evidence audit: stored verification is compared, never taken as authority. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { extractTextDocument } from '@tangleai/documents';
import { researchSchema, researchSchemaReferences, validateResearchShape, verifyResearchDraft, researchObservationSignature,
  researchInterventionReport, renderMetricTable, rerunBundle, stageAttemptIdOf, researchRevisionOf,
  type ResearchExportManifest, type SourceAcquisition, type ResearchClaim, type MetricObservation, type ResearchMetricTableCell,
  type ResearchContract, type ExperimentPlan } from '@tangleai/research';
import { researchBytesSha256, type LoadedResearchFixture } from './research-fixture.ts';
import { verifyResearchBundle } from './research-oracle.ts';
import { createReportValidator } from './validate.ts';
import { table } from './table.ts';
import { RESEARCH_AUDIT_SCHEMA } from './research-audit-schema.ts';
import type { ResearchReport, ResearchBundle } from './research.types.ts';
import type { ResearchArtifactAudit, ResearchAuditCheck, ResearchAuditReport } from './research-audit.types.ts';

const same = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
export const validateResearchAuditShape = createReportValidator(RESEARCH_AUDIT_SCHEMA, [researchSchema, ...researchSchemaReferences]);
function start(id: string, source: string, scope: string, projectId: string | null): ResearchArtifactAudit {
  return { id, source, scope, projectId, checked: 0, resolved: 0, unresolved: 0, fabricated: 0, missing: 0,
    auditDisagreements: 0, checks: [], disagreements: [], interventions: null, limitations: [] };
}
function check(audit: ResearchArtifactAudit, kind: ResearchAuditCheck['kind'], state: ResearchAuditCheck['state'],
  path: string, recordIds: string[], detail: string): void { audit.checks.push({ kind, state, path, recordIds, detail }); }
function finish(audit: ResearchArtifactAudit): ResearchArtifactAudit {
  audit.checked = audit.checks.length;
  for (const name of ['resolved', 'unresolved', 'fabricated', 'missing'] as const) audit[name] = audit.checks.filter(c => c.state === name).length;
  audit.auditDisagreements = audit.disagreements.length;
  return audit;
}
function disagreement(audit: ResearchArtifactAudit, path: string, reported: string, observed: string): void {
  if (reported !== observed) audit.disagreements.push({ path, reported, observed });
}
async function observations(audit: ResearchArtifactAudit, rows: MetricObservation[], projectId: string, path: string): Promise<void> {
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const valid = !seen.has(row.id) && row.projectId === projectId && await researchObservationSignature(row) === row.registrySignature;
    check(audit, 'metric', valid ? 'resolved' : 'fabricated', path + '/' + index, [row.id, row.experimentRunId],
      valid ? 'Unique stored observation retains its project and registry digest.' : 'Duplicate, foreign or changed registry observation.');
    seen.add(row.id);
  }
}
function numberBinding(audit: ResearchArtifactAudit, claim: ResearchClaim, manifest: ResearchExportManifest, path: string,
  cells: ResearchMetricTableCell[]): void {
  const input = manifest.source.inputs, binding = claim.metricBinding;
  if (!binding) { check(audit, 'metric', 'missing', path, [claim.id], 'Result claim has no registered numeric binding.'); return; }
  const metric = input.contract?.metrics.find(m => m.id === binding.metric);
  const all = input.observations.filter(row => row.condition === binding.condition && row.metric === binding.metric).sort((a, b) => a.seed - b.seed);
  const selected = binding.aggregate === 'individual' ? all.filter(row => binding.seeds.includes(row.seed)) : all;
  const cell = cells.find(cell => cell.condition === binding.condition && cell.metric === binding.metric && cell.unit === binding.unit
    && cell.aggregate === binding.aggregate && same(cell.seeds, binding.seeds));
  const valid = metric && input.plan?.conditions.some(c => c.id === binding.condition) && metric.unit === binding.unit
    && selected.length > 0 && new Set(selected.map(row => row.seed)).size === selected.length
    && same(selected.map(row => row.seed), binding.seeds) && same(selected.map(row => row.id), claim.observationIds)
    && (binding.aggregate !== 'individual' || selected.length === 1) && cell !== undefined
    && binding.value === cell.value && cell.n === selected.length && claim.proof?.n === selected.length;
  check(audit, 'metric', valid ? 'resolved' : selected.length ? 'fabricated' : 'missing', path,
    [claim.id, ...selected.map(row => row.id)], valid ? 'Condition, metric, unit, seed set, aggregate and sample count reproduce from stored observations.'
      : 'Manuscript number does not reproduce the registered observation selection.');
}

export async function auditResearchExport(value: unknown, id: string, source: string, loaded: LoadedResearchFixture,
  acquisitions: readonly SourceAcquisition[]): Promise<ResearchArtifactAudit> {
  const shape = validateResearchShape<ResearchExportManifest>('ResearchExportManifest', value);
  const audit = start(id, source, 'manuscript', shape.valid ? shape.value.projectId : null);
  if (!shape.valid) {
    for (const issue of shape.issues) check(audit, 'artifact', 'missing', source + issue.path, [], issue.code + ': ' + issue.detail);
    return finish(audit);
  }
  const manifest = shape.value, { inputs, ledger, draft, verification, provenance } = manifest.source;
  audit.scope = inputs.scope;
  await observations(audit, inputs.observations, inputs.projectId, source + '/source/inputs/observations');
  const checked = await verifyResearchDraft(inputs, ledger, draft);
  const tableCheck = await renderMetricTable(inputs);
  const independentlySupported = new Set(checked.valid ? checked.value.claims.filter(c => c.status === 'supported').map(c => c.claimId) : []);
  for (const [index, claim] of ledger.claims.entries()) {
    const path = source + '/source/ledger/claims/' + index;
    if (claim.kind === 'metric' || claim.proof?.type === 'result') numberBinding(audit, claim, manifest, path + '/metricBinding', tableCheck.valid ? tableCheck.value.cells : []);
    for (const literatureId of claim.literatureIds) {
      const record = inputs.literature.find(row => row.id === literatureId), proof = claim.proof;
      const card = inputs.cards.find(card => card.id === proof?.cardId && card.literatureId === literatureId);
      const file = card && loaded.manifest.members.find(member => member.path.startsWith('sources/') && member.sha256 === card.contentHash);
      const bytes = file && loaded.files.get(file.path);
      const acquired = card && acquisitions.some(row => row.literatureId === literatureId && row.versionId === card.versionId
        && row.contentHash === card.contentHash && row.artifactId === card.artifactId && row.status === 'resolved');
      const element = bytes && card ? extractTextDocument(new TextDecoder().decode(bytes), true).elements.find(e => e.order === card.locator.elementOrder) : null;
      const valid = record?.resolution === 'resolved' && proof?.citation?.recordId === record.id
        && Object.keys(record.canonicalIds).length > 0 && same(proof.citation.canonicalIds, record.canonicalIds)
        && same(proof.citation.rawHashes, record.rawHashes) && card && bytes && acquired
        && researchBytesSha256(bytes) === card.contentHash && card.artifactId === 'art-' + card.contentHash
        && element?.text === card.excerpt && same(element.headingPath, card.locator.headingPath)
        && element.page === card.locator.page && typeof proof.quote === 'string' && card.excerpt.includes(proof.quote) && claim.text === proof.quote;
      check(audit, 'citation', valid ? 'resolved' : 'unresolved', path + '/literatureIds',
        [claim.id, literatureId, ...(card ? [card.id, card.versionId, card.artifactId] : [])],
        valid ? 'Canonical work identity and immutable acquired passage reproduce from the registered full source bytes.'
          : 'Citation identity, acquisition, source bytes, locator or exact supporting quotation does not resolve.');
      if (!valid) independentlySupported.delete(claim.id);
    }
    const supported = independentlySupported.has(claim.id);
    check(audit, 'claim', supported ? 'resolved' : 'unresolved', path, [claim.id, ledger.id, draft.id],
      supported ? 'Native evidence and independent source checks support this exact claim.' : 'Claim support does not follow from the retained evidence.');
    const reported = verification.claims.find(row => row.claimId === claim.id)?.status ?? 'missing';
    disagreement(audit, path, reported, supported ? 'supported' : 'unresolved');
  }
  const rerun = await rerunBundle(manifest);
  check(audit, 'artifact', tableCheck.valid && rerun.valid ? 'resolved' : 'fabricated', source + '/files', [manifest.id, draft.id],
    tableCheck.valid && rerun.valid ? 'Every rendered file checksum and numeric table cell reproduce from the retained records.' : 'Manuscript files or table cells fail independent reconstruction.');
  audit.interventions = researchInterventionReport(provenance.interventions);
  check(audit, 'intervention', !manifest.interventionReport || same(audit.interventions, manifest.interventionReport) ? 'resolved' : 'fabricated',
    source + '/source/provenance/interventions', provenance.interventions.map(row => row.id), 'Intervention counts are re-derived from actors and actions; substantive guidance and approvals stay separate.');
  const expectedSeeds = inputs.contract?.replicatePolicy.seeds ?? [];
  check(audit, 'seed', same(provenance.seeds, expectedSeeds) ? 'resolved' : 'missing', source + '/source/provenance/seeds',
    inputs.contract ? [inputs.contract.id] : [], 'Exported seeds are compared with the frozen replicate policy; retrieval-only scope has no experiment seeds.');
  const prompts = provenance.prompts;
  check(audit, 'prompt', prompts.some(p => same(p, draft.writer)) && prompts.every(p => /^[a-f0-9]{64}$/.test(p.promptRevision)) ? 'resolved' : 'missing',
    source + '/source/provenance/prompts', prompts.map(p => p.roleId), 'Retained prompt identities include the exact writer and every listed role revision.');
  check(audit, 'trace', provenance.runGraph.length > 0 && (inputs.scope === 'retrieval-control' || provenance.attempts.length > 0) ? 'resolved' : 'missing',
    source + '/source/provenance/attempts', provenance.attempts.map(a => a.id), 'Run graph and stored stage-attempt inventory remain explicitly addressed.');
  const attempts = new Set<string>();
  for (const [index, attempt] of provenance.attempts.entries()) {
    const valid = attempt.projectId === inputs.projectId && !attempts.has(attempt.id) && attempt.id === await stageAttemptIdOf(attempt);
    check(audit, 'trace', valid ? 'resolved' : 'fabricated', source + '/source/provenance/attempts/' + index, [attempt.id],
      'Each retained stage attempt must preserve its complete content identity and project without duplicates.');
    attempts.add(attempt.id);
  }
  const observed = checked.valid && checked.value.state === 'verified' && !audit.checks.some(c => c.state !== 'resolved') ? 'verified' : 'refused';
  disagreement(audit, source + '/source/verification/state', verification.state, observed);
  audit.limitations = ['Registry admission is owned by the execution instrument; this reader checks exact stored observations, their provenance and their manuscript mapping.',
    'Support is an admitted exact quotation or registered numeric statement; general semantic entailment and live scientific quality are unmeasured.'];
  return finish(audit);
}

async function auditCore(value: ResearchBundle, id: string, source: string, loaded: LoadedResearchFixture,
  reported: readonly string[]): Promise<ResearchArtifactAudit> {
  const audit = start(id, source, 'full-lifecycle', value.manifest.projectId);
  const verified = await verifyResearchBundle(loaded, value);
  for (const issue of verified.issues) check(audit, 'artifact', issue.path.includes('/value') || issue.path.includes('registrySignature') ? 'fabricated' : 'unresolved',
    source + issue.path, [], issue.code + ': ' + issue.detail);
  for (const claim of value.claims) {
    const supported = verified.supported.includes(claim.id);
    check(audit, claim.kind === 'metric' ? 'metric' : 'citation', supported ? 'resolved' : 'unresolved', source + '/claims',
      [claim.id, ...claim.observationIds, ...claim.literatureIds], 'Independent native oracle reproduces the exact claim and its admitted sources.');
    disagreement(audit, source + '/claims/' + claim.id, reported.includes(claim.id) ? 'supported' : 'unresolved', supported ? 'supported' : 'unresolved');
  }
  audit.interventions = researchInterventionReport(value.interventions);
  check(audit, 'intervention', 'resolved', source + '/interventions', value.interventions.map(i => i.id), 'Counted from retained intervention records.');
  for (const run of value.runs) check(audit, 'trace', run.trace.length > 0 && Number.isSafeInteger(run.seed) ? 'resolved' : 'missing',
    source + '/runs/' + run.id, [run.id], 'Stored seed and trace are independently checked by the native raw-output oracle.');
  check(audit, 'prompt', /^[a-f0-9]{64}$/.test(value.manifest.promptRevision) ? 'resolved' : 'missing', source + '/manifest/promptRevision',
    [value.manifest.manifestHash], 'The oracle verifies the registered prompt bytes.');
  return finish(audit);
}

export async function buildResearchAudit(input: Pick<ResearchReport, 'rows' | 'writing' | 'domains' | 'discovery'>,
  loaded: LoadedResearchFixture): Promise<ResearchAuditReport> {
  const runs: ResearchArtifactAudit[] = [], acquisitions = input.discovery.flatMap(row => row.acquisitions);
  const registrations = new Map<string, { contract: ResearchContract; plan: ExperimentPlan }>();
  for (const [path, bytes] of loaded.files) if (/^(?:topics|domains\/tabular-statistics\/topics)\/[^/]+\.json$/.test(path)) {
    const value = JSON.parse(new TextDecoder().decode(bytes)) as { id: string; contract: unknown; plan: unknown };
    const contract = validateResearchShape<ResearchContract>('ResearchContract', value.contract), plan = validateResearchShape<ExperimentPlan>('ExperimentPlan', value.plan);
    if (contract.valid && plan.valid) registrations.set(value.id, { contract: contract.value, plan: plan.value });
  }
  for (const [rowIndex, row] of input.rows.entries()) {
    if (row.state !== 'measured') continue;
    if (row.scope === 'full-lifecycle') for (const [index, t] of row.topics.entries())
      runs.push(await auditCore(t.bundle, row.id + '/' + t.topicId, '/rows/' + rowIndex + '/topics/' + index + '/bundle', loaded, t.claimsSupported));
    if (row.scope === 'writing') for (const [index, t] of row.topics.entries()) if (t.bundle)
      runs.push(await auditResearchExport(t.bundle, row.id + '/' + t.topicId, '/rows/' + rowIndex + '/topics/' + index + '/bundle', loaded, acquisitions));
  }
  for (const name of ['control', 'autoControl'] as const) {
    const control = input.writing[name];
    if (control) runs.push(await auditResearchExport(control.bundle, 'writing/' + name, '/writing/' + name + '/bundle', loaded, acquisitions));
  }
  for (const [rowIndex, row] of input.domains.rows.entries()) for (const [index, topic] of row.topics.entries()) {
    const receipt = topic.lifecycle, source = '/domains/rows/' + rowIndex + '/topics/' + index + '/lifecycle';
    const audit = start(row.id + '/' + topic.topicId, source, 'metric-lifecycle', receipt.state.projectId);
    const registered = registrations.get(topic.topicId);
    check(audit, 'artifact', registered && registered.contract.contractHash === topic.contractHash && registered.plan.planHash === topic.planHash
      && receipt.state.contractHash === topic.contractHash && receipt.state.planHash === topic.planHash ? 'resolved' : 'missing', source + '/state',
    [topic.contractHash, topic.planHash], 'The lifecycle retains the registered contract and plan identities.');
    if (registered) for (const condition of registered.plan.conditions) {
      const actualSeeds = receipt.runs.filter(run => run.condition === condition.id).map(run => run.seed).sort((a, b) => a - b);
      const expectedSeeds = [...registered.contract.replicatePolicy.seeds].sort((a, b) => a - b);
      check(audit, 'seed', same(actualSeeds, expectedSeeds) ? 'resolved' : 'missing', source + '/runs', [registered.contract.id],
        'Every condition must retain the entire registered seed set once: ' + condition.id + '.');
    }
    await observations(audit, receipt.observations, receipt.state.projectId, source + '/observations');
    for (const run of receipt.runs) {
      const observed = receipt.observations.filter(row => row.experimentRunId === run.id);
      check(audit, 'metric', observed.length === 1 && observed[0].condition === run.condition && observed[0].seed === run.seed
        && observed[0].runArtifactHash === run.rawArtifactHash ? 'resolved' : 'missing', source + '/runs/' + run.id, [run.id, ...observed.map(o => o.id)],
      'The stored execution has exactly one matching registered observation in this single-metric fixture.');
      check(audit, 'trace', run.trace.length === 2 && run.trace[0].event === 'start' && run.trace[1].event === 'output'
        && run.trace[1].detail === run.stopReason && run.status === 'ok' && run.exitStatus === 0
        && Number.isSafeInteger(run.seed) && run.output !== null && run.rawArtifactHash === await researchRevisionOf(run.output) ? 'resolved' : 'missing',
      source + '/runs/' + run.id, [run.id], 'The retained successful execution binds its raw bytes, seed and complete native start/output trace.');
    }
    for (const manifest of receipt.manifests) check(audit, 'prompt', manifest.controlHash && /^[a-f0-9]{64}$/.test(manifest.promptRevision) ? 'resolved' : 'missing',
      source + '/manifests', manifest.controlHash ? [manifest.controlHash] : [], 'Stage input manifests retain their prompt and control revisions.');
    audit.limitations = ['This lifecycle has metric statements and no manuscript or citation claim. Independent raw-value reproduction is retained by the domain registry measurement.'];
    runs.push(finish(audit));
  }
  const totals = { checked: 0, resolved: 0, unresolved: 0, fabricated: 0, missing: 0, auditDisagreements: 0 };
  for (const run of runs) for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += run[key];
  const probes: ResearchAuditReport['probes'] = [];
  const control = input.writing.control?.bundle;
  for (const [index, id] of (['fabricated-number', 'dangling-citation'] as const).entries()) {
    if (!control) { probes.push({ id, source: '/writing/control', state: 'not-run', reason: 'positive-writing-control-not-selected',
      input: null, inputSha256: null, mutation: null, audit: null, matched: false }); continue; }
    const altered = structuredClone(control), claims = altered.source.ledger.claims;
    const claimIndex = claims.findIndex(c => id === 'fabricated-number' ? c.metricBinding !== null : c.literatureIds.length > 0);
    if (claimIndex < 0) throw Error('Registered audit probe target is absent: ' + id);
    const claim = claims[claimIndex], before = id === 'fabricated-number' ? claim.metricBinding!.value : claim.literatureIds;
    if (id === 'fabricated-number') claim.metricBinding!.value += 1000;
    else claim.literatureIds = ['missing-citation'];
    const after = id === 'fabricated-number' ? claim.metricBinding!.value : claim.literatureIds;
    const audit = await auditResearchExport(altered, id, '/audit/probes/' + index + '/input', loaded, acquisitions);
    probes.push({ id, source: '/writing/control/bundle', state: 'measured', reason: null, input: altered, inputSha256: await researchRevisionOf(altered),
      mutation: { path: '/source/ledger/claims/' + claimIndex + (id === 'fabricated-number' ? '/metricBinding/value' : '/literatureIds'),
        before: canonicalizeJson(before), after: canonicalizeJson(after) }, audit,
      matched: audit.auditDisagreements > 0 && (id === 'fabricated-number' ? audit.fabricated > 0 : audit.unresolved > 0) });
  }
  const report: ResearchAuditReport = { runs, probes, totals, limitations: [
    'Read-only reconstruction consumes committed record projections and registered full source bytes. No role, model, provider or mutable web lookup is consulted.',
    'Missing evidence and disagreement are reported alongside resolution; an audited row does not earn an improvement or activation claim.',
    'Pre-execution rows have no completed manuscript. Lesson validation remains in its separate native outcome receipts.',
  ] };
  const checked = validateResearchAuditShape(report);
  if (!checked.valid) throw Error('Research audit refused: ' + JSON.stringify(checked.errors?.slice(0, 8)));
  return report;
}
export async function validateResearchAudit(value: unknown, input: Pick<ResearchReport, 'rows' | 'writing' | 'domains' | 'discovery'>,
  loaded: LoadedResearchFixture): Promise<boolean> {
  return validateResearchAuditShape(value).valid && same(value, await buildResearchAudit(input, loaded));
}
export function renderResearchAudit(report: ResearchAuditReport): string[] {
  return ['## Independent artifact audit', '', table({ head: ['Run', 'Scope', 'Checked', 'Resolved', 'Unresolved', 'Fabricated', 'Missing', 'Disagreements'],
    rows: report.runs.map(r => [r.id, r.scope, r.checked, r.resolved, r.unresolved, r.fabricated, r.missing, r.auditDisagreements]) }), '',
  table({ head: ['Negative probe', 'State', 'Fabricated', 'Unresolved', 'Disagreements', 'Matched', 'Reason'],
    rows: report.probes.map(p => [p.id, p.state, p.audit?.fabricated ?? null, p.audit?.unresolved ?? null,
      p.audit?.auditDisagreements ?? null, String(p.matched), p.reason ?? 'none']) }), '',
  ...report.limitations.map(line => '- ' + line), ''];
}
