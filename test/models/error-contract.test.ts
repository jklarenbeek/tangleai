import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AiError, createStructuredOutput } from '@tangleai/models';
import { AppCompileError, AppRuntimeError } from '@jarenjs/app';
import { FlowCompileError } from '@jarenjs/flow';
const CAUSE = new Error('matrix cause');
function assertNoCause(err: any) {
  assert.strictEqual(Object.hasOwn(err, 'cause'), false);
}
function assertRealCause(err: any) {
  assert.strictEqual(Object.hasOwn(err, 'cause'), true);
  assert.strictEqual((err as any).cause, CAUSE);
}
it('AiError (meta form, ai semantics): undefined cause is absence', () => {
  assertNoCause(new AiError('AI0001', 'r'));
  assertNoCause(new AiError('AI0001', 'r', { cause: undefined }));
  assertRealCause(new AiError('AI0001', 'r', { cause: CAUSE }));
});
describe('the normalizeErrors round-trip (through the public surface)', () => {
  /**
   * Drive one coded error through createStructuredOutput's repair
   * path and return the record the model would receive.
   */
  async function recordFor(err: Error) {
    const client = {
      endpoint: { provider: 'openai-compatible' },
      complete: async () => ({ message: { content: '{}' } }),
    };
    const structured = createStructuredOutput({
      client,
      schema: { type: 'object' },
      validator: () => ({ valid: false, errors: [err] }),
      maxRepairs: 0,
    });
    const outcome = (
      await structured.generate([{ role: 'user', content: 'go' }]) as {
        errors: any[];
      });
    return outcome.errors[0];
  }

  it('a ROOT docPath survives as instancePath ""', async () => {
    const record = await recordFor(new AppCompileError('ZZ0001', 'why', ''));
    assert.strictEqual(record.instancePath, '');
    assert.strictEqual(record.docPath, '');
    assert.strictEqual(record.code, 'ZZ0001');
  });

  it('an ABSENT docPath falls through the ?? chain (not swallowed as a location)', async () => {
    const record = await recordFor(new AppRuntimeError('ZZ0001', 'why'));
    assert.strictEqual(record.instancePath, '');
    assert.strictEqual(Object.hasOwn(record, 'docPath'), false);
  });

  it('a real docPath is carried whole', async () => {
    const record = await recordFor(new FlowCompileError('ZZ0001', 'why', '/x/y'));
    assert.strictEqual(record.instancePath, '/x/y');
    assert.strictEqual(record.docPath, '/x/y');
  });
});
