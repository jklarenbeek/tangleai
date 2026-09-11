/** Published paid evidence validates offline, including in a clone without datasets. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createGroundingValidator, renderGroundingMarkdown } from '../../benchmark/lib/grounding.ts';
import { renderMarkdown, type LiveReport } from '../../benchmark/lib/locomo-qa.ts';
import { summarizePaidRefresh } from '../../benchmark/lib/paid-refresh.ts';
import { summarizeHorizonFix, renderHorizonFix } from '../../benchmark/lib/horizon-summary.ts';
import { createReportValidator } from '../../benchmark/lib/validate.ts';
import RECALL_SCHEMA from '../../benchmark/schemas/locomo-recall.schema.json' with { type: 'json' };
import QA_SCHEMA from '../../benchmark/schemas/locomo-qa.schema.json' with { type: 'json' };
import LIVE_SCHEMA from '../../benchmark/schemas/locomo-qa-live.schema.json' with { type: 'json' };
import IDENTITY_SCHEMA from '../../packages/config/schemas/run-identity.schema.json' with { type: 'json' };

const read = async (name: string) => JSON.parse(await readFile(`benchmark/results/${name}.json`, 'utf8'));

describe('the dated paid refresh', () => {
  it('keeps the previous attempt immutable and derives the repaired agent comparison', async () => {
    const before = await read('locomo-qa-live-jaren-0832');
    const after = await read('locomo-qa-live-horizon-fixed');
    const audit = await read('horizon-answer-audit');
    assert.equal(audit.sourceSha256, await canonicalSha256(before));
    assert.equal(audit.modelNetworkRequests, 0);
    assert.equal(audit.nonemptyCitedAnswers, audit.questions.filter((row: any) => row.programCompleted && row.extractedAnswerChars > 0 && row.citations.length > 0).length);
    assert.equal(createReportValidator(LIVE_SCHEMA, [RECALL_SCHEMA, QA_SCHEMA, IDENTITY_SCHEMA])(after).valid, true);
    const bounded = summarizeHorizonFix(before, after, audit);
    assert.deepEqual((await read('jaren-integration')).bounded, bounded);
    assert.equal(await readFile('docs/BOUNDED_AGENT_BENCHMARK.md', 'utf8'), renderHorizonFix(bounded));
    const row = after.configurations.find((entry: any) => entry.kind === 'long-horizon');
    for (const entry of row.horizon.diagnostics) {
      assert.ok(entry.calls <= row.horizon.turnsPerQuestion);
      assert.ok(entry.visitedPieces <= row.horizon.maxSubcalls);
      assert.ok(entry.visitedChars <= entry.corpusChars);
    }
    assert.equal(row.questions.results.filter((entry: any) => entry.outcome === 'answered').length, bounded.current.valid);
  });
  it('validates both reports and renders their complete published tables without model calls', async () => {
    const qa: LiveReport = await read('locomo-qa-live-jaren-0832');
    const grounding = await read('grounding-live-jaren-0832');
    const validateQa = createReportValidator(LIVE_SCHEMA, [RECALL_SCHEMA, QA_SCHEMA, IDENTITY_SCHEMA]);
    assert.equal(validateQa(qa).valid, true, JSON.stringify(validateQa(qa).errors));
    const validateGrounding = createGroundingValidator();
    assert.equal(validateGrounding(grounding).valid, true, JSON.stringify(validateGrounding(grounding).errors));
    assert.equal(await readFile('docs/LOCOMO_REFRESH.md', 'utf8'), `${renderMarkdown(await read('locomo-qa'), qa)}\n`);
    assert.equal(await readFile('docs/GROUNDING_REFRESH.md', 'utf8'), `${renderGroundingMarkdown(await read('grounding'), grounding)}\n`);
    assert.deepEqual(qa.sample, (await read('locomo-qa')).sample, 'the dated table keeps the registered question sample');
    assert.equal(qa.configurations.length, 6, 'every registered strategy is published, including losses or failed answers');
    assert.ok(qa.runs.every((run) => run.plan.skipped === null && run.plan.planned <= run.plan.maxCalls));
  });

  it('derives the website summary from the raw attempts and the actual desktop smoke', async () => {
    const summary = await read('jaren-integration');
    assert.deepEqual(summary.paid, summarizePaidRefresh(await read('locomo-qa-live-jaren-0832'), await read('grounding-live-jaren-0832')));
    const smoke = await read('documents-live-jaren-0832');
    assert.deepEqual(summary.smoke, smoke);
    assert.equal(smoke.jaren, summary.jaren);
    assert.equal(smoke.ok, true);
    assert.ok(smoke.chunks > 0 && smoke.embeddingCalls > 0 && smoke.citations > 0);
    const masSmoke = await read('mas-live-jaren-0832');
    assert.deepEqual(summary.masSmoke, masSmoke);
    assert.equal(masSmoke.jaren, summary.jaren);
    assert.equal(masSmoke.status, 'completed');
    assert.equal(masSmoke.completedSegments, 2);
    assert.deepEqual([...masSmoke.completedInvocations].sort(), ['apply', 'drafter', 'review']);
    const receipt = await read('locomo-telemetry-replay-jaren-0832');
    const qa = await read('locomo-qa-live-jaren-0832');
    assert.equal(receipt.modelNetworkRequests, 0);
    assert.equal(receipt.scoresCoverageUsageUnchanged, true);
    assert.equal(await canonicalSha256(qa), receipt.correctedSha256);
    const row = qa.configurations.find((row: LiveReport['configurations'][number]) => row.kind === 'long-horizon');
    const horizon = row.horizon;
    assert.deepEqual(horizon.subcalls, receipt.countsAfter);
    horizon.subcalls = receipt.countsBefore;
    horizon.stops = receipt.stopsBefore;
    row.questions.results.forEach((result: object, index: number) => Object.assign(result, receipt.questionTelemetryBefore[index]));
    assert.equal(await canonicalSha256(qa), receipt.originalSha256, 'the original paid attempt is exactly recoverable from the telemetry receipt');
  });
});
