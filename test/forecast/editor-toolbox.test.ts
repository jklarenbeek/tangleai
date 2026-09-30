import { it } from 'node:test';
import assert from 'node:assert/strict';
import { openTangleDb } from '@tangleai/store';
import { createEditorToolbox, forecastQuery, forecastMust, forecastQuestionCreate, forecastTransaction, sealForecastRecord, forecastCheckpointPlan } from '@tangleai/forecast';
import { fixtureForecastHost } from '../../benchmark/lib/forecast-host-fixture.ts';
import { makeForecastFixture } from './fixtures.ts';
it('the editor toolbox is exactly harness_read, notes_read, revisions_read, trace_read and refuses foreign or future records',async () => {
  const db = await openTangleDb({ jobs: {} });
  try {
    const f = await fixtureForecastHost({ db,instant: () => '2025-01-25T00:00:00.000Z' }); await f.host.tick('2025-01-25T00:00:00.000Z');
    const checkpoints = forecastMust(await forecastQuery(f.store,'checkpoints')).sort((a,b) => a.ordinal - b.ordinal), checkpoint = checkpoints[1];
    const toolbox = await createEditorToolbox({ store: f.store,question: f.question,checkpoint,limits: { maxTraceReads: 2 } });
    assert.deepEqual(toolbox.names,['harness_read','notes_read','revisions_read','trace_read']); assert.ok(!('add' in toolbox));
    assert.equal((await toolbox.execute('notes_read',{}) as unknown[]).length,2);
    assert.equal((await toolbox.execute('web_search',{ query: 'escape' })).code,'TFCT1003');
    assert.equal((await toolbox.execute('notes_read',{ ordinal: 3 })).code,'TFCT1003');
    assert.equal((await toolbox.execute('trace_read',{ traceId: checkpoints[2].traceId })).code,'TFCT1003');
    const read = await toolbox.execute('trace_read',{ traceId: checkpoint.traceId,limit: 64 }); assert.ok(Array.from(read.excerpt).length <= 64); assert.ok(read.nextCursor !== null);
    assert.deepEqual(await toolbox.execute('trace_read',{ traceId: checkpoint.traceId }),{ exhausted: true,reads: 2,limit: 2 });
    assert.equal(toolbox.audit().traceReads,2); assert.equal(toolbox.audit().traceBudget,1);
    const future = await toolbox.validateSources(['note:' + checkpoints[2].noteId]); assert.equal(future.ok,false); if(!future.ok) assert.equal(future.issues[0].code,'TFCT1003');
    const foreign = await makeForecastFixture(), question = await sealForecastRecord('questions',{ ...foreign.questions,prompt: 'Another unrelated unresolved question.' });
    forecastMust(await forecastQuestionCreate(f.store,question));
    const otherCheckpoint = await sealForecastRecord('checkpoints',{ ...foreign.checkpoints,questionId: question.id,inputHarnessVersionId: f.harness.id,inputHarnessDigest: f.harness.digest });
    forecastMust(await forecastCheckpointPlan(f.store,otherCheckpoint));
    const trace = await sealForecastRecord('traces',{ ...foreign.traces,checkpointId: otherCheckpoint.id });
    const note = await sealForecastRecord('notes',{ ...foreign.notes,checkpointId: otherCheckpoint.id,traceId: trace.id,evidenceIds: [] });
    const revision = await sealForecastRecord('revisions',{ ...foreign.revisions,questionId: question.id,checkpointId: otherCheckpoint.id,comparedNoteIds: [note.id],committedGuidance: [] });
    forecastMust(await forecastTransaction(f.store,async tx => { await tx.put('traces',trace); await tx.put('notes',note); await tx.put('revisions',revision); }));
    for (const address of ['note:' + note.id,'trace:' + trace.id,'revision:' + revision.id]) {
      const result = await toolbox.validateSources([address]); assert.equal(result.ok,false); if(!result.ok) assert.equal(result.issues[0].code,'TFCT1003');
    }
    assert.equal((await toolbox.validateSources([toolbox.sourceIds[0]])).ok,true);
    toolbox.close(); assert.equal((await toolbox.execute('harness_read',{})).code,'TFCT1004');
  } finally { await db.close(); }
});
