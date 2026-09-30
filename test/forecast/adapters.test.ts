import { it } from 'node:test';
import assert from 'node:assert/strict';
import { parseForecastAnswer, scoreForecastAnswer, forecastMust, type ForecastScore } from '@tangleai/forecast';
import { loadForecastFixtures } from '../../benchmark/lib/forecast-fixtures.ts';
import { scoreForecast } from '../../benchmark/lib/forecast-oracle.ts';

it('the runtime adapters agree with independent scores for all registered predictions', async () => {
  const fixture = await loadForecastFixtures(); let count = 0;
  for (const q of fixture.questions) for (const c of q.checkpoints) {
    const resolution = fixture.resolutions.find(r => r.questionId === q.id); if (!resolution) continue;
    for (const prediction of Object.values(fixture.predictions[c.id])) {
      const actual: ForecastScore = forecastMust(scoreForecastAnswer({ ...q.adapter,version: '1' },prediction,resolution.outcome));
      const expected = scoreForecast(q.adapter,prediction,resolution.outcome);
      assert.equal(actual.utility,expected.utility); assert.equal(actual.category,expected.category); count++;
    }
  }
  assert.equal(count,75);
});
it('answer parsing accepts only a boxed registered label or finite scalar with declared unit', () => {
  const choice = { id: 'choice/v1' as const,version: '1',options: ['North','South'] };
  assert.equal(forecastMust(parseForecastAnswer(choice,'earlier \\boxed{South} final \\boxed{north}')),'North');
  for (const raw of ['North','\\boxed{}','\\boxed{unknown}']) assert.equal(parseForecastAnswer(choice,raw).ok,false);
  const numeric = { id: 'numeric/v1' as const,version: '1',range: [0,100],tolerance: 2,unit: 'days' };
  assert.equal(forecastMust(parseForecastAnswer(numeric,'\\boxed{1.2e1 days}')),12);
  for (const raw of ['NaN','Infinity','1,000','12 hours','1e999']) assert.equal(parseForecastAnswer(numeric,'\\boxed{' + raw + '}').ok,false);
  assert.equal(scoreForecastAnswer(numeric,NaN,10).ok,false);
});
