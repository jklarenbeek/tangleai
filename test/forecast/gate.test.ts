import { it } from 'node:test';
import assert from 'node:assert/strict';
import { volatileFactGate, captureVolatileContext } from '@tangleai/forecast';
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
const boundContext = { questionPrompt: 'Will the measure pass?',adapterOptions: [],evidenceExcerpts: [],toolResultExcerpts: [],questionId: 'a'.repeat(64),checkpointIds: [] };
it('guidance screening measures a lone surrogate as three bytes and refuses a non-string with its own error',() => {
  // 10922 lone surrogates are 32766 bytes: two more bytes fill the 32768 bound, three cross it.
  assert.equal(typeof volatileFactGate('\uD800'.repeat(10922) + 'aa',boundContext).ok,'boolean');
  assert.throws(() => volatileFactGate('\uD800'.repeat(10922) + 'aaa',boundContext),{ name: 'TypeError',message: 'Guidance screening requires bounded text.' });
  for (const text of [5,null,undefined,{ length: 1 }]) assert.throws(() => volatileFactGate(text as unknown as string,boundContext),(e: unknown) => e instanceof TypeError && e.message === 'Guidance screening requires bounded text.' && !/utf8ByteLength/.test(e.message));
});
it('the screening context bound measures its JSON text, where a lone surrogate is a six-byte escape',() => {
  const base = JSON.stringify({ ...boundContext,questionPrompt: '' }).length, surrogates = 100000, filler = 1048576 - base - surrogates * 6;
  const at = (extra: number) => ({ ...boundContext,questionPrompt: '\uD800'.repeat(surrogates) + 'a'.repeat(filler + extra) });
  assert.equal(captureVolatileContext(at(0)).questionPrompt.length,surrogates + filler);
  assert.throws(() => captureVolatileContext(at(1)),{ name: 'TypeError',message: 'Screening context exceeds its byte bound.' });
  // The measured value is always JSON text; a non-string member is refused before the bound.
  assert.throws(() => captureVolatileContext({ ...boundContext,questionPrompt: 5 as unknown as string }),(e: unknown) => e instanceof TypeError && /^Supply only this question/.test(e.message));
});
