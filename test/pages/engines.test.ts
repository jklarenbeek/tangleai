/**
 * The Charts and Collections applications' pure parts: the memory loop run
 * one observation at a time measures what its charts draw, the charts the
 * run builds are valid chart definitions, a typed definition is checked
 * before it replaces the last valid chart, and the rows the collection
 * scrolls are what the sources say.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compileChart } from '@jarenjs/charts';
import { PIPELINE_NODES } from '@tangleai/pipeline';

import { OBSERVATIONS } from '../../apps/pages/src/loop-data.ts';
import {
  checkDefinition, editableChart, growthChart, memoryRows, pointsOf, runIngestion, stagesChart, MEMORY_ROWS,
} from '../../apps/pages/src/os/engines-app.ts';
import { setPagesMessages } from '../../apps/pages/src/os/i18n.ts';
import { PAGES_PACKS } from '../../apps/pages/src/os/packs.ts';
import { enginesEn, enginesPacks } from '../../apps/pages/src/os/messages/engines.ts';

describe('the run the Charts application draws', () => {
  it('streams one step per observation, each the pipeline\'s own counts, a ranked recall and the DAG\'s milliseconds', async () => {
    const seen: number[] = [];
    const steps = await runIngestion((step) => seen.push(step.n));
    assert.deepEqual(seen, OBSERVATIONS.map((_, i) => i + 1), 'every step reaches the chart as it is measured');
    for (const step of steps) {
      assert.ok(step.live >= 1 && step.live <= step.total && step.total <= step.n);
      assert.ok(step.recall !== null && step.recall >= -1 && step.recall <= 1);
      for (const id of PIPELINE_NODES) assert.ok(typeof step.ms[id] === 'number' && step.ms[id] >= 0, id);
    }
    // under the measured default policy (its gates off) the loop keeps every observation it was given
    assert.deepEqual(steps.map(s => s.total), steps.map(s => s.n));
    // the probe asks about the rate limit, so the recall rises once one is stored
    assert.ok(steps[4].recall! > steps[3].recall!);
  });

  it('builds valid chart definitions whose points are the run\'s', async () => {
    const steps = await runIngestion(() => {});
    for (const definition of [growthChart(steps), stagesChart(steps), editableChart(steps)]) {
      const checked = checkDefinition(JSON.stringify(definition));
      assert.equal(checked.ok, true, JSON.stringify(checked));
      assert.ok(compileChart(definition as any).toVnode());
    }
    assert.equal(pointsOf(steps), steps.length * 2 + steps.length * PIPELINE_NODES.length);
    assert.deepEqual(growthChart(steps).series[0].points.map(p => p.y), steps.map(s => s.live));
    // an empty run draws empty axes, never an invented point
    assert.equal(pointsOf([]), 0);
  });

  it('speaks the desktop\'s language in the charts it builds', async () => {
    const steps = await runIngestion(() => {});
    try {
      setPagesMessages(PAGES_PACKS.de);
      assert.equal(growthChart(steps).title, 'Erinnerungen und Abruf, Beobachtung für Beobachtung');
      assert.equal(stagesChart(steps).categories[0], 'Beobachtung 1');
    } finally { setPagesMessages(); }
  });
});

describe('a chart definition a person types', () => {
  it('refuses text that is not JSON, with the parser\'s reason', () => {
    const checked = checkDefinition('{ "type": "bar", ');
    assert.equal(checked.ok, false);
    assert.equal(checked.ok === false && checked.kind, 'json');
  });

  it('refuses a document the chart schema refuses, naming the pointer and keyword', () => {
    const checked = checkDefinition(JSON.stringify({ type: 'bar', categories: 'x', series: [] }));
    assert.equal(checked.ok, false);
    assert.ok(checked.ok === false && checked.kind === 'definition' && checked.issues.some(i => i.startsWith('/categories — type')), JSON.stringify(checked));
    assert.equal(checkDefinition('[1, 2]').ok, false, 'a definition is an object');
    assert.equal(checkDefinition(JSON.stringify({ type: 'nonsense' })).ok, false);
  });

  it('refuses what the compiler refuses after the schema admitted it', () => {
    // y2 must name series as strings: the compiler's CH0002
    const checked = checkDefinition(JSON.stringify({ type: 'line', series: [{ name: 'a', points: [{ x: 1, y: 1 }] }], y2: { series: [1] } }));
    assert.equal(checked.ok, false);
  });

  it('accepts a valid definition as it is', () => {
    const definition = { type: 'pie', title: 'Parts', slices: [{ label: 'a', value: 2 }, { label: 'b', value: 3 }] };
    assert.deepEqual(checkDefinition(JSON.stringify(definition)), { ok: true, definition });
  });
});

describe('the rows the Collections application scrolls', () => {
  it('holds ten thousand distinct rows, numbered from one', () => {
    const rows = memoryRows();
    assert.equal(rows.length, MEMORY_ROWS);
    assert.equal(new Set(rows.map(r => r.id)).size, MEMORY_ROWS);
    assert.deepEqual([rows[0].n, rows.at(-1)!.n], [1, MEMORY_ROWS]);
  });
});

describe('the Charts and Collections sentences', () => {
  it('every pack carries every key, and nothing else', () => {
    const keys = Object.keys(enginesEn).sort();
    for (const [lang, pack] of Object.entries(enginesPacks)) assert.deepEqual(Object.keys(pack).sort(), keys, lang);
  });

  it('every closure answers in every language for the parameters the applications pass', () => {
    const params = { done: 2, total: 6, points: 48, n: 1234, question: 'Q?', reason: 'r', count: 3, mounted: 20, first: 1, last: 12 };
    for (const pack of [enginesEn, ...Object.values(enginesPacks)]) {
      for (const [key, entry] of Object.entries(pack)) {
        const text = typeof entry === 'function' ? (entry as (p: any) => string)(params) : entry;
        assert.ok(typeof text === 'string' && text.length > 0 && !text.includes('undefined') && !text.includes('NaN'), key);
      }
    }
  });
});
