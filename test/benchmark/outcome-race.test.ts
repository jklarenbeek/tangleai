import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadOutcomeFixtures } from '../../benchmark/lib/outcome-fixtures.ts';
import { measureOutcomeGuards } from '../../benchmark/lib/outcome-guard-probes.ts';

test('outcome race follows and freely replays the actual winner when contender zero loses', async () => {
  const probes = await measureOutcomeGuards(await loadOutcomeFixtures(), { async dispatch(commands, promote) {
    assert.equal(commands.length, 20);
    // A real nonzero contender commits before the remaining nineteen start.
    // Promise.all still returns results in input order, as in normal execution.
    const winner = await promote(commands[7]);
    assert.equal(winner.ok, true);
    const results = await Promise.all(commands.map((command, index) => index === 7 ? winner : promote(command)));
    assert.equal(results[0].ok, false);
    return results;
  } });
  assert.ok(probes.every(probe => probe.holds));
});

test('outcome race rejects missing, multiple, absent and unrelated winner outcomes', async () => {
  const fixtures = await loadOutcomeFixtures();
  for (const fault of ['missing', 'multiple', 'absent', 'unrelated'] as const) {
    await assert.rejects(() => measureOutcomeGuards(fixtures, { async dispatch(commands, promote) {
      const winner = await promote(commands[0]);
      const results = [winner, ...await Promise.all(commands.slice(1).map(promote))];
      if (fault === 'missing') results.pop();
      if (fault === 'multiple') results[1] = winner;
      if (fault === 'absent') results[0] = results[1];
      if (fault === 'unrelated') results[1] = { ok: false, issues: [{ code: 'OUTC1001', path: '', detail: 'Injected unrelated refusal.', retryable: false }] };
      return results;
    } }), /exactly one winner and nineteen stale-head refusals/, fault);
  }
});
