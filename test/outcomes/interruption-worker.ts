/** Intentionally exits without closing SQLite after a committed boundary. */
import { openTangleDb, createOutcomeStore } from '@tangleai/store';
import { createOutcomeService } from '@tangleai/outcomes';
import { safetyFixture } from '../../benchmark/lib/outcome-scenarios.ts';
import { createInterruptedProposer } from '../../benchmark/lib/outcome-model-fixture.ts';
import { resultId } from '../../benchmark/lib/outcome-runtime.ts';
const [path, stage] = process.argv.slice(2);
const db = await openTangleDb({ path }), f = await safetyFixture(false, createOutcomeStore(db));
if (stage === 'dispatch') {
  const proposer = await createInterruptedProposer(() => process.exit(17));
  const service = await createOutcomeService({ ...f.host, proposer });
  await service.reflect(f.command('uncertain', { ...f.reflectInput(null), text: '', configuration: { kind: 'model', identityId: proposer.identity.identityId } }));
} else if (stage === 'score') {
  await f.store.memories.put({ id: 'crash-fact', kind: 'fact', text: 'fact', evidence: 'fixture', tags: [], at: '2026-01-01T00:00:00.000Z', confidence: .5 });
  await f.scored('crash-score', { label: 'unknown' }, ['crash-fact']); process.exit(17);
} else if (stage === 'promotion') {
  const versionId = resultId(await f.stage('root', { fallbackLabel: 'unknown', rules: [{ prefix: 'accept:', label: 'yes' }] }), 'versionId');
  const evaluationId = resultId(await f.evaluate(versionId, 'root'), 'evaluationId');
  const approvalId = resultId(await f.approve('root', versionId, evaluationId, { versionId: null, revision: 0 }), 'approvalId');
  await f.service.promote(f.command('promote-root', { approvalId })); process.exit(17);
} else throw Error('Unknown interruption boundary');
throw Error('Expected interruption did not occur');
