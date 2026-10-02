import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { researchVerdict, tradingWorkflowIssue, createMemoryTradingStore, materializeResearch, buildResearchAndTraderRegion, createTradingResearchHostBindings } from '@tangleai/trading';
import { compileGmplPromptPack, gmplCatalogDocument, createGmplCatalog } from '@tangleai/gmpl';
import type { ResearchVerdict, DebateTurn, TradeProposal } from '@tangleai/trading';
import type { MasWorkflow } from '@tangleai/mas';
import { prepareGmplPattern } from '../../benchmark/lib/gmpl-patterns.ts';
import { researchFixture, promptJson, attemptProvenance, checked } from './research-fixture.ts';
import { reidentify } from './fixtures.ts';

const f = await researchFixture();
type Output = { verdict: ResearchVerdict; turns: DebateTurn[]; proposal: TradeProposal };

it('native research and trader execute with retained verdict provenance', async () => {
  const run = await f.run();
  assert.equal(run.status, 'completed', JSON.stringify(run.trace.attempts.filter(a => a.status !== 'completed'), null, 2));
  const output = run.output as Output;
  assert.equal(output.turns.length, 8); assert.equal(output.verdict.rounds, 2); assert.equal(output.verdict.disposition, 'no-consensus');
  assert.deepEqual(output.verdict.historyIds, output.turns.map(t => t.id));
  assert.equal(output.verdict.spend.calls, 22); assert.equal(output.proposal.spend.calls, 2); assert.equal(run.usage.physical, 24);
  for (const turn of output.turns) {
    assert.equal(turn.attemptStatus, 'completed'); assert.equal(turn.spend.calls, 2);
    assert.ok(turn.citations.every(id => f.reports.some(r => r.id === id))); assert.equal(turn.persona, turn.participant!.endsWith('-1') ? 'bull' : 'bear');
    assert.equal(turn.previousTurnIds.length, turn.round === 1 ? turn.phase === 'position' ? 0 : 2 : turn.phase === 'position' ? 4 : 6);
  }
  assert.deepEqual((await f.run()).output, output);
});
it('topology equals GMPL structured-debate', async () => {
  const native = await prepareGmplPattern({ pattern: 'structured-debate', participants: 2, maxRounds: 2 });
  const topology = (p: typeof native | typeof f.research) => [p.validated.workflow, ...p.snapshot.document.subgraphs.map(s => s.workflow as unknown as MasWorkflow)]
    .map(w => ({ entry: w.entry, exit: w.exit, nodes: w.nodes.map(n => ({ id: n.id, kind: n.kind })), messages: w.messages.map(m => ({ from: m.from, to: m.to })) }));
  assert.deepEqual(topology(f.research), topology(native));
  const rounds = f.research.validated.workflow.nodes.find(n => n.id === 'rounds'); assert.equal(rounds?.kind, 'loop');
  if (rounds?.kind === 'loop') assert.equal(rounds.maxIterations, f.manifest.rounds.research);
});
it('composition refuses a native child built from another trading prompt catalog', async () => {
  const original = f.catalog.prompt('trading-research-judge')!;
  const source = (await readFile('prompts/trading/research-judge.toml', 'utf8')).replace('content = "', 'content = "Use this alternative synthetic judgment policy. ');
  const changed = checked(await compileGmplPromptPack(source, { variables: original.variables, outputSchema: original.outputSchema }));
  const catalog = checked(await createGmplCatalog(await gmplCatalogDocument({ id: f.catalog.document.id,
    prompts: f.catalog.document.prompts.map(p => p.id === original.id ? changed : p), domains: [], recipes: [] })));
  const manifest = await reidentify(f.manifest, { promptCatalogRevision: catalog.document.revision });
  const materialized = checked(await materializeResearch({ host: f.research.host, manifest, catalog }));
  const refused = await buildResearchAndTraderRegion({ materialized, catalog: f.catalog, profile: 'scripted' });
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1002');
  const bindings = await createTradingResearchHostBindings({ ...f, materialized, trace: async () => { throw Error('No execution before binding'); }, provenance: attemptProvenance });
  assert.equal(bindings.valid, false); if (!bindings.valid) assert.equal(bindings.issues[0].code, 'TTRD1002');
});
it('host bindings refuse a native child with another round bound', async () => {
  const manifest = await reidentify(f.manifest, { rounds: { ...f.manifest.rounds, research: 3 } });
  const materialized = checked(await materializeResearch({ host: f.research.host, manifest, catalog: f.catalog }));
  const bindings = await createTradingResearchHostBindings({ ...f, materialized, trace: async () => { throw Error('No execution before binding'); }, provenance: attemptProvenance });
  assert.equal(bindings.valid, false); if (!bindings.valid) assert.equal(bindings.issues[0].code, 'TTRD1002');
});
it('turn order and visibility hold in every round and both sides retain their unique findings', async () => {
  const order: string[] = [], script = f.response();
  const run = await f.run({ response: (node, invocation, phase, messages) => {
    if (phase === 'completion') {
      order.push(node);
      if (node !== 'trader') {
        const context = promptJson(messages, 'context') as Record<string, unknown>;
        if (node.startsWith('position')) {
          assert.equal((context.history as unknown[]).length, invocation - 1); assert.equal(Object.hasOwn(context, 'positions'), false);
          assert.equal(context.perspective, node.endsWith('-1') ? 'support the strongest evidenced case' : 'challenge the strongest evidenced case');
        }
        if (node.startsWith('rebuttal')) { assert.equal((context.positions as unknown[]).length, 2); assert.equal(Object.hasOwn(context, 'perspective'), false); }
        if (node === 'judge') { assert.equal((context.positions as unknown[]).length, 2); assert.equal((context.rebuttals as unknown[]).length, 2); }
      }
    }
    return script(node, invocation, phase, messages);
  } });
  assert.equal(run.status, 'completed');
  for (let round = 0; round < 2; round++) { assert.deepEqual(order.slice(round * 5, round * 5 + 2).sort(), ['position-1', 'position-2']);
    assert.deepEqual(order.slice(round * 5 + 2, round * 5 + 4).sort(), ['rebuttal-1', 'rebuttal-2']); assert.equal(order[round * 5 + 4], 'judge'); }
  assert.deepEqual(order.slice(-2), ['synthesis', 'trader']);
  assert.deepEqual((run.output as Output).verdict.result!.findings.map(f => f.id).sort(), ['bear-thesis', 'bull-thesis']);
});
it('resume after a crash spends zero duplicate calls', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'trading-research-resume-'));
  try {
    const normal = await f.run(), resumed = await f.run({ databasePath: join(dir, 'run.sqlite'), crashBefore: 'research/rounds/2/check-rebuttal-2' });
    assert.equal(resumed.status, 'completed', JSON.stringify(resumed.trace.run.failure));
    assert.equal(resumed.crashes, 1); assert.equal(resumed.reopens, 1); assert.ok(resumed.usage.restores > 0);
    assert.deepEqual(resumed.trace.run.budget.spent, normal.trace.run.budget.spent);
    assert.deepEqual(resumed.output, normal.output);
    assert.equal(resumed.usage.physical, normal.usage.physical); assert.equal(resumed.usage.normalization, normal.usage.normalization);
    assert.equal((resumed.output as Output).turns.length, 8); assert.equal((resumed.output as Output).verdict.spend.calls, 22);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('recovery before a later round preserves content-addressed turn and proposal bytes', async () => {
  const three = await researchFixture(3), dir = await mkdtemp(join(tmpdir(), 'trading-later-round-'));
  try {
    const normal = await three.run(), resumed = await three.run({ databasePath: join(dir, 'run.sqlite'), crashBefore: 'research/rounds/2/check-rebuttal-2' });
    assert.equal(resumed.status, 'completed', JSON.stringify(resumed.trace.run.failure));
    assert.equal(resumed.usage.physical, normal.usage.physical); assert.equal(resumed.usage.restores, 15);
    assert.deepEqual(resumed.output, normal.output);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
it('the last permitted round yields no-consensus, not TMAS2009, and preserves an overruled accept', async () => {
  const run = await f.run({ response: f.response({ action: 'accept', contradiction: true }) });
  assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const output = run.output as Output; assert.equal(output.verdict.disposition, 'no-consensus'); assert.equal(output.verdict.rounds, 2);
  assert.ok(output.verdict.judgments!.every(j => j.action === 'continue' && j.judgment.action === 'accept'));
  assert.equal(output.verdict.unresolvedFindings!.length, 1); assert.equal(output.verdict.unresolvedFindings![0].id, 'bear-thesis');
  assert.equal(tradingWorkflowIssue(run.trace.run), null);
});
for (const action of ['accept', 'reject', 'escalate'] as const) it(`${action} terminates before an extra round`, async () => {
  const run = await f.run({ response: f.response({ action }) }); assert.equal(run.status, 'completed', JSON.stringify(run.trace.run.failure));
  const verdict = (run.output as Output).verdict; assert.equal(verdict.rounds, 1); assert.equal(verdict.disposition, action === 'accept' ? 'completed' : 'rejected');
  assert.equal(run.usage.physical, 14);
});
it('losing a supported finding fails before the trader', async () => {
  const script = f.response();
  const run = await f.run({ response: async (node, i, phase, messages) => {
    const output = await script(node, i, phase, messages) as { result?: { findings: unknown[] } };
    if (node === 'synthesis') output.result!.findings = []; return output;
  } });
  assert.equal(run.status, 'failed'); assert.match(JSON.stringify(run.trace.run.failure), /TGMPL1005/);
  assert.equal(run.visibility.filter(v => v.node === 'trader').length, 0);
});
it('an exhausted shared budget stops before the trader with a counted domain refusal', async () => {
  const run = await f.run({ runLimits: { calls: 3 } }); assert.equal(run.status, 'failed'); assert.equal(run.usage.physical, 3);
  assert.equal(run.visibility.filter(v => v.node === 'trader').length, 0); assert.equal(tradingWorkflowIssue(run.trace.run)?.code, 'TTRD1009');
});
it('reconstruction refuses missing trace turns, a replaced result and false spend', async () => {
  const run = await f.run(), output = run.output as Output;
  const input = { manifest: f.manifest, snapshot: f.snapshot.snapshot, session: f.sessions[60], reports: f.reports, catalog: f.catalog,
    result: output.verdict.result, trace: run.trace, scope: 'research', provenance: attemptProvenance };
  for (const altered of [{ ...input, trace: { attempts: run.trace.attempts.filter(a => a.invocationId !== 'position-1') } },
    { ...input, result: { ...output.verdict.result, answer: 'Substituted result' } },
    { ...input, provenance: async (attempt: Parameters<typeof attemptProvenance>[0]) => { const p = await attemptProvenance(attempt); assert.ok(p.valid); return { ...p, value: { ...p.value, spend: { ...p.value.spend, calls: 0 } } }; } }])
    assert.equal((await researchVerdict(altered)).valid, false);
});
it('reconstruction refuses a terminal native carry with a substituted catalog identity', async () => {
  const run = await f.run(), output = run.output as Output, trace = structuredClone(run.trace);
  const loop = trace.attempts.find(a => a.invocationId === 'rounds' && a.status === 'completed')!;
  const carry = loop.output as { next: { policy: { catalogRevision: string } } }; carry.next.policy.catalogRevision = 'f'.repeat(64);
  const refused = await researchVerdict({ ...f, snapshot: f.snapshot.snapshot, session: f.sessions[60], result: output.verdict.result,
    trace, scope: 'research', provenance: attemptProvenance });
  assert.equal(refused.valid, false); if (!refused.valid) assert.equal(refused.issues[0].code, 'TTRD1002');
});
it('the complete research evidence chain stages idempotently without financial writes', async () => {
  const run = await f.run(), output = run.output as Output, store = createMemoryTradingStore();
  checked(await store.put('manifests', f.manifest));
  for (const session of f.snapshot.sessions) checked(await store.put('sessions', session));
  for (const observation of f.snapshot.observations) checked(await store.put('observations', observation));
  checked(await store.initializePortfolio(f.portfolio)); checked(await store.put('snapshots', f.snapshot.snapshot));
  const artifacts = [...f.reports, ...output.turns, output.verdict, output.proposal];
  for (const artifact of artifacts) assert.equal(checked(await store.stageArtifact(artifact.key, artifact)).writes, 1);
  for (const artifact of artifacts) assert.equal(checked(await store.stageArtifact(artifact.key, artifact)).writes, 0);
  assert.equal((await store.list('artifacts')).length, 14);
  for (const table of ['decisions', 'orders', 'fills', 'ledger'] as const) assert.deepEqual(await store.list(table), []);
  assert.deepEqual(await store.listPortfolios(f.manifest.id), [f.portfolio]);
});
