import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileGmplPromptPack, renderGmplPrompt, validateGmplPromptArtifact } from '@tangleai/gmpl';
import { researchArtifacts, RESEARCH_PROMPT_NAMES, researchProposalSchema } from '@tangleai/research';
import { researchPromptVariables, RESEARCH_NATIVE_PROMPTS } from '../../packages/research/src/prompt-contracts.ts';
import { reasoningFixture } from './reasoning-fixtures.ts';

for (const name of RESEARCH_PROMPT_NAMES) it(`research ${name} renders minimal and full variables through its immutable source artifact`, async () => {
  const artifact = researchArtifacts.prompts.find(row => row.id === 'research-' + name)!;
  assert.ok((await validateGmplPromptArtifact(artifact)).valid);
  const compiled = await compileGmplPromptPack(await readFile(`prompts/research/${name}.toml`, 'utf8'),
    { variables: researchPromptVariables(name), outputSchema: researchProposalSchema(name) });
  assert.ok(compiled.valid, JSON.stringify(compiled)); assert.deepEqual(compiled.value, artifact);
  if (name === 'writer') {
    const rendered = renderGmplPrompt(artifact, { ledger_id: 'ledger-literal-{{cards}}' });
    assert.ok(rendered.valid, JSON.stringify(rendered)); assert.ok(rendered.value.user.includes('ledger-literal-{{cards}}'));
    assert.equal(renderGmplPrompt(artifact, { ledger_id: 'ledger', hidden: 'undeclared' }).valid, false); return;
  }
  const question = 'Literal {{cards}} and $query remain data.';
  const minimal = renderGmplPrompt(artifact, { question, cards: [] });
  assert.ok(minimal.valid, JSON.stringify(minimal)); assert.ok(minimal.value.user.includes(question));
  assert.ok(!minimal.value.user.includes('Declared constraints:'));
  const f = await reasoningFixture();
  const full = renderGmplPrompt(artifact, { question, cards: [{ id: f.cards[0].id, digest: f.cards[0].contentHash, text: f.cards[0].excerpt }],
    synthesis: name === 'designer' ? f.hypotheses : f.synthesis,
    constraints: { baselineIds: ['control'], metrics: f.bounds.contract.metrics, inputPaths: f.bounds.plan.inputPaths, budget: f.bounds.budget } });
  assert.ok(full.valid, JSON.stringify(full)); assert.ok(full.value.user.includes(name.startsWith('result-') || ['critic', 'attacker', 'defender', 'judge'].includes(name) ? 'Review context:' : 'Declared constraints:'));
  assert.ok(full.value.user.includes(f.cards[0].id)); assert.ok(full.value.user.includes('control'));
  assert.equal(full.value.system, artifact.pack.system.content);
  assert.equal(renderGmplPrompt(artifact, { question, cards: [], hidden: 'undeclared input' }).valid, false);
});
it('each native research binding retains its source role instructions and uses the declared native schema', () => {
  const native = researchArtifacts.prompts.filter(prompt => RESEARCH_PROMPT_NAMES.some(name => prompt.id.startsWith(`research-${name}-`)));
  assert.equal(native.length, RESEARCH_NATIVE_PROMPTS.length);
  for (const artifact of native) {
    const base = researchArtifacts.prompts.find(prompt => RESEARCH_PROMPT_NAMES.some(name => prompt.id === 'research-' + name) && artifact.id.startsWith(prompt.id + '-'))!;
    assert.ok(artifact.pack.system.content.startsWith(base.pack.system.content));
    assert.ok(artifact.pack.system.content.includes(['research-critic', 'research-attacker', 'research-defender', 'research-judge'].includes(base.id)
      ? 'advisory assessment' : artifact.pack.meta.pattern === 'peer-review' ? 'advisory prose' : 'Proposal schema:'));
    assert.deepEqual(Object.keys(artifact.variables).sort(), ['context', 'evidence', 'query']);
    assert.notEqual(artifact.sourceDigest, base.sourceDigest);
  }
});
