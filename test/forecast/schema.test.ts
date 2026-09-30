import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FORECAST_TABLES, FORECAST_RECORD_SCHEMAS, checkShape, validateForecastRecord, sealForecastRecord, ForecastRefusal, forecastRevision, forecastBytes } from '@tangleai/forecast';
import { makeForecastFixture } from './fixtures.ts';
const shapeFailure = (error: unknown) => error instanceof ForecastRefusal && error.code === 'TFCT1001';

describe('closed forecasting records', () => {
  it('refuses extra members on every record shape', async () => {
    const f = await makeForecastFixture();
    for (const table of FORECAST_TABLES) {
      assert.deepEqual(await validateForecastRecord(table, f[table]), f[table]);
      assert.throws(() => checkShape(FORECAST_RECORD_SCHEMAS[table], { ...f[table], privileged: true }), shapeFailure, table);
    }
  });
  it('notes cannot carry comparison, revision or outcome members', async () => {
    const { notes } = await makeForecastFixture();
    for (const key of ['comparison', 'revision', 'outcome']) assert.throws(() => checkShape('checkpointNote', { ...notes, [key]: 'leak' }), shapeFailure);
    assert.throws(() => checkShape('checkpointNote', { ...notes, sections: { ...notes.sections, verdict: 'promote' } }), shapeFailure);
  });
  it('a harness has exactly three named components and enforces UTF-8 bounds', async () => {
    const { harnesses } = await makeForecastFixture();
    assert.throws(() => checkShape('harnessDocument', { ...harnesses.document, tools: ['write'] }), shapeFailure);
    const document = { ...harnesses.document, factorTracking: '🙂'.repeat(2000) };
    await assert.rejects(sealForecastRecord('harnesses', { ...harnesses, document, digest: await forecastRevision(document) }), shapeFailure);
    assert.throws(() => checkShape('harnessDocument', { ...harnesses.document, factorTracking: ' ' }), shapeFailure);
  });
  it('refuses empty scopes, non-normalized instants, impossible dates and nonfinite JSON', async () => {
    const f = await makeForecastFixture();
    for (const change of [{ scopeKey: '' }, { issuedAt: '2025-01-01T00:00:00Z' }, { issuedAt: '2025-02-30T00:00:00.000Z' }]) await assert.rejects(sealForecastRecord('questions', { ...f.questions, ...change }), shapeFailure);
    await assert.rejects(sealForecastRecord('predictions', { ...f.predictions, normalized: Infinity }), shapeFailure);
    assert.throws(() => checkShape('json', { v: undefined }), shapeFailure);
  });
  it('seals immutable inputs, rejects changed identities and detaches caller objects', async () => {
    const { questions } = await makeForecastFixture();
    await assert.rejects(validateForecastRecord('questions', { ...questions, scopeKey: 'other' }), (e: unknown) => e instanceof ForecastRefusal && e.code === 'TFCT1002');
    const raw = structuredClone(questions), value = await validateForecastRecord('questions', raw); raw.prompt = 'changed';
    assert.notEqual(value.prompt, raw.prompt); assert.ok(Object.isFrozen(value.checkpointPolicy));
  });
  it('retains unknown usage as null and refuses impossible lifecycle artifacts', async () => {
    const { checkpoints } = await makeForecastFixture();
    for (const patch of [{ spend: { calls: 0, tokens: 0, ms: 0, usageKnown: false } }, { status: 'finalized' as const }, { cutoffAt: '2025-01-11T00:00:00.000Z' }])
      await assert.rejects(sealForecastRecord('checkpoints', { ...checkpoints, ...patch }), ForecastRefusal);
  });
  it('bounds retained trace bytes and rejects a false length', async () => {
    const { traces } = await makeForecastFixture();
    await assert.rejects(sealForecastRecord('traces', { ...traces, bytes: 0 }), shapeFailure);
    const trace = { messages: ['a'.repeat(262144)], steps: [] };
    await assert.rejects(sealForecastRecord('traces', { ...traces, ...trace, bytes: forecastBytes(trace) }), shapeFailure);
  });
});
