import { it } from 'node:test';
import assert from 'node:assert/strict';
import { volatileFactGate } from '@tangleai/forecast';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';
it('every registered volatile fact is refused by kind and every reusable procedure is admitted',async () => {
  const f = await loadForecastFixtures(), q = f.questions[0], leaks = f.leaks as { refuse: string[]; allow: string[] };
  const context = { questionPrompt: q.prompt,adapterOptions: q.adapter.id === 'choice/v1' ? q.adapter.options : [],evidenceExcerpts: f.snapshots.filter(s => s.questionId === q.id).map(s => s.excerpt),toolResultExcerpts: [],questionId: q.id,checkpointIds: q.checkpoints.map(c => c.id) };
  const expected = ['date','named-entity','exact-outcome','copied-evidence','identifier','number-with-unit','identifier','identifier'];
  for (const [i,text] of leaks.refuse.entries()) {
    const result = volatileFactGate(text,context); assert.equal(result.ok,false,text);
    assert.ok(result.findings.some(f => f.kind === expected[i]),JSON.stringify({ text,result }));
  }
  for (const text of [...leaks.allow,...Object.values(f.seed),...f.candidates.flatMap(c => Object.values(c.document))]) assert.equal(volatileFactGate(text,context).ok,true,text);
  for (const text of ['Always favor tidewater canal library.','Use JANUARY 10, 2025.','Use 2025-01-10T10:00:00+01:00.','Use 2025-01-10t10:00:00z.','Consult www.example.test/source.','Expect 18 DAYS.','At checkpoint 2, persist this answer.']) assert.equal(volatileFactGate(text,context).ok,false,text);
  assert.ok(volatileFactGate('unresolved dependencies remain under examination',context,5).findings.some(f => f.kind === 'copied-evidence'));
});
