import { describe, it } from 'node:test';
import assert from 'node:assert';
import { AiError } from '@tangleai/models';
const CODE = 'ZZ0042';
const REASON = 'golden reason';
const DOC_PATH = '/golden/doc';
const DATA_PATH = '/golden/data';
const CAUSE = new Error('golden cause');
function shapeOf(cls, err) {
  const anyErr = /** @type {any} */ (err);
  return {
    class: cls,
    name: err.name,
    code: anyErr.code,
    docPath: Object.hasOwn(err, 'docPath') ? anyErr.docPath ?? '<undefined>' : '<absent>',
    dataPath: Object.hasOwn(err, 'dataPath') ? anyErr.dataPath ?? '<undefined>' : '<absent>',
    reason: Object.hasOwn(err, 'reason') ? anyErr.reason : '<absent>',
    message: err.message,
    hasOwnCause: Object.hasOwn(err, 'cause'),
    causeValue: Object.hasOwn(err, 'cause')
      ? (anyErr.cause === CAUSE ? '<the fixed cause>' : String(anyErr.cause))
      : '<absent>',
  };
}
it('AiError matches its original golden shape', () => { assert.deepStrictEqual(shapeOf('AiError', new AiError(CODE, REASON, { cause: CAUSE })), {"class":"AiError","name":"AiError","code":"ZZ0042","docPath":"<undefined>","dataPath":"<absent>","reason":"golden reason","message":"ZZ0042: golden reason","hasOwnCause":true,"causeValue":"<the fixed cause>"}); });
