/**
 * The authoring instrument's own check, keyless: every task's probes are
 * satisfiable by a sensible application (its reference document passes them),
 * and each probe fails a document that does not do what was asked.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkAuthoredApp } from '@tangleai/os/authoring';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const { tasks } = read('benchmark/fixtures/authoring/tasks.json');

describe('the authoring instrument', () => {
  for (const task of tasks) {
    it(`${task.id}: the reference passes every probe, and another task's application fails them`, async () => {
      const reference = await checkAuthoredApp(read(`benchmark/fixtures/authoring/reference/${task.id}.json`), task.probes);
      assert.deepEqual(reference.problems, []);
      // a working application that is not what was asked fails the judge
      const other = await checkAuthoredApp(read(`benchmark/fixtures/authoring/reference/${task.id === 'bmi' ? 'distance' : 'bmi'}.json`), task.probes);
      assert.equal(other.ok, false);
    });
  }
});

describe('the published authoring run', () => {
  it('adds up, names its model and run, and keeps every document it judged', async () => {
    const report = read('benchmark/results/authoring-live.json');
    assert.equal(report.summary.runs, report.rows.length);
    assert.equal(report.summary.works, report.rows.filter((r: any) => r.works).length);
    assert.equal(report.summary.rate, +(report.summary.works / report.summary.runs).toFixed(3));
    assert.ok(report.generated.model && report.generated.at);
    assert.deepEqual(report.generated.tasks, tasks.map((t: any) => t.id));
    // the published verdicts are the judge's own: every kept document still gets the verdict it was given
    for (const row of report.rows) if (row.doc) {
      const task = tasks.find((t: any) => t.id === row.task);
      assert.equal((await checkAuthoredApp(row.doc, task.probes)).ok, row.works, `${row.task} trial ${row.trial}`);
    }
    const doc = readFileSync(new URL('../../docs/AUTHORING_BENCHMARK.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(doc.includes(`${report.summary.works} of ${report.summary.runs}`), 'the document states the published rate');
  });
});

describe('the published conversation runs', () => {
  for (const lang of ['en', 'nl']) {
    it(`${lang}: adds up, and every document that reached the inbox gets the verdict it was given`, async () => {
      const report = read(`benchmark/results/authoring-conversation-${lang}.json`);
      assert.equal(report.generated.mode, 'conversation');
      assert.equal(report.generated.lang, lang);
      assert.equal(report.summary.runs, report.rows.length);
      assert.equal(report.summary.works, report.rows.filter((r: any) => r.works).length);
      assert.equal(report.summary.suggested, report.rows.filter((r: any) => r.suggested).length);
      assert.equal(report.summary.calls, report.rows.reduce((n: number, r: any) => n + r.calls, 0));
      for (const row of report.rows) {
        assert.ok(row.tools.includes('apps.crib'), `${row.task} trial ${row.trial} read the crib`);
        assert.equal(row.tools.includes('apps.suggest'), row.suggested, `${row.task} trial ${row.trial} suggested exactly when the report says it did`);
        if (row.doc) assert.equal((await checkAuthoredApp(row.doc, tasks.find((t: any) => t.id === row.task).probes)).ok, row.works, `${row.task} trial ${row.trial}`);
      }
      const doc = readFileSync(new URL('../../docs/AUTHORING_BENCHMARK.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
      assert.ok(doc.includes(`${report.summary.works} of ${report.summary.runs} in ${lang === 'en' ? 'English' : 'Dutch'}`), 'the document states the rate');
    });
  }
});
