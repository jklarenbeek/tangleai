import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createBudgetAccount } from '@tangleai/agents/recursive';
import { compileMasRuntime } from '@tangleai/mas';
import { createGroundingClarificationHost, openTangleDb } from '@tangleai/store';
import { prepareSingleAgent } from '../../benchmark/lib/gmpl-runner.ts';
import fixture from '../../benchmark/fixtures/gmpl/cases/direct-fact-success.json' with { type: 'json' };

async function execute(mode: 'shared' | 'widened' | 'unbounded' | 'rewound') {
    const prepared = await prepareSingleAgent(6), workflow = prepared.validated.workflow;
    const db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } });
    try {
        const host = createGroundingClarificationHost(db, { now: () => '2026-06-01T00:00:00.000Z', deadlineFor: () => '2026-06-02T00:00:00.000Z' });
        assert.ok((await host.store.putWorkflowVersion(workflow)).ok);
        assert.ok((await host.store.putRegistrySnapshot(prepared.snapshot.document as unknown as Record<string, unknown>, prepared.snapshot.revision)).ok);
        assert.ok((await host.store.createRun({ runId: 'shared-budget', workflowId: workflow.workflowId, workflowVersionId: workflow.versionId,
            registryRevision: prepared.snapshot.revision, executableRevision: prepared.plan.executableRevision,
            configRegistryRevision: prepared.catalog.revision, profile: workflow.config.profile,
            input: { input: fixture.input }, limits: { ...workflow.limits } })).ok);
        const budgetAccount = createBudgetAccount({ ...(mode === 'unbounded' ? {} : { turns: mode === 'widened' ? 7 : 6 }),
            tokens: workflow.limits.tokens, ms: workflow.limits.ms, spent: { turns: 2, tokens: 20, ms: 0 } }, () => 0);
        // A negative account is also a rewind relative to the durable zero spend.
        const account = mode === 'rewound' ? { ...budgetAccount, spent: () => ({ turns: -1, tokens: 0, ms: 0 }) } : budgetAccount;
        let calls = 0;
        const runtime = compileMasRuntime(prepared.validated, prepared.plan, prepared.snapshot, { store: host.store,
            taskHandlers: {}, toolBindings: {}, contextProviders: {}, now: host.now, clock: () => 0, budgetAccount: account,
            clientFor: () => ({ endpoint: { provider: 'scripted' }, async complete() { calls++; return {
                message: { role: 'assistant', content: JSON.stringify(fixture.script.result) }, usage: { prompt_tokens: 7, completion_tokens: 3 } }; } }) });
        assert.ok(runtime.valid); await host.execute(runtime.value, 'shared-budget');
        return { calls, trace: (await host.store.readTrace('shared-budget'))! };
    } finally { await db.close(); }
}
it('MAS retains enclosing host spend and charges both completion and normalization to the same account', async () => {
    const result = await execute('shared'); assert.equal(result.trace.run.status, 'completed'); assert.equal(result.calls, 2);
    assert.deepEqual(result.trace.run.budget.spent, { turns: 4, tokens: 40, ms: 0 });
});
for (const mode of ['widened', 'unbounded', 'rewound'] as const) it('MAS refuses a ' + mode + ' host account before dispatch', async () => {
    const result = await execute(mode); assert.equal(result.trace.run.status, 'failed'); assert.equal(result.calls, 0);
    assert.equal(result.trace.run.failure!.error.code, 'TMAS2009');
    assert.deepEqual(result.trace.run.budget.spent, { turns: 0, tokens: 0, ms: 0 });
});
