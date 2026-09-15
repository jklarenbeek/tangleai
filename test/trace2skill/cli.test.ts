/**
 * The non-interactive driver.
 *
 * What a CLI can get wrong here is not the arithmetic — the run owns that —
 * but what it lets out: a credential, a whole trajectory, or a live request
 * nobody approved. So the tests read the lines it produced rather than its
 * exit code alone, and the live path runs under a network trap that turns any
 * request at all into a failure.
 */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { draftS0, renderSkillScope, trace2SkillPrompt, type Trace2SkillOutcome } from '@tangleai/trace2skill';
import { runTrace2SkillCli } from '../../benchmark/lib/trace2skill-cli.ts';
import { loadTrace2SkillFixture } from '../../benchmark/lib/trace2skill-fixture.ts';
import { createScriptedChatClient, createScriptedWire, draftUnit, scriptUnitKey } from '../../benchmark/lib/trace2skill-script.ts';
import report from '../../benchmark/results/trace2skill.json' with { type: 'json' };

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FAKE_KEY = 'sk-not-a-real-key-0000';

const must = <T>(outcome: Trace2SkillOutcome<T>): T => {
  if (!outcome.valid) throw new Error(JSON.stringify(outcome.issues));
  return outcome.value;
};

async function cli(argv: readonly string[], env?: Record<string, string | undefined>): Promise<{ code: number, lines: string[] }> {
  const lines: string[] = [];
  const result = await runTrace2SkillCli(argv, { write: (line) => { lines.push(line); }, ...(env === undefined ? {} : { env }) });
  assert.deepEqual(result.lines, lines, 'the host saw different lines than the result carried');
  return { code: result.code, lines };
}

const line = (lines: readonly string[], prefix: string): string => {
  const found = lines.find((entry) => entry.startsWith(prefix));
  assert.ok(found !== undefined, `no line starting with '${prefix}' in:\n${lines.join('\n')}`);
  return found;
};

it('one keyless command completes both fixture modes and stages the committed candidate', async () => {
  const deepening = await cli(['run', '--mode', 'deepening']);
  assert.equal(deepening.code, 0, deepening.lines.join('\n'));
  assert.equal(line(deepening.lines, 'candidate '), `candidate ${String(report.consolidation.candidateId)}`);
  assert.equal(line(deepening.lines, 'directory '), `directory ${String(report.consolidation.bundleId)}`);
  assert.ok(line(deepening.lines, 'evaluation ').includes('eligible true'));
  assert.equal(line(deepening.lines, 'rollouts '), 'rollouts 16; labels success 10, failure 5, unanswered 1');

  const creation = await cli(['run', '--mode', 'creation']);
  assert.equal(creation.code, 0, creation.lines.join('\n'));
  // The corpus registers no creation trajectory, so the mode honestly stages
  // nothing; the committed report's creation table says the same.
  assert.equal(line(creation.lines, 'candidate '), 'candidate none');
  assert.ok(line(creation.lines, 'run ').includes('starting condition draft-s0'));
  const creationRow = report.tables.creation.find((row) => row.condition === 'evolved-s-star');
  assert.equal(creationRow?.status, 'not-run');
  assert.match(String(creationRow?.reason), /registers no creation evolve trajectory/);
});

