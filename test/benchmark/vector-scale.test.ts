import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createReportValidator } from '../../benchmark/lib/validate.ts';
import { measureVectorScale, validateVectorScale, loadVectorTrigger, renderVectorScale, vectorScaleSource, vectorDecision } from '../../benchmark/lib/vector-scale.ts';
import schema from '../../benchmark/schemas/vector-scale.schema.json' with { type: 'json' };

it('registered size assertions accept the complete ordered ladder and refuse incomplete or reordered sequences', () => {
  const reportSizes=createReportValidator(schema.$defs.VectorScaleReport.allOf[0].then);
  const receiptSizes=createReportValidator({$query:schema.$defs.VectorScaleReceipt.$query.$and[1]});
  for(const sizes of [[100,1000,10000],[],[100],[100,1000],[1000,100,10000],[100,1000,10000,10000],[100,1000,20000]]) {
    const complete=JSON.stringify(sizes)==='[100,1000,10000]';
    assert.equal(reportSizes({rows:sizes.map(chunks=>({chunks}))}).valid,complete,'Report sizes '+sizes);
    const rows=sizes.flatMap(chunks=>['resident','sqlite-sweep','sqlite-native'].map(backend=>({chunks,backend})));
    assert.equal(receiptSizes({rows,gates:{completeLadder:true}}).valid,complete,'Receipt sizes '+sizes);
    assert.equal(receiptSizes({rows,gates:{completeLadder:false}}).valid,!complete,'Receipt completeness must agree with all native rows.');
  }
});

it('graph evidence is clock independent, reconciles actual reads and refuses forged costs or parity', async () => {
  const original = globalThis.fetch; let physicalRequests = 0;
  globalThis.fetch = async () => { physicalRequests++; throw new Error('No network in the graph control.'); };
  try {
    const first = await measureVectorScale({ sizes: [2], physicalRequests: () => physicalRequests });
    const second = await measureVectorScale({ sizes: [2], physicalRequests: () => physicalRequests });
    assert.deepEqual(second.report, first.report);
    assert.notEqual(second.receipt.receiptId, first.receipt.receiptId);
    assert.equal(first.report.status, 'probe'); assert.equal(first.receipt.decision, 'not-applicable');
    assert.equal(physicalRequests, 0);
    const sql = first.receipt.rows.find(row => row.backend === 'sqlite-sweep')!;
    assert.equal(sql.samples.length, 18);
    assert.ok(sql.samples.every(row => row.sql.lightrag_entities!.returnedRows >= 4 && row.sql.lightrag_relations!.returnedRows >= 2));
    assert.ok(first.receipt.costs[0].sql.document_chunks!.writes > 0);
    assert.match(renderVectorScale(first.report, first.receipt), /parity-passed/);
    assert.equal(first.report.qualification.retrievalCases, 216);
    assert.ok(first.receipt.rows.filter(row => row.backend === 'sqlite-native').every(row => row.samples.every(sample => sample.native!.diverted === 0)));
    assert.equal(first.receipt.costs[0].staging.staged, 1);
    const validate = createReportValidator(schema);
    // Authored schema cases derived from the tiny real probe, never published as scale observations.
    const measured=structuredClone(first.report);measured.status='measured';
    measured.rows=[100,1000,10000].map(chunks=>({...structuredClone(first.report.rows[0]),chunks,entities:chunks*2,relations:chunks,claims:chunks*3}));
    assert.equal(validate(measured).valid,true,'The whole report schema must accept a complete measured ladder.');
    const observation=structuredClone(first.receipt);
    observation.rows=measured.rows.flatMap(({chunks})=>first.receipt.rows.map(row=>({...structuredClone(row),chunks})));
    observation.costs=measured.rows.map(({chunks})=>({...structuredClone(first.receipt.costs[0]),chunks}));
    for(const ms of [100,500]) {
      for(const row of observation.rows)if(row.backend==='sqlite-native'&&row.chunks===10000) {
        row.p50Ms=ms;row.p95Ms=ms;for(const sample of row.samples)sample.totalMs=ms;
      }
      Object.assign(observation,vectorDecision(measured,observation.rows,observation.costs));
      assert.equal(observation.gates.completeLadder,true);assert.equal(observation.gates.latency,ms<=250);
      assert.equal(observation.decision,ms<=250?'keep-native':'restore-sweep');
      assert.equal(validate(observation).valid,true,'The whole receipt schema must accept the derived measured decision.');
      const reversed=structuredClone(observation);reversed.rows.reverse();
      assert.equal(validate(reversed).valid,false,'An incorrect native size order cannot claim a complete ladder.');
    }
    const forgedDecision = structuredClone(first.receipt);
    forgedDecision.gates.latency = true;
    assert.equal(validate(forgedDecision).valid, false, 'The schema derives latency from the actual native 10,000-chunk row.');
    for (const change of [
      (r: typeof first.report) => { r.rows[0].entities++; },
      (r: typeof first.report) => { r.rows[0].questions[1].questionId = r.rows[0].questions[0].questionId; },
      (r: typeof first.report) => { r.rows[0].questions[0].parity.differences++; },
      (r: typeof first.report) => { r.controls.randomOverlap = 100; },
      (r: typeof first.report) => { r.status = 'measured'; },
    ]) {
      const changed = structuredClone(first.report); change(changed);
      assert.equal(validate(changed).valid, false);
    }
    for (const change of [
      (r: typeof first.receipt) => { r.rows[0].p95Ms++; },
      (r: typeof first.receipt) => { r.rows[1].samples[0].sql.lightrag_entities!.returnedRows = 0; },
      (r: typeof first.receipt) => { r.rows[1].samples[0].sql.lightrag_entities!.failures++; },
      (r: typeof first.receipt) => { r.costs = []; },
      (r: typeof first.receipt) => { r.decision = 'keep-native'; },
    ]) {
      const changed = structuredClone(first.receipt); change(changed);
      const { receiptId: _id, ...body } = changed; changed.receiptId = await canonicalSha256(body);
      await assert.rejects(validateVectorScale(first.report, changed));
    }
  } finally { globalThis.fetch = original; }
});

it('a missing released graph trigger is an explicit refusal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tangle-vector-missing-'));
  try { await assert.rejects(loadVectorTrigger(directory), { code: 'TVEC1006' }); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

it('the published graph decision reconciles the complete ladder, current source and generated document', async () => {
  const report = JSON.parse(await readFile('benchmark/results/vector-scale.json', 'utf8'));
  const receipt = JSON.parse(await readFile('benchmark/receipts/vector-scale-graph.json', 'utf8'));
  await validateVectorScale(report, receipt);
  assert.equal(report.status, 'measured');
  assert.deepEqual(report.source, await vectorScaleSource());
  assert.deepEqual(report.trigger, await loadVectorTrigger());
  assert.equal(await readFile('docs/VECTOR_SCALE.md', 'utf8'), renderVectorScale(report, receipt));
});
