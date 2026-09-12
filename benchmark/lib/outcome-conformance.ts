/** Deterministic outcome measurements; oracle rows never establish runtime capability. */
import { createOutcomeContract } from '@tangleai/outcomes/contract';
import { readFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { equalsJson } from '@jarenjs/core/object';
import { createMemoryUnitStore, applyOutcome } from '@tangleai/memory';
import { sourceManifest } from './source-manifest.ts';
import lifecycle from '../fixtures/outcome/lifecycle.json' with { type: 'json' };
import { measureOutcomeScenarios } from './outcome-scenarios.ts';
import { measureOutcomeTransports } from './outcome-transports.ts';
import { measureOutcomeStorage } from './outcome-storage.ts';
import { measureIntegratedStatic, measureOutcomeReplay } from './outcome-runtime.ts';
import { validateOutcomeTrace } from './outcome-trace.ts';
import { measureResolutionSafety } from './outcome-resolution-probes.ts';
import { measureOutcomeGuards } from './outcome-guard-probes.ts';
import { loadOutcomeFixtures, validateFixture } from './outcome-fixtures.ts';
import { createReportValidator } from './validate.ts';
import { table } from './table.ts';
import schema from '../schemas/outcome-conformance.schema.json' with { type: 'json' };
import type { OutcomeConformance, Counts, Row, Probe, Json, Source } from './outcome-conformance.types.ts';
export type { OutcomeConformance, Row, Probe } from './outcome-conformance.types.ts';
export const REPORT_PATH = 'benchmark/results/outcome-conformance.json';
export const DOCUMENT_PATH = 'docs/OUTCOME_BENCHMARK.md';
export const SOURCE_FILES = [
    'benchmark/lib/outcome-scenarios.ts', 'benchmark/lib/outcome-model-fixture.ts', 'benchmark/scripts/outcome-runtime.ts', 'benchmark/fixtures/outcome-proposal-config.json', 'benchmark/lib/outcome-transports.ts', 'examples/outcomes.ts', 'scripts/outcomes-contract.ts', 'benchmark/lib/outcome-storage.ts', 'benchmark/lib/outcome-runtime.ts', 'benchmark/lib/outcome-trace.ts', 'benchmark/lib/outcome-activation-trace.ts', 'benchmark/lib/outcome-resolution-probes.ts', 'benchmark/lib/outcome-guard-probes.ts', 'package.json', 'package-lock.json', 'benchmark/outcome-conformance.ts',
    'benchmark/lib/outcome-fixtures.ts', 'benchmark/lib/outcome-conformance.ts',
    'benchmark/lib/outcome-conformance.types.ts', 'benchmark/lib/source-manifest.ts',
    'benchmark/lib/validate.ts', 'benchmark/lib/table.ts', 'benchmark/lib/args.ts',
    'benchmark/schemas/outcome-conformance.schema.json',
    'packages/memory/src/outcome.ts', 'packages/memory/src/store.ts', 'packages/core/src/schemas/memory.ts',
    'benchmark/fixtures/outcome/manifest.json', 'benchmark/fixtures/outcome/quality.json',
    'benchmark/fixtures/outcome/held-out.json', 'benchmark/fixtures/outcome/lifecycle.json',
];
const validateShape = createReportValidator(schema);
export const utilityOf = (outcome: 'success' | 'partial' | 'failure') => outcome === 'success' ? 1 : outcome === 'partial' ? 0.5 : 0;
/** Scalar baseline scorer, kept separate from the fixture's golden expected results. */
export function baselineScore(domain: string, output: Json, outcome: Json): 'success' | 'partial' | 'failure' {
    if (!output || typeof output !== 'object' || Array.isArray(output) || !outcome || typeof outcome !== 'object' || Array.isArray(outcome))
        throw Error('invalid scalar fixture');
    if (domain === 'exact-match')
        return output.label === outcome.label ? 'success' : 'failure';
    const p = output.predicted, a = outcome.actual;
    if (typeof p !== 'number' || typeof a !== 'number' || !Number.isFinite(p) || !Number.isFinite(a))
        throw Error('invalid numeric fixture');
    const same = (p >= 0 && a >= 0) || (p < 0 && a < 0);
    return same && Math.abs(p - a) < 0.05 ? 'success' : same ? 'partial' : 'failure';
}
export const probe = (id: string, expected: Json, actual: Json, capability = 'oracle'): Probe => ({ id, expected, actual, holds: equalsJson(expected, actual), capability });
export function emptyCounts(): Counts { return { proposed: 0, evaluated: 0, eligible: 0, approved: 0, maxVersions: 0, reflectionBytes: 0, projectionReplayed: 0, projectionFailed: 0, planned: 0, available: 0, pending: 0, scored: 0, unscored: 0, success: 0, partial: 0, failure: 0, physicalRequests: 0, scriptedCalls: 0, writes: 0, replayed: 0, refused: 0, failed: 0, uncertain: 0, versions: 0, promotions: 0, rollbacks: 0, retainedBytes: 0, projectionApplied: 0, projectionMissing: 0, projectionChanged: 0 }; }
export function finalizeRow(row: Row): Row {
    const c = row.counts;
    c.planned = row.cases.length;
    c.available = row.cases.filter(v => v.available).length;
    c.pending = c.planned - c.available;
    c.scored = row.cases.filter(v => v.status === 'scored').length;
    c.unscored = c.available - c.scored;
    for (const category of ['success', 'partial', 'failure'] as const)
        c[category] = row.cases.filter(v => v.outcome === category).length;
    const sum = row.cases.reduce((a, v) => a + (v.utility ?? 0), 0);
    row.utility = c.available ? sum / c.available : null;
    row.conditionalUtility = c.scored ? sum / c.scored : null;
    return row;
}
export async function legacyProbes(): Promise<Probe[]> {
    const make = async (ids = ['a']) => { const s = createMemoryUnitStore(); for (const id of ids)
        await s.put({ id, text: id, evidence: 'fixture', kind: 'fact', tags: [], at: '2026-01-01T00:00:00.000Z', confidence: 0.5 }); return s; };
    const r = (ids: string[]) => ({ memoryIds: ids, outcome: 'success' as const, at: '2026-01-02T00:00:00.000Z', evidence: 'fixture resolution' });
    const s = await make();
    await applyOutcome(s, r(['a']));
    const first = (await s.get('a'))!.confidence!;
    await applyOutcome(s, r(['a']));
    const d = await make();
    const dup = await applyOutcome(d, r(['a', 'a']));
    const f = await make(['a', 'b']);
    let calls = 0, threw = false;
    try {
        await applyOutcome({ ...f, put: async (u) => { if (++calls === 2)
                throw Error('injected'); await f.put(u); } }, r(['a', 'b']));
    }
    catch {
        threw = true;
    }
    return [probe('legacy-repeat', [0.65, 0.8], [first, (await s.get('a'))!.confidence!]), probe('legacy-duplicate', [2, 0.8], [dup.adjusted, (await d.get('a'))!.confidence!]), probe('legacy-partial-write', [true, 0.65, 0.5], [threw, (await f.get('a'))!.confidence!, (await f.get('b'))!.confidence!]), probe('legacy-timestamp', '2026-01-02T00:00:00.000Z', (await s.get('a'))!.at)];
}
export async function validateOutcomeReport(value: unknown): Promise<OutcomeConformance> {
    const shape = validateShape(value);
    if (!shape.valid)
        throw Error(`outcome report schema: ${JSON.stringify(shape.errors)}`);
    const r = value as OutcomeConformance;
    const { reportId, ...body } = r;
    if (await canonicalSha256(body) !== reportId)
        throw Error('outcome report digest mismatch');
    const { registrationId, ...reg } = r.registration;
    if (await canonicalSha256(reg) !== registrationId)
        throw Error('outcome registration mismatch');
    if (registrationId !== '65f2b022355c23a173e44a1056b1a06e83da8f6b4eb25ba94e22218d715d3e58')
        throw Error('outcome registration is not the frozen experiment');
    if (await canonicalSha256({ head: r.source.head, files: r.source.files }) !== r.source.sha256)
        throw Error('outcome source receipt mismatch');
    const names = r.rows.map(v => v.id);
    for (const id of ['oracle', 'legacy-static', 'integrated-static', 'checked-scripted', 'unsafe-control'])
        if (!names.includes(id))
            throw Error('outcome missing required row');
    for (const row of r.rows) {
        const copy = finalizeRow(structuredClone(row));
        if (!equalsJson(copy, row))
            throw Error('outcome row arithmetic mismatch');
        if (row.status === 'not-implemented' && (row.cases.length || row.utility !== null || row.evidence !== 'unavailable'))
            throw Error('absent capability has fabricated measurement');
        if (row.status === 'measured' && (row.counts.planned !== 32 || row.counts.available !== 24))
            throw Error('outcome denominator changed');
        for (const c of row.cases)
            if (c.status === 'scored' ? (c.outcome === null || c.utility !== utilityOf(c.outcome) || !c.available) : (c.outcome !== null || c.utility !== null))
                throw Error('outcome hidden or false score');
        if (row.counts.physicalRequests !== 0)
            throw Error('keyless outcome report contains physical requests');
    }
    const measured = r.rows.filter(v => v.status === 'measured');
    if (measured.some(v => !equalsJson(v.cases.map(c => [c.id, c.available]), measured[0].cases.map(c => [c.id, c.available]))))
        throw Error('unpaired outcome case sets');
    for (const p of [...r.probes, ...r.rows.flatMap(v => v.probes)])
        if (p.holds !== equalsJson(p.expected, p.actual))
            throw Error('outcome false probe verdict');
    if (new Set(r.traces.map(t => t.rowId)).size !== r.traces.length)
        throw Error('outcome duplicate runtime trace');
    for (const row of r.rows.filter(v => v.status === 'measured' && v.evidence === 'scripted')) {
        const trace = r.traces.find(t => t.rowId === row.id);
        if (!trace)
            throw Error('outcome missing runtime trace');
        await validateOutcomeTrace(row, trace);
    }
    if (r.capabilities.resolution !== r.rows.some(v => v.id === 'integrated-static' && v.status === 'measured' && v.probes.every(p => p.holds)))
        throw Error('outcome unsupported resolution capability');
    if (r.capabilities.promotion !== r.rows.some(v => v.id === 'checked-scripted' && v.status === 'measured' && v.counts.promotions > 0 && v.probes.every(p => p.holds)))
        throw Error('outcome unsupported promotion capability');
    const checkedRow = r.rows.find(v => v.id === 'checked-scripted')!, checkedTrace = r.traces.find(t => t.rowId === 'checked-scripted');
    const contractRevision = await createOutcomeContract().revision();
    const injectionReads = new Set(checkedRow.cases.filter(c => c.versionId !== null).map(c => c.domain + ':' + c.round)).size;
    for (const binding of r.bindings) {
        if (binding.binding === 'direct' ? (binding.requests !== 0 || binding.contractRevision !== null) : (binding.requests !== 2 * checkedRow.counts.replayed + checkedRow.counts.scored + injectionReads || binding.contractRevision !== contractRevision))
            throw Error('outcome transport accounting or contract identity differs');
        await validateOutcomeTrace(checkedRow, binding.trace);
        if (!equalsJson(binding.trace, checkedTrace))
            throw Error('outcome transport business trace differs');
    }
    const hasContract = ['local', 'http'].every(name => r.bindings.some(b => b.binding === name && b.requests > 0));
    if (r.capabilities.contract !== hasContract)
        throw Error('outcome unsupported contract capability');
    const allProbes = [...r.probes, ...r.rows.flatMap(row => row.probes)];
    if (new Set(names).size !== names.length || new Set(allProbes.map(p => p.id)).size !== allProbes.length)
        throw Error('outcome duplicate row or probe');
    const hasComplete = hasContract && ['projection-disabled', 'proposal-only'].every(id => r.rows.some(row => row.id === id && row.status === 'measured'))
        && lifecycle.scenarios.every(s => allProbes.some(p => p.id === 'scenario-' + s.id && p.holds && equalsJson(p.expected, { code: s.code, invariant: true })))
        && r.bindings.some(b => b.runtime === 'bun' && b.store === 'sqlite') && r.bindings.some(b => b.store === 'memory')
        && allProbes.every(p => p.holds) && r.capabilities.oracle && r.capabilities.storage && r.capabilities.resolution && r.capabilities.promotion;
    if (r.capabilities.complete !== hasComplete)
        throw Error('outcome unsupported complete capability');
    const storageIds = ['reference-head-cas', 'reference-rollback', 'reference-bounded-query', 'sqlite-head-cas', 'sqlite-rollback', 'sqlite-bounded-query', 'version-capacity-guard'];
    if (!storageIds.every(id => r.probes.some(p => p.id === id && p.capability === 'storage')))
        throw Error('outcome missing storage evidence');
    if (!r.capabilities.oracle || r.capabilities.storage !== r.probes.filter(p => p.capability === 'storage').every(p => p.holds))
        throw Error('outcome unsupported baseline capability');
    return r;
}
export async function buildOutcomeReport(options: {
    root?: string;
    source?: Source;
} = {}): Promise<OutcomeConformance> {
    const root = options.root ?? process.cwd(), f = await loadOutcomeFixtures(root);
    const storageProbes = await measureOutcomeStorage();
    const cases = f.quality.map(c => ({ id: c.id, domain: c.domain, round: c.round, available: c.outcome !== null, outcome: c.expectedStatic, utility: c.expectedStatic ? utilityOf(c.expectedStatic) : null, status: c.outcome === null ? 'pending' as const : 'scored' as const, versionId: null }));
    const rows: Row[] = ['oracle', 'legacy-static'].map(id => finalizeRow({ id, status: 'measured', evidence: id === 'oracle' ? 'oracle' : 'legacy', reason: null, cases: structuredClone(cases), counts: emptyCounts(), utility: null, conditionalUtility: null, cost: null, usageKnown: false, probes: [] }));
    rows[1].cases = f.quality.map(c => {
        const input = c.input as Record<string, Json>, output: Json = c.domain === 'direction-delta' ? { predicted: input.base } : { label: 'unknown' };
        const outcome = c.outcome === null ? null : baselineScore(c.domain, output, c.outcome);
        return { id: c.id, domain: c.domain, round: c.round, available: c.outcome !== null, outcome, utility: outcome === null ? null : utilityOf(outcome), status: outcome === null ? 'pending' : 'scored', versionId: null };
    });
    const legacyStore = createMemoryUnitStore();
    let legacyApplied = 0;
    for (const c of rows[1].cases) {
        await legacyStore.put({ id: c.id, kind: 'fact', text: c.id, evidence: 'registered legacy fixture', tags: [], at: '2026-01-01T00:00:00.000Z', confidence: .5 });
        if (c.outcome !== null) {
            const applied = await applyOutcome(legacyStore, { memoryIds: [c.id], outcome: c.outcome, at: '2026-01-02T00:00:00.000Z', evidence: 'registered fixture outcome' });
            legacyApplied += applied.adjusted;
        }
    }
    rows[1].counts.writes = legacyApplied;
    rows[1].counts.projectionApplied = legacyApplied;
    rows[1].counts.projectionChanged = legacyApplied;
    finalizeRow(rows[1]);
    rows[1].probes = await legacyProbes();
    rows[1].probes.push(probe('baseline-score-parity', cases.map(c => c.outcome), rows[1].cases.map(c => c.outcome)));
    for (const c of f.lifecycle.scores)
        rows[1].probes.push(probe(`score-${c.predicted}-${c.actual}`, c.outcome, baselineScore('direction-delta', { predicted: c.predicted }, { actual: c.actual })));
    const integrated = await measureIntegratedStatic(f);
    integrated.row.probes.push(...await measureResolutionSafety());
    rows.push(integrated.row);
    const checked = await measureOutcomeReplay(f, { mode: 'checked-scripted' });
    checked.row.probes.push(...await measureOutcomeGuards(f));
    rows.push(checked.row);
    const disabled = await measureOutcomeReplay(f, { mode: 'projection-disabled' }), proposalOnly = await measureOutcomeReplay(f, { mode: 'proposal-only' });
    disabled.row.probes.push(probe('projection-ablation-quality', checked.row.cases.map(c => [c.id, c.outcome, c.utility]), disabled.row.cases.map(c => [c.id, c.outcome, c.utility]), 'complete'));
    proposalOnly.row.probes.push(probe('proposal-only-no-activation', [0, 0], [proposalOnly.row.counts.promotions, proposalOnly.row.counts.evaluated], 'complete'));
    rows.push(disabled.row, proposalOnly.row);
    const scenarios = await measureOutcomeScenarios(f), transports = await measureOutcomeTransports(f, checked.trace);
    rows.push({ id: 'unsafe-control', status: 'expected-unsafe', evidence: 'unsafe-control', reason: 'Benchmark-only activation without evidence/approval is rejected by the independent trace expectation.', cases: [], counts: emptyCounts(), utility: null, conditionalUtility: null, cost: null, usageKnown: false, probes: [probe('unsafe-activation-must-fail', false, acceptActivationTrace({ evidence: false, approval: false, active: true }))] });
    const manifest = JSON.parse(await readFile(root + '/package.json', 'utf8')) as {
        version: string;
    };
    const jaren = JSON.parse(await readFile(root + '/node_modules/@jarenjs/core/package.json', 'utf8')) as {
        version: string;
    };
    const body = { benchmark: 'outcome-conformance' as const, schemaVersion: 1 as const, source: options.source ?? await sourceManifest(root, SOURCE_FILES, ['packages']), registration: f.manifest, runtime: { node: process.versions.node, bun: process.versions.bun ?? null, tangle: manifest.version, jaren: jaren.version }, rows, traces: [integrated.trace, checked.trace, disabled.trace, proposalOnly.trace], bindings: transports.bindings, probes: [...scenarios, ...transports.probes, probe('fixture-census', [32, 24, 8, 24, 24], [f.quality.length, f.quality.filter(c => c.outcome !== null).length, f.quality.filter(c => c.outcome === null).length, f.held.length, f.lifecycle.scenarios.length]), ...storageProbes], capabilities: { oracle: true, storage: storageProbes.every(p => p.holds), resolution: integrated.row.probes.every(p => p.holds), promotion: checked.row.probes.every(p => p.holds), contract: transports.probes.every(p => p.holds), complete: scenarios.every(p => p.holds) && transports.probes.every(p => p.holds) }, limitations: ['Projection ablation uses a predictor that never reads confidence; it cannot measure confidence’s decision benefit.', 'Safety interruptions stop after durable dispatch and before network; no provider is called.', 'Scripted fixture evidence is not measured autonomous learning.', 'No live requests; monetary cost and usage are unmeasured.', 'Legacy confidence projection is not atomic or replay-safe.', 'Scripted calls count registered candidate submissions; deterministic interpreter and scorer calls are separate computations.'], reportId: '' };
    const { reportId: _id, ...hashable } = body;
    body.reportId = await canonicalSha256(hashable);
    return validateOutcomeReport(body);
}
export function acceptActivationTrace(trace: {
    evidence: boolean;
    approval: boolean;
    active: boolean;
}): boolean { return !trace.active || (trace.evidence && trace.approval); }
export function requireCapability(r: OutcomeConformance, name: string): void {
    if (!Object.hasOwn(r.capabilities, name))
        throw Error(`unknown outcome capability: ${name}`);
    if (!r.capabilities[name as keyof typeof r.capabilities] || [...r.probes, ...r.rows.flatMap(v => v.probes)].some(p => !p.holds))
        throw Error(`outcome capability gate failed: ${name}`);
}
export const renderReport = (r: OutcomeConformance) => JSON.stringify(r, null, 2) + '\n';
export function pairedOutcomeRows(r: OutcomeConformance) {
    const baseline = r.rows.find(row => row.id === 'legacy-static')!;
    return r.rows.filter(row => row.status === 'measured').flatMap(row => [1, 2, 3, 4].flatMap(round => ['direction-delta', 'exact-match'].map(domain => {
        const cases = row.cases.filter(c => c.round === round && c.domain === domain && c.available);
        const pairs = cases.map(c => ({ current: c.utility ?? 0, baseline: baseline.cases.find(b => b.id === c.id)?.utility ?? 0 }));
        const mean = pairs.length ? pairs.reduce((n, p) => n + p.current, 0) / pairs.length : null;
        const delta = pairs.length ? pairs.reduce((n, p) => n + p.current - p.baseline, 0) / pairs.length : null;
        return { row: row.id, domain, round, available: cases.length, mean, delta, improved: pairs.filter(p => p.current > p.baseline).length, tied: pairs.filter(p => p.current === p.baseline).length, worsened: pairs.filter(p => p.current < p.baseline).length };
    })));
}
export function outcomeOverview(r: OutcomeConformance) {
    const baseline = r.rows.find(v => v.id === 'legacy-static')!;
    return r.rows.filter(row => row.status === 'measured').map(row => {
        const cases = row.cases.filter(c => c.available), pairs = cases.map(c => ({ current: c.utility ?? 0, baseline: baseline.cases.find(b => b.id === c.id)?.utility ?? 0 }));
        const domains = [...new Set(cases.map(c => c.domain))].map(domain => { const members = cases.filter(c => c.domain === domain); return { name: domain, mean: members.reduce((n, c) => n + (c.utility ?? 0), 0) / members.length }; }).sort((a, b) => a.mean - b.mean || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        const rounds = [...new Set(cases.map(c => c.round))].map(round => { const members = cases.filter(c => c.round === round); return { name: round, mean: members.reduce((n, c) => n + (c.utility ?? 0), 0) / members.length }; }).sort((a, b) => a.mean - b.mean || a.name - b.name);
        return [row.id, pairs.reduce((n, p) => n + p.current - p.baseline, 0) / pairs.length, pairs.filter(p => p.current > p.baseline).length, pairs.filter(p => p.current === p.baseline).length, pairs.filter(p => p.current < p.baseline).length, domains[0].name, domains[0].mean, rounds[0].name, rounds[0].mean, `${row.counts.scored} / ${row.counts.available}`];
    });
}
export function renderDocument(r: OutcomeConformance): string {
    return '# Outcome lifecycle benchmark\n\nGenerated by `npm run benchmark:outcome`; do not edit figures.\n\n'
        + `Registration: \`${r.registration.registrationId}\`. Report: \`${r.reportId}\`. Tangle ${r.runtime.tangle}; Jaren ${r.runtime.jaren}.\n\n`
        + table({ head: ['Row', 'Status', 'Available / planned', 'Primary utility', 'Conditional utility', 'Pending / unscored', 'Usage known', 'Cost', 'Physical requests'], rows: r.rows.map(v => [v.id, v.status, `${v.counts.available} / ${v.counts.planned}`, v.utility, v.conditionalUtility, `${v.counts.pending} / ${v.counts.unscored}`, String(v.usageKnown), v.cost, v.counts.physicalRequests]), numeric: [3, 4, 7, 8] }) + '\n\n'
        + 'The primary utility denominator includes every available outcome; failed or unscored cases contribute zero. Pending decisions are reported separately. A scripted candidate is a registered fixture response, not a learned model policy.\n\n'
        + table({ head: ['Row', 'Mean paired delta', 'Improved', 'Tied', 'Worsened', 'Worst domain', 'Domain utility', 'Worst round', 'Round utility', 'Score coverage'], rows: outcomeOverview(r), numeric: [1, 2, 3, 4, 6, 7, 8] }) + '\n\n'
        + 'Worst-group ties select ascending domain name or earliest round; all tied groups remain visible below.\n\n'
        + table({ head: ['Row', 'Domain', 'Round', 'Available', 'Mean', 'Paired delta', 'Improved', 'Tied', 'Worsened'], rows: pairedOutcomeRows(r).map(v => [v.row, v.domain, v.round, v.available, v.mean, v.delta, v.improved, v.tied, v.worsened]), numeric: [2, 3, 4, 5, 6, 7, 8] }) + '\n\n'
        + table({ head: ['Row', 'Staged versions', 'Promoted', 'Rolled back', 'Ineligible/refused', 'Payload bytes', 'Scripted calls', 'Writes', 'Replayed', 'Projection applied / missing / changed'], rows: r.rows.filter(v => v.evidence === 'scripted').map(v => [v.id, v.counts.versions, v.counts.promotions, v.counts.rollbacks, v.counts.refused, v.counts.retainedBytes, v.counts.scriptedCalls, v.counts.writes, v.counts.replayed, `${v.counts.projectionApplied} / ${v.counts.projectionMissing} / ${v.counts.projectionChanged}`]), numeric: [1, 2, 3, 4, 5, 6, 7, 8] }) + '\n\n'
        + table({ head: ['Row', 'Proposed', 'Evaluated', 'Eligible', 'Approved for promotion', 'Max retained per artifact', 'Reflection bytes', 'Projection replayed / failed'], rows: r.rows.filter(v => v.evidence === 'scripted').map(v => [v.id, v.counts.proposed, v.counts.evaluated, v.counts.eligible, v.counts.approved, v.counts.maxVersions, v.counts.reflectionBytes, `${v.counts.projectionReplayed} / ${v.counts.projectionFailed}`]), numeric: [1, 2, 3, 4, 5, 6] }) + '\n\n'
        + table({ head: ['Row', 'Candidate', 'Paired held-out delta', 'Eligible', 'Issues'], rows: r.traces.flatMap(t => t.records.filter(v => v && typeof v === 'object' && !Array.isArray(v) && v.kind === 'evaluation').map(v => { const e = v as Record<string, Json>; return [t.rowId, String(e.versionId).slice(0, 12), typeof e.meanDelta === 'number' ? e.meanDelta : null, String(e.eligible), JSON.stringify(e.issues)]; })), numeric: [2] }) + '\n\n'
        + table({ head: ['Binding', 'Store', 'Runtime', 'Transport requests', 'Contract revision'], rows: r.bindings.map(b => [b.binding, b.store, b.runtime, b.requests, b.contractRevision]), numeric: [3] }) + '\n\n'
        + table({ head: ['Probe', 'Expected', 'Observed', 'Holds'], rows: [...r.probes, ...r.rows.flatMap(v => v.probes)].map(p => [p.id, JSON.stringify(p.expected), JSON.stringify(p.actual), String(p.holds)]), numeric: [] }) + '\n\n'
        + r.limitations.map(v => '- ' + v).join('\n') + '\n';
}