it('creation\'s draft predates every task and its request digest is the pack and the scope', async () => {
  const loaded = await loadTrace2SkillFixture();
  const inspected = await cli(['inspect', '--mode', 'creation']);
  assert.equal(inspected.code, 0);
  assert.ok(line(inspected.lines, 'starting directory ').includes('condition draft-s0 origin parametric-draft'));
  assert.equal(inspected.lines.filter((entry) => entry.startsWith('rollout ')).length, 0);

  // The unit the wire is asked for names no task, no condition and no group:
  // there is no member through which task data could reach the draft.
  const unit = draftUnit();
  assert.equal(unit.taskId, null);
  assert.equal(unit.condition, null);
  assert.equal(unit.groupId, null);
  const key = await scriptUnitKey(unit);
  for (const taskId of [...loaded.splits.evolve, ...loaded.splits.test]) assert.ok(!key.includes(taskId));

  const scope = {
    scopeKey: loaded.scope.scopeKey, description: loaded.scope.description,
    tools: loaded.scope.tools.map((tool) => ({ name: tool.name, description: tool.description })),
    answerShape: loaded.scope.answerShape,
  };
  const wire = await createScriptedWire(loaded.script);
  const client = createScriptedChatClient(wire, unit, { tokensPerTurn: loaded.labels.tokensPerTurn, draftTitle: scope.scopeKey });
  const drafted = must(await draftS0(client, scope));
  const expected = await canonicalSha256([
    { role: 'system', content: trace2SkillPrompt('draft').pack.system.content },
    { role: 'user', content: renderSkillScope(scope) },
  ]);
  assert.equal(drafted.requestDigest, expected, 'the draft request is not exactly the pack and the scope');
  for (const taskId of [...loaded.splits.evolve, ...loaded.splits.test]) {
    assert.ok(!drafted.requestText.includes(taskId), `the draft request names ${taskId}`);
  }
  for (const task of loaded.tasks) {
    for (const input of task.inputs) assert.ok(!drafted.requestText.includes(input), `the draft request names ${input}`);
  }
});

it('inspection reconstructs every result by id and prints no transcript', async () => {
  const inspected = await cli(['inspect', '--mode', 'deepening']);
  assert.equal(inspected.code, 0);
  const counted = (prefix: string): number => inspected.lines.filter((entry) => entry.startsWith(prefix)).length;
  assert.equal(counted('rollout '), 16);
  assert.equal(counted('analysis '), 16);
  assert.equal(counted('merge '), 3);
  assert.ok(line(inspected.lines, 'candidate ').includes(String(report.consolidation.candidateId)));
  assert.ok(line(inspected.lines, 'evaluation ').includes('eligible true'));
  assert.ok(line(inspected.lines, 'head ').endsWith(':1'), 'a run activated a head by finishing');

  const body = inspected.lines.join('\n');
  assert.ok(!body.includes(FAKE_KEY) && !body.includes('OPENROUTER_AI_KEY'), 'a credential reached the output');
  // A trajectory is addressed, not printed: no transcript body and no line
  // longer than one bounded excerpt plus its identifiers.
  assert.ok(!body.includes('Transcript:') && !body.includes('Final answer:'), 'a stored transcript reached the output');
  // Identifiers are fixed width and an excerpt is capped, so every line has a
  // ceiling: three ids and their labels are the longest thing a row can be.
  for (const entry of inspected.lines) assert.ok(entry.length <= 224, `an unbounded line reached the output: ${entry.slice(0, 80)}…`);
});

it('the plan, the diff and the verdict read what the run stored', async () => {
  const planned = await cli(['plan']);
  assert.equal(planned.code, 0);
  assert.ok(line(planned.lines, 'mode ').includes('13 stages'));
  assert.equal(planned.lines.filter((entry) => entry.startsWith('prompt ')).length, 5);
  assert.equal(line(planned.lines, 'legacy packs '), 'legacy packs kept as fixtures: analyst, injection, merger');

  const diffed = await cli(['diff', '--mode', 'deepening']);
  assert.equal(diffed.code, 0);
  const summary = report.consolidation.diffSummary;
  assert.equal(line(diffed.lines, 'files added '),
    `files added ${summary.filesAdded}; files changed ${summary.filesChanged}; lines +${summary.linesAdded} -${summary.linesRemoved}`);

  const evaluated = await cli(['evaluate', '--mode', 'deepening']);
  assert.equal(evaluated.code, 0);
  assert.ok(line(evaluated.lines, 'tasks ').includes(`meanDelta ${report.evaluation.meanDelta.toFixed(3)}`));

  const missing = await cli(['diff', '--mode', 'creation']);
  assert.equal(missing.code, 1, 'a mode that staged nothing reported success');
  assert.equal(line(missing.lines, 'candidate '), 'candidate none');
});

