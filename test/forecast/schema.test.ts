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
  it('the harness component bound measures UTF-8 exactly; the record shape refuses a lone surrogate or a non-string first', async () => {
    const { harnesses } = await makeForecastFixture();
    const seal = async (factorTracking: unknown) => { const document = { ...harnesses.document, factorTracking } as typeof harnesses.document; return sealForecastRecord('harnesses', { ...harnesses, document, digest: await forecastRevision(document) }); };
    // 2048 two-byte letters fill the 4096-byte component bound; one more byte crosses it with the bound's own refusal.
    assert.equal((await seal('é'.repeat(2048))).document.factorTracking.length, 2048);
    await assert.rejects(seal('é'.repeat(2048) + 'a'), (e: unknown) => shapeFailure(e) && (e as Error).message === 'Harness exceeds its canonical UTF-8 byte bound.');
    // An unpaired surrogate is not JSON data: the shape check refuses it before any byte is counted.
    const surrogate = { ...harnesses.document, factorTracking: '\uD800'.repeat(1366) };
    await assert.rejects(validateForecastRecord('harnesses', { ...harnesses, document: surrogate }), (e: unknown) => shapeFailure(e) && (e as Error).message === 'Only finite JSON data is accepted.');
    await assert.rejects(validateForecastRecord('harnesses', { ...harnesses, document: { ...harnesses.document, factorTracking: 5 } }), (e: unknown) => shapeFailure(e) && !/utf8ByteLength/.test((e as Error).message));
  });
  it('forecastBytes counts canonical UTF-8 and leaves a value that is not JSON data to canonicalization', () => {
    assert.equal(forecastBytes({ a: 'é' }), 10); assert.equal(forecastBytes('\u{1F642}'), 6);
    assert.throws(() => forecastBytes({ a: '\uD800' }), (e: unknown) => (e as { code?: string }).code === 'JO2007' && !/utf8ByteLength/.test((e as Error).message));
    assert.throws(() => forecastBytes(undefined), (e: unknown) => !/utf8ByteLength/.test((e as Error).message));
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
