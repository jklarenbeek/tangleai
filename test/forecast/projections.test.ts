import { it } from 'node:test';
import assert from 'node:assert/strict';
import { JarenValidator } from '@jarenjs/validate';
import { forecastMust, forecastQuery, forecastGet, forecastGuidanceRef } from '@tangleai/forecast';
import * as project from '../../packages/forecast/src/projections.ts';
import schema from '../../packages/forecast/schemas/forecast.schema.json' with { type: 'json' };
import { outcomeFixture } from './outcome-fixture.ts';

function extra<T>(value: T): T {
  if (Array.isArray(value)) return value.map(extra) as T;
  if (value && typeof value === 'object') return { ...Object.fromEntries(Object.entries(value).map(([k,v]) => [k,extra(v)])),unnamedSecret: 'private-unnamed-value' } as T;
  return value;
}
it('no projection carries a raw transcript, a full tool result or an unnamed member across all thirteen outputs',async () => {
  const f = await outcomeFixture({ questionCount: 2 });
  try {
    const q = forecastMust(await forecastGet(f.store,'questions',f.questions[1].question.id))!, cp = forecastMust(await forecastQuery(f.store,'checkpoints',{ questionId: q.id })), c = cp.sort((a,b) => a.ordinal-b.ordinal)[1];
    const evidence = forecastMust(await forecastQuery(f.store,'evidence',{ checkpointId: c.id })), revisions = forecastMust(await forecastQuery(f.store,'revisions',{ questionId: q.id })), revision = revisions.find(r => r.checkpointId === c.id)!;
    const note = forecastMust(await forecastGet(f.store,'notes',c.noteId!))!, prediction = forecastMust(await forecastGet(f.store,'predictions',c.predictionId!))!, trace = forecastMust(await forecastGet(f.store,'traces',c.traceId!))!, harness = forecastMust(await forecastGet(f.store,'harnesses',c.inputHarnessVersionId!))!;
    const resolution = forecastMust(await forecastQuery(f.store,'resolutions',{ questionId: q.id }))[0], retrospective = forecastMust(await forecastQuery(f.store,'retrospectives',{ questionId: q.id }))[0], schedule = forecastMust(await forecastQuery(f.store,'schedules',{ questionId: q.id }))[0];
    const dangerousTrace = extra({ ...trace,messages: [{ role: 'assistant',content: 'private-transcript-body' }],steps: [{ type: 'tool',tool: 'web_search',result: 'private-full-tool-result',toolCalls: [{ name: 'fetch_url',arguments: { secret: 'private-full-tool-result' } }] }] });
    const output: Record<string,unknown> = {
      questionsList: [project.projectQuestionSummary(extra(q),extra(cp))],questionGet: project.projectQuestion(extra(q),extra(cp),[extra(harness)]),checkpointsList: cp.map(c => project.projectCheckpointSummary(extra(c))),checkpointGet: project.projectCheckpoint(extra(c),extra({ ...prediction,raw: 'private-raw-prediction' }),extra(evidence),extra(revisions)),noteGet: project.projectNote(extra(note)),evidenceList: evidence.map(e => project.projectEvidence(extra(e))),traceGet: project.projectTrace(dangerousTrace,0,24),revisionGet: await project.projectRevision(extra(revision)),harnessVersionGet: project.projectHarness(extra(harness)),harnessHead: project.projectHead(extra({ versionId: harness.id,digest: harness.digest,revision: 1 })),resolutionGet: project.projectResolution(extra(resolution),false),retrospectiveGet: project.projectRetrospective(extra(retrospective)),dueList: [project.projectDue(extra(schedule))],
    };
    assert.equal(Object.keys(output).length,13);
    for (const [name,v] of Object.entries(output)) {
      const result = new JarenValidator({ unknownFormats: 'ignore',collectErrors: true }).compile({ $defs: schema.$defs,$ref: '#/$defs/' + name + 'ReadResult' })({ ok: true,value: v,writes: 0 });assert.equal(result.valid,true,`${name}: ${JSON.stringify(result)}`);
      assert.doesNotMatch(JSON.stringify(v),/unnamedSecret|private-unnamed-value|private-transcript-body|private-full-tool-result|private-raw-prediction/);
    }
    assert.throws(() => project.projectRetrospective({ ...retrospective,issues: [{ code: 'TFCT1011',path: '',detail: 'Invalid retained cause.',retryable: false,cause: [{ invented: true }] }] }),/issue/);
    const projectedRevision = output.revisionGet as Awaited<ReturnType<typeof project.projectRevision>>;
    for (const [i,g] of revision.committedGuidance.entries()) assert.equal(projectedRevision.committedGuidance[i].guidanceRef,await forecastGuidanceRef(revision.id,g));
    const excerpt = project.projectEvidence({ ...evidence[0],excerpt: '🐟'.repeat(5000) });assert.equal(Array.from(excerpt.excerpt).length,2048);assert.equal(excerpt.excerptTruncated,true);assert.equal(excerpt.excerpt.includes('\ufffd'),false);
    const longNote = project.projectNote({ ...note,sections: { ...note.sections,keyEvidence: '🐟'.repeat(20000) } });assert.equal(Array.from(longNote.sections.keyEvidence).length,8192);
    assert.equal(JSON.stringify(dangerousTrace).includes('private-transcript-body'),true,'projections must not mutate retained records');
  } finally { await f.db.close(); }
});
it('trace metadata pagination is bounded and never slices messages or result payloads',() => {
  const h = 'a'.repeat(64), trace = { id: h,checkpointId: h,bytes: 99000,truncated: { steps: 2,chars: 7 },messages: ['never-return-this'],steps: Array.from({ length: 1002 },() => ({ type: '🐟'.repeat(200),tool: 'tool',result: 'never-return-this' })) };
  const first = project.projectTrace(trace,0,17);assert.equal(first.steps.length,1000);assert.equal(first.omittedSteps,2);assert.deepEqual(first.truncated,{ steps: 2,chars: 7 });assert.equal(first.bytes,99000);assert.equal(Array.from(first.excerpt).length,17);assert.equal(first.nextCursor,17);assert.equal(Array.from(first.steps[0].name).length,128);
  const second = project.projectTrace(trace,first.nextCursor!,17);assert.equal(second.cursor,17);assert.equal(second.nextCursor,34);assert.doesNotMatch(JSON.stringify(second),/never-return-this/);
  const empty = project.projectTrace(trace,first.totalChars,1);assert.equal(empty.excerpt,'');assert.equal(empty.nextCursor,null);
  assert.throws(() => project.projectTrace(trace,first.totalChars+1,1),/cursor/);assert.throws(() => project.projectTrace(trace,0,4097),/bounds/);
});
