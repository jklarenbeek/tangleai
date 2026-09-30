import { it } from 'node:test';
import assert from 'node:assert/strict';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';
import { createScriptedFeedbackClient, measureForecastTreatment } from '../../benchmark/lib/forecast-scripted.ts';
it('a missing checkpoint and digest prediction is a charged TFCT1002 failure and never a guessed answer',async () => {
  const fixture = await loadForecastFixtures(); delete fixture.predictions['q01-c1'][fixture.manifest.seedHarnessDigest];
  const measured = await measureForecastTreatment(fixture,'static-harness'), first = measured.cases[0];
  assert.equal(first.status,'failed'); assert.equal(first.failure!.code,'TFCT1002'); assert.equal(first.prediction,null); assert.equal(first.utility,null);
  assert.equal(measured.retained[0].checkpoint.spend.calls,1); assert.equal(measured.logicalCalls,measured.cost.calls); assert.equal(measured.physicalCalls,0);
});
it('feedback is bound to the input harness and ordinal and resolves only the current retained note',async () => {
  const fixture = await loadForecastFixtures(), checkpointId = 'a'.repeat(64), noteId = 'b'.repeat(64);
  for (const digest of [fixture.manifest.seedHarnessDigest,...fixture.manifest.candidateDigests]) for(const ordinal of [2,3]) {
    const client = createScriptedFeedbackClient(fixture,{ checkpointId,ordinal,harnessDigest: digest,noteId });
    const request = { messages: [{ role: 'user',content: JSON.stringify({ checkpoint: { id: checkpointId,ordinal },harness: { digest },notes: [{ id: noteId,checkpointId }] }) }] };
    const response = await client.client.complete(request), feedback = JSON.parse(response.message.content);
    assert.deepEqual(feedback.committedGuidance[0].sources,['note:' + noteId]); assert.equal(client.calls(),1); assert.equal(client.physicalCalls(),0);
    await assert.rejects(() => client.client.complete({ messages: [{ role: 'user',content: JSON.stringify({ checkpoint: { id: checkpointId,ordinal: 1 } }) }] }),{ code: 'TFCT1002' });
  }
});