it('a resumed drive spends only what the interruption left, and activation is fenced', async () => {
  const resumed = await cli(['resume', '--mode', 'deepening', '--interrupt', '18']);
  assert.equal(resumed.code, 0, resumed.lines.join('\n'));
  assert.equal(line(resumed.lines, 'interrupted after '), 'interrupted after 18 call(s)');
  assert.equal(line(resumed.lines, 'resumed with '), 'resumed with 118 call(s); reused 18; written 54');
  assert.equal(line(resumed.lines, 'candidate '), `candidate ${String(report.consolidation.candidateId)}`);

  const head = `${String(report.evaluation.activations.previousVersionId)}:${report.evaluation.activations.previousRevision}`;
  const applied = await cli(['activate', '--mode', 'deepening', '--expected-head', head]);
  assert.equal(applied.code, 0, applied.lines.join('\n'));
  assert.equal(line(applied.lines, 'activation '),
    `activation activated; head ${String(report.evaluation.activations.versionId)}:${report.evaluation.activations.revision}`);

  const stale = await cli(['activate', '--mode', 'deepening', '--expected-head',
    `${String(report.evaluation.activations.previousVersionId)}:9`]);
  assert.equal(stale.code, 1);
  assert.ok(line(stale.lines, 'refused ').startsWith('refused TT2S1010'));
});

it('--live spends nothing: no key is a stated skip and a key is a frozen plan', async () => {
  const guarded = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('the live plan reached the network'); };
  try {
    const skipped = await cli(['run', '--live'], {});
    assert.equal(skipped.code, 1);
    assert.ok(line(skipped.lines, 'live skipped:').includes('OPENROUTER_AI_KEY'));
    assert.equal(skipped.lines.at(-1), 'nothing was spent and no request was made');

    const env = { OPENROUTER_AI_KEY: FAKE_KEY, TANGLE_AI_PROVIDER: 'openrouter', TANGLE_AI_MODEL: 'vendor/model' };
    const planned = await cli(['run', '--live'], env);
    assert.equal(planned.code, 1, 'a live run executed without an approval');
    const plan = line(planned.lines, 'live plan ');
    const id = plan.slice('live plan '.length);
    assert.match(id, /^[a-f0-9]{64}$/);
    const body = planned.lines.join('\n');
    assert.ok(!body.includes(FAKE_KEY), 'the key reached the output');
    assert.ok(body.includes('OPENROUTER_AI_KEY'), 'the output does not name where a key would come from');
    assert.equal(planned.lines.at(-1), 'nothing was spent and no request was made');

    // The plan is frozen: the same environment names the same plan twice.
    const again = await cli(['run', '--live'], env);
    assert.equal(line(again.lines, 'live plan '), plan);

    const wrong = await cli(['run', '--live', '--authorize', '0'.repeat(64)], env);
    assert.equal(wrong.code, 1);
    assert.ok(wrong.lines.some((entry) => entry.includes('which is not this plan')));

    const named = await cli(['run', '--live', '--authorize', id], env);
    assert.equal(named.code, 1, 'an authorized plan ran a live tier this build does not have');
    assert.equal(named.lines.at(-1), 'this build has no authorized live tier: nothing was spent and no request was made');
  }
  finally { globalThis.fetch = guarded; }
});

it('an unknown command, an unknown flag and a malformed head are refusals with usage', async () => {
  for (const argv of [[], ['evolve'], ['run', '--bogus'], ['run', '--mode', 'sideways'], ['run', 'extra']]) {
    const result = await cli(argv);
    assert.equal(result.code, 1, `${JSON.stringify(argv)} was accepted`);
    assert.ok(result.lines[0].startsWith('error: '), result.lines.join('\n'));
  }
  const head = await cli(['activate', '--mode', 'deepening', '--expected-head', 'nonsense']);
  assert.equal(head.code, 1);
  assert.ok(head.lines[0].includes('<versionId>:<revision>'));
});

it('the entry script drives the same commands from a foreign working directory', () => {
  const out = execFileSync(process.execPath, [`${ROOT}scripts/trace2skill.ts`, 'plan'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /^fixture [a-f0-9]{64}$/m);
  assert.equal(out.split('\n').filter((entry) => entry.startsWith('prompt ')).length, 5);
});
