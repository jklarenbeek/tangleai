/**
 * The skill-evolution surface, end to end through the dispatcher.
 *
 * The desktop shows what a run did and never claims more: every operation
 * here is `kind: 'read'`, and what they answer is compared against the
 * committed instrument report rather than against themselves. The rows are
 * seeded by driving the package's own run into the desktop's database, so a
 * projection that drifted from the store would be visible as a difference
 * from the published measurement.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { nodeDriver } from '@jarenjs/db/node';
import { createTrace2SkillDbStore } from '@tangleai/store';
import { activateCandidate } from '@tangleai/trace2skill';

import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';
import { loadTrace2SkillFixture } from '../../benchmark/lib/trace2skill-fixture.ts';
import { executeSkillMode, REPORT_PATH } from '../../benchmark/lib/trace2skill-report.ts';
import type { Trace2skillReport } from '../../benchmark/lib/trace2skill.types.ts';

const get = async (desktop: Desktop, url: string): Promise<{ status: number, json: any }> => {
  const response = await desktop.dispatcher.dispatch({ method: 'GET', url, headers: {}, body: null });
  const text = typeof response.body === 'string' ? response.body
    : response.body === null ? '' : new TextDecoder().decode(response.body);
  return { status: response.status, json: text === '' ? null : JSON.parse(text) };
};

describe('the skill-evolution surface is read-only and reproduces the stored run', () => {
  let desktop: Desktop;
  let report: Trace2skillReport;
  let scopeKey: string;
  let runId: string;
  let candidateId: string;
  let evaluationId: string;

  before(async () => {
    desktop = await createDesktop({ driver: nodeDriver(), now: () => '2026-09-14T00:00:00Z' });
    report = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as Trace2skillReport;
    const loaded = await loadTrace2SkillFixture();
    const store = createTrace2SkillDbStore(desktop.db);
    const execution = await executeSkillMode(loaded, 'deepening', { store });
    scopeKey = loaded.scope.scopeKey;
    runId = execution.run.run.id;
    candidateId = execution.consolidation?.candidate?.id as string;
    // Activation is a host action, not a surface one; the test performs it so
    // the head read has something to answer with.
    const verdict = execution.evaluation?.evaluation ?? null;
    evaluationId = verdict?.id as string;
    if (verdict !== null && candidateId !== undefined) {
      const applied = await activateCandidate(store, {
        scopeKey, candidateId, evaluationId: verdict.id, actor: 'test',
        registration: {
          scopeKey, executorIdentityId: verdict.executorIdentityId, policyVersion: verdict.policyVersion,
          testHash: verdict.testHash, expectedHead: verdict.expectedHead,
        },
      });
      assert.equal(applied.outcome, 'activated', JSON.stringify(applied.issues));
    }
  });

  after(async () => { await desktop.close(); });

  it('adds read operations only and declares no live thing of its own', () => {
    const operations = DESKTOP_CONTRACT.operations as Record<string, { kind: string }>;
    const skills = Object.keys(operations).filter((name) => name.startsWith('skills.'));
    assert.deepEqual(skills.sort(), [
      'skills.candidates.get', 'skills.evaluations.get', 'skills.head.get',
      'skills.merges.get', 'skills.runs.get', 'skills.runs.list',
    ]);
    for (const name of skills) assert.equal(operations[name].kind, 'read', name);
    assert.deepEqual(Object.entries(operations).filter(([, op]) => op.kind === 'subscribe').map(([name]) => name),
      ['runs.live', 'run.live'], 'the live things are the run table and one named run, and neither is a skill');
    assert.ok(!Object.keys(operations).some((name) => name.startsWith('skills.') && operations[name].kind === 'command'));
  });

  it('lists the stored run and answers its counts', async () => {
    const listed = await get(desktop, '/api/skills/runs');
    assert.equal(listed.status, 200, JSON.stringify(listed.json));
    // A held-out pass is its own run record, so the drive and each condition
    // it evaluated are listed: the surface shows the rows, not a summary of them.
    const ids = listed.json.map((run: any) => run.id);
    assert.equal(new Set(ids).size, ids.length, 'the list repeats a run');
    assert.ok(ids.includes(runId), 'the drive is not listed');
    const driven = listed.json.find((run: any) => run.id === runId);
    // The surface reads the stage off the stored record, so a drive that
    // returned must not still be listed as going.
    assert.equal(driven.status, 'completed');
    assert.deepEqual([...new Set(listed.json.map((run: any) => run.status))], ['completed']);
    assert.equal(driven.scopeKey, scopeKey);
    assert.equal(driven.mode, 'deepening');
    assert.equal(driven.bMerge, report.identity.merge.bMerge);
    assert.equal(driven.seed, report.identity.seed);
    assert.equal((await get(desktop, '/api/skills/runs?limit=1')).json.length, 1);
    const scoped = await get(desktop, `/api/skills/runs?scopeKey=${scopeKey}`);
    assert.deepEqual(scoped.json, listed.json);

    const detail = await get(desktop, `/api/skills/runs/detail?id=${runId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.json.counts.rollouts, (report.probes.find((probe) => probe.id === 'labeled-rollout-envelope')?.observed as { rollouts: number }).rollouts);
    assert.equal(detail.json.counts.merges, report.consolidation.nodes.length);
    assert.deepEqual(detail.json.candidateIds, [candidateId]);
    assert.deepEqual(detail.json.evaluationIds, [evaluationId]);
    assert.equal((await get(desktop, '/api/skills/runs/detail?id=nope')).status, 404);
  });

  it('the merge tree, the candidate diff and the evaluation deltas equal the report', async () => {
    const merges = await get(desktop, `/api/skills/merges?runId=${runId}`);
    assert.equal(merges.status, 200);
    assert.equal(merges.json.levels, report.consolidation.levels);
    assert.equal(merges.json.groups, report.consolidation.groups);
    assert.equal(merges.json.withheld, report.consolidation.discarded);
    assert.deepEqual(merges.json.nodes.map((node: any) => [node.level, node.groupIndex, node.withheld]),
      report.consolidation.nodes.map((node) => [node.level, node.groupIndex, node.withheld]));

    const candidate = await get(desktop, `/api/skills/candidates?id=${candidateId}`);
    assert.equal(candidate.status, 200);
    assert.equal(candidate.json.candidate.bundleId, report.consolidation.bundleId);
    assert.deepEqual(candidate.json.candidate.diffSummary, report.consolidation.diffSummary);
    assert.equal(candidate.json.candidate.finalPatchId, report.consolidation.finalPatchId);
    assert.ok(candidate.json.files.length > 0);
    // A bounded projection: addresses and sizes, never the bytes of a page.
    for (const file of candidate.json.files) assert.deepEqual(Object.keys(file).sort(), ['path', 'sha256', 'size']);
    assert.equal((await get(desktop, '/api/skills/candidates?id=nope')).status, 404);

    const evaluation = await get(desktop, `/api/skills/evaluations?id=${evaluationId}`);
    assert.equal(evaluation.status, 200);
    assert.equal(evaluation.json.candidateBundleId, report.evaluation.candidateBundleId);
    assert.equal(evaluation.json.meanDelta, report.evaluation.meanDelta);
    assert.equal(evaluation.json.eligible, report.evaluation.eligible);
    assert.equal(evaluation.json.results.length, report.evaluation.tasks);
    assert.equal(evaluation.json.leakage, report.evaluation.leakage);
    assert.equal((await get(desktop, '/api/skills/evaluations?id=nope')).status, 404);
  });

  it('the head read answers the active directory through the package, and no run is exposed as a transcript', async () => {
    const head = await get(desktop, `/api/skills/head?scopeKey=${scopeKey}`);
    assert.equal(head.status, 200);
    assert.equal(head.json.versionId, report.evaluation.activations.versionId);
    assert.equal(head.json.revision, report.evaluation.activations.revision);
    assert.equal(head.json.bundle.status, 'active');
    assert.ok(String(head.json.root).startsWith('# '), 'the root page is what a consumer would read');
    assert.equal((await get(desktop, '/api/skills/head?scopeKey=unknown-scope')).status, 404);
    // No operation answers with a trajectory: the stored rollouts are reachable
    // only by their counts.
    const detail = await get(desktop, `/api/skills/runs/detail?id=${runId}`);
    assert.equal(JSON.stringify(detail.json).includes('"messages"'), false);
    assert.equal(JSON.stringify(detail.json).includes('"steps"'), false);
  });
});
