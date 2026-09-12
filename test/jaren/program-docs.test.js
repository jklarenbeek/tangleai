/** Original Jaren pen documentation assertions, received under the program owner. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import * as program from '@tangleai/jaren/program';

const root = fileURLToPath(new URL('../../', import.meta.url));
const markdown = readFileSync(join(root, 'packages/jaren/docs/PROGRAM-PEN.md'), 'utf8');
function bodyOf(heading) {
  const start = markdown.indexOf(heading); assert.ok(start >= 0, heading);
  const from = markdown.indexOf('\n', start) + 1, next = markdown.slice(from).search(/^## /m);
  return markdown.slice(start, next < 0 ? markdown.length : from + next);
}
const names = (section, name) => section.includes(`\`${name}(`) || section.includes(`\`.${name}(`) || section.includes(`\`${name}\``) || section.includes(`\`.${name}\``);
const exports = Object.keys(program);
const classes = exports.filter(name => /^[A-Z]/.test(name) && !/^[A-Z0-9_]+$/.test(name));
const constants = exports.filter(name => /^[A-Z0-9_]+$/.test(name));
const guards = exports.filter(name => /^is[A-Z]/.test(name));

it('the received program worked example exists and emits its exact following JSON fence', async t => {
  const fences = [...bodyOf('## 3. Worked examples').matchAll(/```(js|json)\n([\s\S]*?)```/g)].map(match => ({ lang:match[1], body:match[2] }));
  const pairs = [];
  for (let index=0; index<fences.length; index++) if (fences[index].lang === 'js') {
    assert.equal(fences[index+1]?.lang, 'json'); pairs.push([fences[index].body, fences[index+1].body]);
  }
  assert.ok(pairs.length >= 1);
  const directory = mkdtempSync(join(root, 'node_modules', '.program-docs-'));
  t.after(() => rmSync(directory, { recursive:true, force:true }));
  for (const [index, [js,json]] of pairs.entries()) {
    const path = join(directory, 'example-'+index+'.mjs'); writeFileSync(path, js);
    const module = await import(pathToFileURL(path).href);
    assert.equal(Object.keys(module).length, 1);
    const emitted = Object.values(module)[0];
    assert.deepEqual(emitted.schema ?? emitted.toJSON(), JSON.parse(json));
  }
});

it('the mapping table names every callable export and builder method', () => {
  const methods = new Set();
  for (const value of Object.values(program)) if (typeof value === 'function' && value.prototype && value.prototype !== Function.prototype)
    for (const name of Object.getOwnPropertyNames(value.prototype)) if (name !== 'constructor') methods.add(name);
  const functions = exports.filter(name => !classes.includes(name) && !constants.includes(name) && !guards.includes(name));
  const vocabulary = [...new Set([...functions, ...methods])].sort();
  assert.deepEqual(vocabulary.filter(name => !names(bodyOf('## 2. The mapping table'), name)), []);
});

it('the type section names every builder class, constant and guard', () => {
  assert.deepEqual([...classes, ...constants, ...guards].filter(name => !bodyOf('## 5. The types').includes(name)), []);
});

it('documented refusal codes equal the program source codes in both directions', () => {
  const source = readFileSync(join(root, 'packages/jaren/src/program.js'), 'utf8');
  const raised = [...new Set([...source.matchAll(/JL01\d\d/g)].map(match => match[0]))].sort();
  const documented = [...bodyOf('## 4. Refusals').matchAll(/^\| `(JL01\d\d)` \|/gm)].map(match => match[1]);
  assert.deepEqual(documented, raised);
});
