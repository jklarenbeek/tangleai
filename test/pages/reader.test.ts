/**
 * The pure half of Docs and Benchmarks: which documents the reader offers and
 * how its rail groups them, where a link inside a document leads, and that a
 * headline chart reads its numbers from the results file it is given — never
 * from anything typed beside it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { HEADLINES, addressView, groupOf, readerIndex, resolveLink, titleOf } from '../../apps/pages/src/os/reader-model.ts';

const say = (word: string, params?: Record<string, string>) => params?.k ? `${word}:${params.k}` : word;
const format = (n: number) => String(n);

describe('the reader index', () => {
  it('groups the overview, the workflow, the packages with their own docs, and the reports', () => {
    assert.deepEqual(groupOf('README.md'), { group: 'overview' });
    assert.deepEqual(groupOf('docs/ARCHITECTURE.md'), { group: 'overview' });
    assert.deepEqual(groupOf('docs/workflow/templates/work-order.md'), { group: 'workflow' });
    assert.deepEqual(groupOf('packages/models/README.md'), { group: 'packages' });
    assert.deepEqual(groupOf('components/os/README.md'), { group: 'packages' });
    assert.deepEqual(groupOf('packages/jaren/docs/AUTHORING.md'), { group: 'packages', parent: 'packages/jaren/README.md' });
    assert.deepEqual(groupOf('docs/VECTOR_SCALE.md'), { group: 'reports' });
    assert.equal(groupOf('packages/models/src/index.ts'), null);
    assert.equal(groupOf('benchmark/README.md'), null);
  });

  it('titles a document by its own heading, as plain text, and a package README by its package', () => {
    assert.equal(titleOf('intro\n# The `loop` and [links](x.md)\n', 'a.md'), 'The loop and links');
    assert.equal(titleOf('no heading', 'docs/NOTES.md'), 'NOTES');
    const index = readerIndex([
      { path: 'packages/zeta/README.md', text: '# Zeta', packageName: '@tangleai/zeta' },
      { path: 'docs/ROADMAP.md', text: '# Roadmap' },
      { path: 'packages/zeta/docs/GUIDE.md', text: '# Guide' },
      { path: 'docs/A_BENCHMARK.md', text: '# A report' },
      { path: 'README.md', text: '# Tangle' },
      { path: 'docs/ARCHITECTURE.md', text: '# Architecture' },
      { path: 'docs/workflow/README.md', text: '# Workflow' },
      { path: 'src/ignored.md', text: '# no' },
    ]);
    assert.deepEqual(index.documents.map(d => [d.path, d.title, d.group, d.parent ?? null]), [
      ['README.md', 'Tangle', 'overview', null],
      ['docs/ARCHITECTURE.md', 'Architecture', 'overview', null],
      ['docs/ROADMAP.md', 'Roadmap', 'overview', null],
      ['docs/workflow/README.md', 'Workflow', 'workflow', null],
      ['packages/zeta/README.md', '@tangleai/zeta', 'packages', null],
      ['packages/zeta/docs/GUIDE.md', 'Guide', 'packages', 'packages/zeta/README.md'],
      ['docs/A_BENCHMARK.md', 'A report', 'reports', null],
    ]);
  });

  it('is the same bytes whatever order the build finds the documents in', () => {
    const sources = [
      { path: 'docs/B.md', text: '# B' }, { path: 'docs/A.md', text: '# A' },
      { path: 'packages/x/README.md', text: '# X' }, { path: 'packages/x/docs/Y.md', text: '# Y' },
    ];
    assert.equal(JSON.stringify(readerIndex(sources)), JSON.stringify(readerIndex([...sources].reverse())));
  });
});

describe('links inside a document', () => {
  const known = new Set(['README.md', 'docs/ARCHITECTURE.md', 'packages/os/README.md', 'docs/workflow/RELEASE.md']);

  it('opens another document of the reader here, with its place', () => {
    assert.deepEqual(resolveLink('docs/ARCHITECTURE.md#the-boundary', 'README.md', known), { kind: 'doc', path: 'docs/ARCHITECTURE.md', hash: 'the-boundary' });
    assert.deepEqual(resolveLink('../ARCHITECTURE.md', 'docs/workflow/RELEASE.md', known), { kind: 'doc', path: 'docs/ARCHITECTURE.md' });
    assert.deepEqual(resolveLink('../../packages/os/', 'docs/workflow/RELEASE.md', known), { kind: 'doc', path: 'packages/os/README.md' });
  });

  it('scrolls to a place in the same document', () => {
    assert.deepEqual(resolveLink('#setup', 'README.md', known), { kind: 'anchor', hash: 'setup' });
    assert.deepEqual(resolveLink('README.md#setup', 'README.md', known), { kind: 'anchor', hash: 'setup' });
  });

  it('sends the web and repository files to a new tab', () => {
    assert.deepEqual(resolveLink('https://example.org/x', 'README.md', known), { kind: 'external', url: 'https://example.org/x' });
    assert.deepEqual(resolveLink('packages/models/src/index.ts', 'README.md', known),
      { kind: 'repository', url: 'https://github.com/jklarenbeek/tangleai/blob/main/packages/models/src/index.ts' });
    assert.deepEqual(resolveLink('../benchmark/', 'docs/ARCHITECTURE.md', known),
      { kind: 'repository', url: 'https://github.com/jklarenbeek/tangleai/tree/main/benchmark' });
    assert.equal(resolveLink('../../../outside.md', 'docs/ARCHITECTURE.md', known), null);
  });

  it('addresses every link and image of a view without touching the input', () => {
    const view = ['article', { class: 'md' }, [
      ['p', {}, 'See ', ['a', { href: 'docs/ARCHITECTURE.md#x' }, 'arch'], ' ', ['a', { href: 'https://e.org' }, 'web'], ' ', ['img', { src: 'docs/a.png', alt: '' }]],
      ['h2', { id: 'here' }, 'Here', ['a', { class: 'md-anchor', href: '#here' }, '#']],
      ['p', {}, ['a', { href: '../../escape.md' }, 'nowhere']],
    ]];
    const before = JSON.stringify(view);
    const out = addressView(view as any, 'README.md', known) as any;
    assert.equal(JSON.stringify(view), before, 'the input is not changed');
    const [p, h2, last] = out[2];
    assert.deepEqual(p[3][1], { href: '#docs/ARCHITECTURE.md', 'data-doc': 'docs/ARCHITECTURE.md', 'data-hash': 'x' });
    assert.deepEqual(p[5][1], { href: 'https://e.org', target: '_blank', rel: 'noopener noreferrer' });
    assert.equal(p[7][1].src, 'https://raw.githubusercontent.com/jklarenbeek/tangleai/main/docs/a.png');
    assert.deepEqual(h2[3][1], { class: 'md-anchor', href: '#here', 'data-hash': 'here' });
    assert.deepEqual(last[2], ['a', {}, 'nowhere'], 'a link that leads nowhere keeps its text and loses its href');
  });
});

describe('headline charts', () => {
  it('draw every measured value of their results file, and nothing else', () => {
    const recall = HEADLINES['docs/LOCOMO_RECALL.md'].chart([{
      config: { ks: [5, 10] },
      rows: [{ key: 'oracle', recall: { 5: { overall: 0.9 }, 10: { overall: 1 } } }, { key: 'bm25', recall: { 5: { overall: 0.4 }, 10: { overall: 0.6 } } }],
    }], say as any, format)!;
    assert.deepEqual(recall, {
      type: 'bar', title: 'recall-title', categories: ['oracle', 'bm25'],
      series: [{ name: 'recall-series:5', values: [0.9, 0.4] }, { name: 'recall-series:10', values: [1, 0.6] }],
    });
    const jaren = HEADLINES['docs/JARENJS_BENCHMARK.md'].chart([
      { runtime: 'node', previous: { p95Ms: 11 }, bounded: { p95Ms: 7 } },
      { runtime: 'bun', previous: { p95Ms: 9 }, bounded: { p95Ms: 5 } },
    ], say as any, format)!;
    assert.deepEqual(jaren.categories, ['Node.js', 'Bun']);
    assert.deepEqual(jaren.series.map(s => s.values), [[11, 9], [7, 5]]);
  });

  it('draw nothing when the results do not hold the headline', () => {
    for (const headline of Object.values(HEADLINES)) {
      assert.equal(headline.chart(headline.results.map(() => ({})), say as any, format), null);
      assert.equal(headline.chart(headline.results.map(() => null), say as any, format), null);
    }
  });

  it('read results files that exist in the repository and hold their headline', () => {
    for (const [report, headline] of Object.entries(HEADLINES)) {
      readFileSync(new URL(`../../${report}`, import.meta.url));
      const results = headline.results.map(p => JSON.parse(readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')));
      const chart = headline.chart(results, say as any, format);
      assert.ok(chart && chart.categories.length > 0 && chart.series.every(s => s.values.length === chart.categories.length && s.values.every(Number.isFinite)), report);
    }
  });
});
