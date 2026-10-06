import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nodeDriver } from '@jarenjs/db/node';
import { compileContract } from '@jarenjs/contract';
import { publicProjection } from '@jarenjs/contract/project';
import { diffContracts, isCompatible } from '@jarenjs/contract/diff';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createResearchStore, createOutcomeStore, asRows } from '@tangleai/store';
import { createDesktop, type Desktop } from '../../apps/desktop/src/server.ts';
import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';
import { readResearchReport, type ResearchReportInput } from '../../apps/desktop/src/research-report.ts';
import { lessonFixture, validationFixture } from '../research/lessons-store-fixtures.ts';
import { stored } from '../research/store-harness.ts';
import { lessonOutcomeFixture } from '../research/lessons-outcome-fixtures.ts';

export async function researchGet(desktop: Desktop, url: string) {
  const response = await desktop.dispatcher.dispatch({ method: 'GET', url, headers: {}, body: null });
  const bytes = typeof response.body === 'string' ? response.body : new TextDecoder().decode(response.body);
  return { status: response.status, json: JSON.parse(bytes) };
}
function provenance(value: any) {
  const names = new Set(value.provenance.map((row: any) => row.field));
  for (const key of Object.keys(value).filter(key => key !== 'provenance')) assert.ok(names.has(key), key);
  for (const ref of value.provenance) assert.ok(ref.recordId && typeof ref.path === 'string');
}
async function reportInput(): Promise<ResearchReportInput> {
  const bytes = await readFile('benchmark/results/research.json', 'utf8');
  return { bytes, sourceFiles: JSON.parse(bytes).source.files, expectedReportId: JSON.parse(bytes).reportId };
}

it('research reads retain project isolation, provenance, lesson validation and not-found values', async () => {
  const desktop = await createDesktop({ driver: nodeDriver(), researchReport: reportInput });
  try {
    const store = createResearchStore(desktop.db);
    const one = await lessonFixture(store, { id: 'surface-project-one' }), two = await lessonFixture(store, { id: 'surface-project-two' });
    stored(await store.lessons.putProposal(one.lesson)); stored(await store.lessons.putProposal(two.lesson));
    const validation = await validationFixture(one.lesson); stored(await store.lessons.putValidation(validation));
    const [list, first, second] = await Promise.all([researchGet(desktop, '/api/research/runs'),
      researchGet(desktop, '/api/research/runs/get?projectId=' + one.owner.id), researchGet(desktop, '/api/research/runs/get?projectId=' + two.owner.id)]);
    for (const result of [list, first, second]) assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.equal(list.json.length, 2); list.json.forEach(provenance);
    for (const [result, fixture, other] of [[first, one, two], [second, two, one]] as const) {
      provenance(result.json); assert.deepEqual(result.json.project, fixture.owner);
      assert.equal(result.json.attempts[0].attempt.id, fixture.plan.attempt.id);
      assert.equal(result.json.artifacts[0].id, fixture.artifact.id);
      assert.equal(JSON.stringify(result.json).includes(other.owner.id), false);
      assert.match(result.json.mermaid, /flowchart/); assert.match(result.json.mermaid, /DISCOVERY/);
      assert.deepEqual(result.json.reproduce, []); assert.ok(result.json.limitations.some((line: string) => line.includes('shell reproduction')));
    }
    const lessons = await researchGet(desktop, '/api/research/lessons?state=proposed&profileId=computational');
    assert.equal(lessons.status, 200); assert.equal(lessons.json.length, 2); lessons.json.forEach(provenance);
    const lesson = await researchGet(desktop, '/api/research/lessons/get?id=' + one.lesson.id);
    assert.equal(lesson.status, 200, JSON.stringify(lesson.json)); provenance(lesson.json);
    assert.deepEqual(lesson.json.lesson, one.lesson); assert.deepEqual(lesson.json.validationRuns, [validation]); assert.equal(lesson.json.outcome, null);
    assert.equal((await researchGet(desktop, '/api/research/runs?limit=1')).json.length, 1);
    assert.deepEqual((await researchGet(desktop, '/api/research/runs?status=COMPLETE')).json, []);
    assert.equal((await researchGet(desktop, '/api/research/runs?limit=201')).status, 400);
    for (const path of ['/api/research/runs/get?projectId=unknown', '/api/research/lessons/get?id=' + '0'.repeat(64), '/api/research/runs/live?projectId=unknown'])
      assert.equal((await researchGet(desktop, path)).status, 404);
  } finally { await desktop.close(); }
});

