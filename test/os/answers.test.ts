/**
 * Proposals that ask the person something: the answer's schema travels with
 * the proposal, the kernel checks the answer against it and hands it only to
 * the module that filed it, and the assistant has no way to answer.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createKernel, validateManifest } from '@tangleai/os';
import * as toolbox from '@tangleai/agents/toolbox';

const runner = { $module: '0.1', id: 'runner', version: '1.0.0', title: { en: 'Runner' }, host: { kind: 'shipped', mount: 'runner' }, proposals: [{ kind: 'run.pause', title: { en: 'A run waits' } }] };
const PAUSE = { id: 'pause-1', kind: 'run.pause', title: 'Approve the weekly order?', origin: 'ai', revision: '3',
  answer: { label: 'Send', schema: { type: 'object', additionalProperties: false, required: ['approve'], properties: { approve: { type: 'boolean' }, note: { type: 'string', maxLength: 200 } } } } };

describe('a proposal that asks for an answer', () => {
  it('keeps its origin and answer, takes a valid answer to its module, and refuses one the schema does not admit', async () => {
    assert.equal(validateManifest(runner).ok, true);
    const kernel = createKernel({ assistantGrants: 'all', tools: toolbox });
    kernel.install(runner);
    const heard: any[] = [];
    kernel.registerDecider('runner', 'host', (d) => { heard.push(d); });
    assert.equal(kernel.propose('runner', PAUSE).ok, true);
    const item = kernel.mail().find(m => m.proposal?.id === 'pause-1')!;
    assert.deepEqual([item.proposal!.origin, item.proposal!.answer!.label], ['ai', 'Send']);
    const wrong = await kernel.decide(item.id, 'answer', { approve: 'yes' });
    assert.ok(!wrong.ok && wrong.error.code === 'OS0124' && /approve/.test(wrong.error.message));
    assert.equal(kernel.mail().find(m => m.id === item.id)!.proposal!.status, 'pending', 'a refused answer leaves it pending');
    assert.equal((await kernel.decide(item.id, 'answer', { approve: true, note: 'ok' })).ok, true);
    assert.deepEqual(heard, [{ id: 'pause-1', kind: 'run.pause', decision: 'answer', revision: '3', response: { approve: true, note: 'ok' } }]);
    assert.equal(kernel.mail().find(m => m.id === item.id)!.proposal!.status, 'accepted');
  });
  it('refuses an answer to a proposal that asks none, and an answer schema that asks for a secret', async () => {
    const kernel = createKernel();
    kernel.install(runner);
    kernel.registerDecider('runner', 'host', () => {});
    kernel.propose('runner', { id: 'plain', kind: 'run.pause', title: 'Plain' });
    const plain = kernel.mail().find(m => m.proposal?.id === 'plain')!;
    const answered = await kernel.decide(plain.id, 'answer', {});
    assert.ok(!answered.ok && answered.error.code === 'OS0123');
    const secret = kernel.propose('runner', { ...PAUSE, id: 'secret', answer: { schema: { type: 'object', properties: { pin: { type: 'string', format: 'password' } } } } });
    assert.ok(!secret.ok && /secret/.test(secret.error.message));
    const huge = kernel.propose('runner', { ...PAUSE, id: 'huge', answer: { schema: { type: 'object', description: 'x'.repeat(21_000) } } });
    assert.ok(!huge.ok && /20,000/.test(huge.error.message));
  });
  it('gives the assistant no way to decide or answer: no tool reaches the inbox', () => {
    const kernel = createKernel({ assistantGrants: 'all', tools: toolbox });
    kernel.install(runner);
    const names = kernel.tools().toFunctionTools().map((t: any) => t.function.name);
    assert.ok(!names.some((n: string) => /decide|answer|mail/.test(n)), names.join(', '));
  });
});
