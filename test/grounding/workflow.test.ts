import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createGroundingWorkflow } from '../../packages/grounding/src/workflow.ts';
import { compileMasRuntime, validateMasWorkflow } from '@tangleai/mas';
import { loadGroundingProfile } from '@tangleai/grounding';
import profileDocument from '../../packages/grounding/profiles/priha-hk.json' with { type: 'json' };
import { groundingHostHarness, HOST_QUERY } from '../fixtures/grounding/host-harness.ts';
it('the generated grounding workflow validates, lowers and projects its native GMPL child', async () => {
    const profile = await loadGroundingProfile(profileDocument); assert.ok(profile.valid);
    const p = await createGroundingWorkflow({ profile: profile.value, caseId: 'grounding-template', factVocabulary: [], currentOptimization: async () => { throw Error('Compilation must not read runtime intent.'); } });
    assert.ok((await validateMasWorkflow(p.workflow, p.snapshot, p.catalog)).valid);
    assert.ok(p.mermaid.regions.some(row => row.mermaid.includes('flowchart'))); assert.ok(Object.keys(p.mermaid.subplans).length);
    const declared = JSON.parse(await readFile('workflows/grounding-session.json', 'utf8'));
    assert.deepEqual(declared, p.workflow);
});
it('a run cannot widen the governed call budget before any component dispatches', async () => {
    const h = await groundingHostHarness();
    try {
        const reply = await h.host.start({ text: HOST_QUERY, conversationId: 'budget', defer: true }); assert.equal(reply.disposition, 'running');
        const session = (await h.grounding.getSession(reply.sessionId))!, p = await h.host.prepare(session.id, 0), execution = session.execution!;
        assert.ok((await h.segments.store.putWorkflowVersion(p.workflow)).ok);
        assert.ok((await h.segments.store.putRegistrySnapshot(p.snapshot.document as unknown as Record<string, unknown>, p.snapshot.revision)).ok);
        assert.ok((await h.segments.store.createRun({ runId: execution.runId, workflowId: p.workflow.workflowId, workflowVersionId: p.workflow.versionId,
            registryRevision: p.snapshot.revision, executableRevision: p.plan.executableRevision, configRegistryRevision: p.catalog.revision,
            profile: p.workflow.config.profile, input: { context: { sessionId: session.id, route: 'continue', intentId: null, planId: null, answerId: null, evidenceIds: [], conflictIds: [] } },
            limits: { ...p.workflow.limits, calls: p.workflow.limits.calls + 1 } })).ok);
        const runtime = compileMasRuntime(p.validated, p.plan, p.snapshot, await h.host.bind(p, session.id, execution.runId)); assert.ok(runtime.valid);
        await h.segments.execute(runtime.value, execution.runId);
        assert.equal((await h.segments.store.getRun(execution.runId))!.failure!.error.code, 'TMAS2009'); assert.equal(h.stats().calls, 0);
    } finally { await h.close(); }
});