it('the report and each comparison are exact projections, including refused pairs and not-run rows', async () => {
  const input = await reportInput(), document = JSON.parse(input.bytes);
  const desktop = await createDesktop({ driver: nodeDriver(), researchReport: async () => input });
  try {
    const answer = await researchGet(desktop, '/api/research/report'); assert.equal(answer.status, 200, JSON.stringify(answer.json));
    provenance(answer.json); assert.deepEqual(answer.json.rows, document.ablation.rows); assert.deepEqual(answer.json.pairs, document.ablation.pairs);
    assert.deepEqual(answer.json.gate, document.ablation.gate); assert.equal(answer.json.generatedFrom, document.source.sha256);
    assert.ok(answer.json.rows.some((row: any) => row.state === 'not-run'));
    const refused = document.ablation.pairs.find((pair: any) => !pair.comparable); assert.ok(refused);
    const selected = await researchGet(desktop, '/api/research/ablation?pairId=' + encodeURIComponent(refused.id));
    assert.equal(selected.status, 200); provenance(selected.json); assert.deepEqual(selected.json.pair, refused);
    assert.equal(selected.json.delta, null); assert.ok(selected.json.refusals.every((row: any) => row.code === 'TRSH2012'));
    assert.equal((await researchGet(desktop, '/api/research/ablation?pairId=unknown')).status, 404);
  } finally { await desktop.close(); }
});

it('a promoted lesson reads its stored native outcome head and refuses corrupted head provenance', async () => {
  const desktop = await createDesktop({ driver: nodeDriver(), researchReport: reportInput });
  try {
    const store = createResearchStore(desktop.db), fixture = await lessonOutcomeFixture(store, createOutcomeStore(desktop.db));
    const promoted = await fixture.root(), lesson = promoted.audit.promoted[0]!;
    const heads = desktop.db.collection<any>('outcome_heads'), before = asRows(await heads.execute({ $for: { r: '$[*]' }, $return: '$r' }));
    const answer = await researchGet(desktop, '/api/research/lessons/get?id=' + lesson.id);
    assert.equal(answer.status, 200, JSON.stringify(answer.json)); provenance(answer.json);
    assert.deepEqual(answer.json.outcome, { versionId: promoted.versionId, head: promoted.head, activationEventId: promoted.activationEventId });
    assert.deepEqual(asRows(await heads.execute({ $for: { r: '$[*]' }, $return: '$r' })), before, 'the surface did not change the head');
    await heads.put({ ...(before[0] as any), eventId: promoted.versionId });
    const corrupt = await researchGet(desktop, '/api/research/lessons/get?id=' + lesson.id);
    assert.equal(corrupt.status, 422); assert.equal(corrupt.json.code, 'research-refused'); assert.equal(corrupt.json.details.failures, 1);
  } finally { await desktop.close(); }
});

it('corrupt, rehashed contradictory and stale reports are counted read failures', async () => {
  const input = await reportInput(), document = JSON.parse(input.bytes);
  const contradictory = structuredClone(document); contradictory.ablation.gate.writebackEligible = true;
  const { reportId: _id, ...payload } = contradictory; contradictory.reportId = await canonicalSha256(payload);
  for (const candidate of [{ ...input, bytes: '{broken' }, { ...input, bytes: JSON.stringify(contradictory) },
    { ...input, expectedReportId: '0'.repeat(64) },
    { ...input, sourceFiles: input.sourceFiles.map((row, i) => i === 0 ? { ...row, sha256: '0'.repeat(64) } : row) }]) {
    const read = await readResearchReport(async () => candidate); assert.equal(read.ok, false);
    if (!read.ok) { assert.equal(read.failures, 1); assert.equal(read.issues.length, 1); }
    const desktop = await createDesktop({ driver: nodeDriver(), researchReport: async () => candidate });
    try {
      for (const path of ['/api/research/report', '/api/research/ablation?pairId=lessons-on-vs-off']) {
        const result = await researchGet(desktop, path); assert.equal(result.status, 422, JSON.stringify(result.json));
        assert.equal(result.json.code, 'report-invalid'); assert.equal(result.json.details.failures, 1);
      }
    } finally { await desktop.close(); }
  }
});

it('the research surface adds seven addressed operations without narrowing the released contract', async () => {
  const before = JSON.parse(await readFile('test/fixtures/desktop-contract-0.38.0.json', 'utf8'));
  const contract = compileContract(DESKTOP_CONTRACT), after = publicProjection(contract), diff = diffContracts(before, after);
  assert.deepEqual(diff.breaking, []); assert.deepEqual(diff.unknown, []); assert.equal(isCompatible(before, after), true);
  const additions = Object.keys(DESKTOP_CONTRACT.operations).filter(name => name.startsWith('research.'));
  assert.equal(additions.length, 7);
  for (const name of additions) assert.equal((DESKTOP_CONTRACT.operations as any)[name].kind, name.endsWith('.live') ? 'subscribe' : 'read');
  assert.equal((DESKTOP_CONTRACT.operations as any)['research.runs.live'].policy.stream.resume, 'replay');
  console.log(JSON.stringify({ before: await compileContract(before).revision(), after: await contract.revision() }));
});
