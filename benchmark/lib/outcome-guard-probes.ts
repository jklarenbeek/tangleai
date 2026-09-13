/** Adversaries exercise the supported service after a separate checked replay. */
import { createOutcomeService, scopeIdOf } from '@tangleai/outcomes';
import { measureOutcomeReplay, resultId, resultValue } from './outcome-runtime.ts';
import { probe } from './outcome-conformance.ts';
import type { OutcomeFixtures } from './outcome-fixtures.ts';
import type { OutcomeService, OutcomeServiceOptions, PromoteCommand, Result, Json } from '@tangleai/outcomes';
const code = (result: Result) => result.ok ? null : result.issues[0].code;
type PromotionDispatch = (commands: PromoteCommand[], promote: (command: PromoteCommand) => Promise<Result>) => Promise<Result[]>;
export async function measureOutcomeGuards(f: OutcomeFixtures, options: { dispatch?: PromotionDispatch } = {}) {
  const captures: Array<{ service: OutcomeService; host: OutcomeServiceOptions }> = [];
  const conflicts: Array<string | null> = [];
  const measured = await measureOutcomeReplay(f, { mode: 'checked-scripted', async serviceFactory(host) {
    const service = await createOutcomeService(host); captures.push({ service, host }); let competed = false;
    let winningCommand: PromoteCommand | undefined, raceRequestKey: string | undefined;
    return { ...service, async promote(raw: unknown) {
      const c = raw as PromoteCommand;
      // This logical fixture step dispatches twenty distinct requests. Its
      // completed replay must follow the request that actually activated.
      if (winningCommand && c.requestKey === raceRequestKey) return service.promote(winningCommand);
      if (host.scope.domain !== 'exact-match' || competed) return service.promote(raw);
      competed = true;
      const a = resultValue(await service.inspect({ scopeId: c.scopeId, artifactKey: c.artifactKey, input: { id: c.input.approvalId } }));
      const approvals = [c.input.approvalId];
      for (let i = 1; i < 20; i++) approvals.push(resultId(await service.approve({ ...c, requestKey: `competing-approval:${i}`, input: { action: 'promote', versionId: a.versionId, evaluationId: a.evaluationId, expectedHead: a.expectedHead, reason: 'Separately reviewed fixture approval.' } }), 'approvalId'));
      const commands = approvals.map((approvalId, i) => ({ ...c, requestKey: i === 0 ? c.requestKey : `competing-promotion:${i}`, input: { approvalId } }));
      const results = await (options.dispatch ?? ((commands, promote) => Promise.all(commands.map(promote))))(commands, service.promote);
      const winners = results.flatMap((result, index) => result.ok ? [index] : []);
      if (results.length !== commands.length || winners.length !== 1 || results.filter(result => code(result) === 'OUTC1013').length !== 19)
        throw Error('Promotion race requires exactly one winner and nineteen stale-head refusals.');
      winningCommand = commands[winners[0]]; raceRequestKey = c.requestKey;
      conflicts.push(...results.map(code)); return results[winners[0]];
    } };
  } });
  const capture = captures.find(c => c.host.scope.domain === 'exact-match')!, { service, host } = capture;
  const scopeId = await scopeIdOf(host.scope), at = '2026-01-05T00:00:00.000Z';
  const command = (requestKey: string, input: object) => ({ scopeId, artifactKey: 'policy', requestKey, at, input });
  const records = measured.trace.records as Array<Record<string, Json>>;
  const owned = records.filter(r => r.scopeId === scopeId), head = resultValue(await service.injectChecked({ scopeId, artifactKey: 'policy', input: {} }));
  const scoreId = owned.find(r => r.kind === 'score')!.id as string;
  const negative = owned.find(r => r.kind === 'evaluation' && r.eligible === false)!;
  const pending = owned.find(r => r.kind === 'decision' && typeof r.decisionKey === 'string' && r.decisionKey.endsWith('/4'))!;
  const version = owned.find(r => r.kind === 'artifactVersion' && r.id !== head.versionId)!;
  const configuration = owned.find(r => r.kind === 'decision')!.configuration;
  const badParent = await service.reflect(command('stale-parent', { mode: 'evolve', scoreIds: [scoreId], parentVersionId: version.id, payload: null, patch: [], text: 'Stale parent probe.', citations: [scoreId], configuration }));
  const foreign = await service.inspect({ scopeId: 'a'.repeat(64), artifactKey: 'policy', input: { id: scoreId } });
  const untrusted = await createOutcomeService({ ...host, principal: { ...host.principal!, approve: false, reconcile: false } });
  const forged = await untrusted.approve(command('forged', { action: 'promote', versionId: negative.versionId, evaluationId: negative.id, expectedHead: head.head, reason: 'Model-written authority.' }));
  const regressing = await service.approve(command('regressing', { action: 'promote', versionId: negative.versionId, evaluationId: negative.id, expectedHead: head.head, reason: 'Regressing control.' }));
  const unmeasuredVersion = resultId(await service.reflect(command('unmeasured', { mode: 'evolve', scoreIds: [scoreId], parentVersionId: head.versionId, payload: null, patch: [{ op: 'replace', path: '/fallbackLabel', value: 'no' }], text: 'Unmeasured candidate probe.', citations: [scoreId], configuration })), 'versionId');
  const unmeasured = await service.approve(command('unmeasured-approval', { action: 'promote', versionId: unmeasuredVersion, evaluationId: 'b'.repeat(64), expectedHead: head.head, reason: 'Missing evaluation control.' }));
  return [
    probe('service-competing-promotions', [1, 19], [conflicts.filter(c => c === null).length, conflicts.filter(c => c === 'OUTC1013').length], 'promotion'),
    probe('service-pending-transition', 'OUTC1005', code(await service.score(command('pending', { resolutionId: pending.id }))), 'promotion'),
    probe('service-stale-parent', 'OUTC1013', code(badParent), 'promotion'),
    probe('service-cross-scope', 'OUTC1003', code(foreign), 'promotion'),
    probe('service-forged-approval', 'OUTC1012', code(forged), 'promotion'),
    probe('service-regressing-candidate', 'OUTC1011', code(regressing), 'promotion'),
    probe('service-unmeasured-candidate', 'OUTC1011', code(unmeasured), 'promotion'),
    probe('service-retained-history', [6, 3, 1], [measured.row.counts.versions, measured.row.counts.promotions, measured.row.counts.rollbacks], 'promotion'),
  ];
}
