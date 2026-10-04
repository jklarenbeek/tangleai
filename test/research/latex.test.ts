import assert from 'node:assert/strict';
import { it } from 'node:test';
import { renderMarkdownBundle, renderLatexBundle } from '@tangleai/research';
import { compileLatex } from '../../benchmark/lib/research-latex.ts';
import { writingExportFixture } from './writing-fixtures.ts';
import { checked } from './fixtures.ts';

it('the optional TeX bundle compiles with resolved citations and produces reproducible PDF bytes when tools are present', async context => {
  const f = await writingExportFixture(), bundle = checked(await renderMarkdownBundle(f.source, f.scientific));
  const text = checked(await renderLatexBundle(bundle.manifest));
  assert.deepEqual(Object.keys(text.files).sort(), ['main.tex', 'references.bib']);
  const result = await compileLatex(bundle.manifest);
  if (result.latex.state === 'skipped') { context.skip(result.latex.reason!); return; }
  assert.equal(result.latex.state, 'compiled', result.latex.reason + '\n' + result.log.slice(-3000));
  assert.equal(result.spawns, 6); assert.ok(result.latex.files.some(file => file.path === 'main.pdf'));
  const again = await compileLatex(bundle.manifest);
  assert.equal(again.latex.state, 'compiled', again.latex.reason ?? '');
  assert.deepEqual(again.latex.files, result.latex.files);
});
it('missing TeX is a named zero-spawn skip and malformed manifests cannot execute anything', async () => {
  const f = await writingExportFixture(), bundle = checked(await renderMarkdownBundle(f.source, f.scientific));
  const missing = await compileLatex(bundle.manifest, { binaries: { pdflatex: 'research-fixture-missing-pdflatex', bibtex: 'bibtex' } });
  assert.equal(missing.latex.state, 'skipped'); assert.ok(missing.latex.reason!.includes('not on the PATH')); assert.equal(missing.spawns, 0);
  const altered = structuredClone(bundle.manifest); altered.source.inputs.observations[0].value = 999;
  const refused = await compileLatex(altered); assert.equal(refused.latex.state, 'refused'); assert.equal(refused.spawns, 0);
});
