import { it } from 'node:test';
import assert from 'node:assert/strict';
import { agentInvocation, createMasRegistrySnapshot, createMasConfigCatalog, defineMasWorkflow, masRevisionOf,
    validateMasWorkflow, planMasWorkflow, compileMasRuntime, type MasAgentComponent, type MasHostBindings } from '@tangleai/mas';
import { createStructuredOutput } from '@tangleai/models/structured';
import { openTangleDb, createGroundingClarificationHost } from '@tangleai/store';
const valueSchema = { type: 'object', required: ['value'], properties: { value: { type: 'integer', minimum: 0 } }, additionalProperties: false };
async function fixture(calls = 3) {
    const instructions = 'Return the requested bounded value.', revision = await masRevisionOf('structured-owner/1');
    const registry = await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'component-fixture',
        roles: [{ id: 'value', title: 'Value', instructions, instructionsRevision: await masRevisionOf(instructions), capabilities: [] }],
        handlers: [], tools: [], contextAdapters: [], templates: [], subgraphs: [], messageAdapters: [{ id: 'json-schema', version: '0.1' }],
        agentExecutors: [{ id: 'structured-value', version: revision }] });
    const catalog = await createMasConfigCatalog({ profiles: ['scripted'], tools: [], contexts: [] }); assert.ok(registry.valid && catalog.valid);
    const workflow = await defineMasWorkflow({ workflowId: 'component-fixture', title: 'Component', description: 'Native component accounting.',
        profile: 'scripted', registryRevision: registry.value.revision, configRegistryRevision: catalog.value.revision,
        input: valueSchema, output: { type: 'object', properties: { result: valueSchema }, required: ['result'], additionalProperties: false },
        entry: [{ port: 'value', to: { node: 'value', port: 'value' } }], exit: [{ port: 'result', from: { node: 'value', port: 'result' } }],
        nodes: [agentInvocation({ id: 'value', role: 'value', profile: 'scripted', instructionsRevision: registry.value.document.roles[0]!.instructionsRevision,
            executor: 'structured-value', input: { value: { type: 'integer' } }, output: { result: valueSchema } })],
        limits: { calls, tokens: 100, ms: 60000, toolRounds: 1, fanOut: 2, concurrency: 1, iterations: 1, contextChars: 10000, traceBytes: 100000 } });
    const validated = await validateMasWorkflow(workflow, registry.value, catalog.value); assert.ok(validated.valid, JSON.stringify(validated));
    const plan = await planMasWorkflow(validated.value); assert.ok(plan.valid);
    return { workflow, snapshot: registry.value, catalog: catalog.value, validated: validated.value, plan: plan.value, revision };
}
async function execute(mode: 'normal' | 'invalid' | 'exhaust' | 'failed') {
    const p = await fixture(mode === 'exhaust' ? 1 : 3), db = await openTangleDb({ jobs: { now: () => 1000, random: () => 0.5 } });
    try {
        const host = createGroundingClarificationHost(db, { now: () => '2026-06-01T00:00:00.000Z', deadlineFor: () => '2026-06-02T00:00:00.000Z' });
        assert.ok((await host.store.putWorkflowVersion(p.workflow)).ok);
        assert.ok((await host.store.putRegistrySnapshot(p.snapshot.document as unknown as Record<string, unknown>, p.snapshot.revision)).ok);
        assert.ok((await host.store.createRun({ runId: 'component', workflowId: p.workflow.workflowId, workflowVersionId: p.workflow.versionId,
            registryRevision: p.snapshot.revision, executableRevision: p.plan.executableRevision, configRegistryRevision: p.catalog.revision,
            profile: 'scripted', input: { value: 7 }, limits: { ...p.workflow.limits } })).ok);
        let physical = 0;
        const component: MasAgentComponent = { id: 'structured-value', version: p.revision, async execute(input) {
            const structured = createStructuredOutput({ client: { ...input.client, endpoint: { provider: 'scripted' } }, schema: valueSchema, maxRepairs: 1 });
            const result = await structured.generate([{ role: 'system', content: input.role.instructions }, { role: 'user', content: input.adapter.render(input.input) }], { signal: input.signal });
            if (result.errors) throw Error('The native structured owner refused.');
            return mode === 'invalid' ? { result: { value: -1 } } : { result: result.value };
        } };
        const components = new Map([[component.id, component]]);
        const bindings: MasHostBindings = { store: host.store, taskHandlers: {}, toolBindings: {}, contextProviders: {}, agentComponents: components,
            now: host.now, clock: () => 0, clientFor: () => ({ endpoint: { provider: 'scripted' }, async complete(request) {
                physical++; assert.ok((request as { signal?: AbortSignal }).signal);
                if (mode === 'failed') throw Error('physical request failed');
                return { message: { content: physical === 1 ? '{}' : '{"value":7}' }, usage: { prompt_tokens: 7, completion_tokens: 3 } };
            } }) };
        const compiled = compileMasRuntime(p.validated, p.plan, p.snapshot, bindings); assert.ok(compiled.valid);
        components.clear(); component.execute = async () => { throw Error('Mutated binding must never run'); };
        await host.execute(compiled.value, 'component');
        return { trace: (await host.store.readTrace('component'))!, physical };
    } finally { await db.close(); }
}
it('a pinned component uses one structured owner and charges its physical schema repair', async () => {
    const r = await execute('normal'); assert.equal(r.trace.run.status, 'completed'); assert.deepEqual(r.trace.run.output, { result: { value: 7 } });
    assert.equal(r.physical, 2); assert.equal(r.trace.attempts[0]!.usage.calls, 2); assert.equal(r.trace.run.budget.spent.tokens, 20);
});
it('a component cannot evade the native output gate', async () => { const r = await execute('invalid'); assert.equal(r.trace.run.status, 'failed'); assert.equal(r.physical, 2); });
it('the shared budget prevents the component repair from dispatching beyond its cap', async () => {
    const r = await execute('exhaust'); assert.equal(r.trace.run.status, 'failed'); assert.equal(r.physical, 1); assert.equal(r.trace.run.failure!.error.code, 'TMAS2009');
});
it('a failed component request remains charged without invented usage', async () => {
    const r = await execute('failed'); assert.equal(r.trace.run.status, 'failed'); assert.equal(r.physical, 1); assert.equal(r.trace.run.budget.spent.turns, 1);
    assert.equal(r.trace.attempts[0]!.usage.unknownTokenRequests, 1);
});
it('missing or changed component capabilities fail before execution', async () => {
    const p = await fixture();
    for (const components of [new Map(), new Map([['structured-value', { id: 'structured-value', version: 'f'.repeat(64), execute: async () => ({}) }]])]) {
        const out = compileMasRuntime(p.validated, p.plan, p.snapshot, { store: {} as MasHostBindings['store'], taskHandlers: {}, toolBindings: {}, contextProviders: {},
            now: () => '', clock: () => 0, clientFor: () => ({ async complete() { throw Error('No model request allowed.'); } }), agentComponents: components });
        assert.ok(!out.valid); assert.equal(out.issues[0]!.code, 'TMAS1009');
    }
});
