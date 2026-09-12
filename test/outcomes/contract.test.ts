import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openLocalClient } from '@jarenjs/contract/local';
import { createOutcomeContract, outcomeContractDocument, createOutcomeHandlers, OUTCOME_MODEL_OPERATIONS } from '@tangleai/outcomes/contract';
import { createOutcomeService, type Result } from '@tangleai/outcomes';
import { fixture, code, value, scopeId, revision } from './fixtures.ts';
import { lifecycleFixture } from './guarded-fixtures.ts';
import { outcomeTransportFactory } from '../../benchmark/lib/outcome-transports.ts';

describe('outcome public contract', () => {
  it('compiles thirteen operations with no transport ledger and excludes authority tools', () => {
    assert.equal(Object.keys(outcomeContractDocument.operations).length, 13);
    assert.equal(OUTCOME_MODEL_OPERATIONS.length, 11);
    assert.ok(!OUTCOME_MODEL_OPERATIONS.includes('outcomes.approve'));
    for (const operation of Object.values(outcomeContractDocument.operations)) if (operation.kind === 'command') assert.equal((operation as { policy: { idempotency: string } }).policy.idempotency, 'none');
    createOutcomeContract();
  });
  it('keeps malformed input JC2050, broken output/handler JC2070 and OUTC content refusals distinct', async () => {
    const f = await fixture();
    const handlers = createOutcomeHandlers({ resolveHost: () => ({ service: f.service, allowScope: () => true }) });
    const client = openLocalClient(createOutcomeContract(), handlers, { validateOutput: 'always' });
    assert.equal(client.capabilities.idempotency, false);
    const malformed = await client.invoke('outcomes.score', { approved: true });
    assert.equal(malformed.ok, false); assert.match(JSON.stringify(malformed), /JC2050/);
    const domain = await client.invoke('outcomes.score', f.command('missing', { resolutionId: revision }));
    assert.ok(domain.ok); code(domain.value as Result, 'OUTC1004');
    for (const bad of [() => ({ ok: true, value: { invented: true }, replayed: false, writes: 0 }), () => { throw Error('bug'); }]) {
      const broken = openLocalClient(createOutcomeContract(), { ...handlers, 'outcomes.score': bad }, { validateOutput: 'always' });
      const result = await broken.invoke('outcomes.score', f.command('bad', { resolutionId: revision }));
      assert.equal(result.ok, false); assert.match(JSON.stringify(result), /JC2070/);
    }
    const forged = await client.invoke('outcomes.approve', f.command('forged', { action: 'promote', actorId: 'operator', approved: true }));
    assert.match(JSON.stringify(forged), /JC2050/);
  });
  for (const binding of ['local', 'http'] as const) it(`${binding} denies approval/reconciliation and all foreign scope access before replay`, async () => {
    const f = await lifecycleFixture(), root = await f.root();
    const denied = await outcomeTransportFactory(binding).factory({ ...f.host, principal: undefined });
    code(await denied.approve({ ...f.command('denied', { action: 'promote', versionId: root.versionId, evaluationId: root.evaluationId, expectedHead: root.head, reason: 'caller' }) }), 'OUTC1012');
    code(await denied.reconcile(f.command('reconcile', { attemptId: revision, evidence: { sourceId: 'proof', digest: revision } })), 'OUTC1012');
    code(await denied.inspect({ scopeId: revision, artifactKey: 'a', input: { id: root.versionId } }), 'OUTC1003');
    code(await denied.history({ scopeId: revision, artifactKey: 'a', input: {} }), 'OUTC1003');
  });
  it('freezes public v1 and actually refuses field removal and enum narrowing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'outcome-contract-'));
    try {
      for (const change of ['field', 'enum']) {
        const altered = structuredClone(outcomeContractDocument);
        if (change === 'field') {
          delete (altered.$defs.createInput.properties as Record<string, unknown>).memoryIds;
          altered.$defs.createInput.required = altered.$defs.createInput.required.filter(k => k !== 'memoryIds');
        } else altered.$defs.reflectInput.properties.mode.enum = ['create'];
        const path = join(dir, change + '.json'); await writeFile(path, JSON.stringify(altered));
        assert.throws(() => execFileSync('node_modules/.bin/jaren-contract', ['diff', '--from', 'scripts/fixtures/outcomes-contract-v1.json', '--to', path, '--fail-on', 'breaking'], { stdio: 'pipe' }));
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
