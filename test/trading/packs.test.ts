import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { compileGmplPromptPack, renderGmplPrompt, validateGmplPromptArtifact, gmplArtifacts } from '@tangleai/gmpl';
import { tradingArtifacts, validateTradingShape, tradingSchemaOf } from '@tangleai/trading';
import catalog from '@tangleai/trading/artifacts' with { type: 'json' };
import fixtures from '../fixtures/trading-prompts.json' with { type: 'json' };
import { tradingPromptFiles } from '../../scripts/trading-sources.ts';

describe('immutable trading prompt packs', () => {
  it('ships twelve compiler-owned artifacts and leaves the GMPL catalog intact', async () => {
    assert.deepEqual(catalog, tradingArtifacts); assert.equal(tradingArtifacts.prompts.length, 12);
    assert.deepEqual(tradingArtifacts.domains, []); assert.deepEqual(tradingArtifacts.recipes, []);
    assert.equal(gmplArtifacts.revision, 'fcd08dd3306f267d5719d79b3d832aecd42cb0aaa0aa7de66cb257460fb815ef');
    for (const path of tradingPromptFiles()) {
      const source = await readFile(path, 'utf8'); assert.doesNotMatch(source, /AAPL|outcome_history/);
      const artifact = tradingArtifacts.prompts.find(a => source.includes(`id = "${a.id}"`))!; assert.ok(artifact);
      assert.doesNotMatch(artifact.role.instructions, /\d|\{\{/);
      const compiled = await compileGmplPromptPack(source, { variables: artifact.variables, outputSchema: artifact.outputSchema });
      assert.ok(compiled.valid); assert.deepEqual(compiled.value, artifact); assert.ok((await validateGmplPromptArtifact(artifact)).valid);
    }
    for (const file of ['debate', 'research']) await assert.rejects(access(`prompts/trading/${file}.toml`));
  });
  for (const fixture of fixtures) it(`${fixture.id} ${fixture.mode} render is pinned and substituted data stays literal`, () => {
    const artifact = tradingArtifacts.prompts.find(a => a.id === fixture.id)!;
    const rendered = renderGmplPrompt(artifact, fixture.variables); assert.ok(rendered.valid, JSON.stringify(rendered));
    assert.deepEqual(rendered.value, fixture.expected);
    if (fixture.mode === 'full') { assert.match(rendered.value.user, /\{\{literal\}\}/); assert.match(rendered.value.user, /\$query/); }
  });
  it('the render census covers minimal and full input for every pack exactly once', () => {
    assert.equal(fixtures.length, 24); assert.equal(new Set(fixtures.map(f => f.id + '/' + f.mode)).size, 24);
    assert.deepEqual([...new Set(fixtures.map(f => f.id))].sort(), tradingArtifacts.prompts.map(a => a.id).sort());
  });
  it('model schemas omit unrelated execution and accounting definitions', () => {
    for (const name of ['analystReportOutput', 'tradeProposalOutput', 'riskTurnOutput', 'riskVerdictOutput', 'fundManagerOutput'] as const) {
      const schema = JSON.stringify(tradingSchemaOf(name)); assert.doesNotMatch(schema, /tradingCommitMarker|ledgerEntry|tradingRunManifest/);
    }
  });
  it('role output schemas require citations, closed fields and executable proposal shape', () => {
    const citations = [{ id: 'synthetic-artifact', digest: '0'.repeat(64) }];
    const base = { action: 'buy', quantity: 1, timing: 'next-open', horizon: 'Next session', rationale: 'Synthetic', citations, assumedPortfolioId: 'synthetic-portfolio' };
    assert.ok(validateTradingShape('tradeProposalOutput', base).valid);
    assert.ok(validateTradingShape('tradeProposalOutput', { ...base, action: 'hold', quantity: undefined }).valid === false);
    const { quantity: _quantity, ...withoutSize } = base;
    for (const invalid of [withoutSize, { ...base, targetWeight: 0.5 }, { ...base, timing: 'same-close' }, { ...base, quantity: 0 }, { ...base, citations: [] }, { ...base, extra: true }])
      assert.equal(validateTradingShape('tradeProposalOutput', invalid).valid, false, JSON.stringify(invalid));
    assert.ok(validateTradingShape('tradeProposalOutput', { ...withoutSize, action: 'hold' }).valid);
    assert.ok(validateTradingShape('tradeProposalOutput', { ...withoutSize, targetWeight: 0.25 }).valid);
    const rejected = { decision: 'rejected', finalIntent: { action: 'hold' }, reasons: ['Synthetic rejection'], citations, inputProposalId: 'synthetic-proposal', inputRiskVerdictId: 'synthetic-verdict' };
    assert.ok(validateTradingShape('fundManagerOutput', rejected).valid);
    assert.equal(validateTradingShape('fundManagerOutput', { ...rejected, finalIntent: { action: 'buy', quantity: 1 } }).valid, false);
  });
});
