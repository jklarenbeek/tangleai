import { describe, it } from 'node:test';
import assert from 'node:assert';
import { JarenValidator } from '@jarenjs/validate';
import * as formats from '@jarenjs/formats';
import { LEDGER_SCHEMAS } from '@tangleai/context/schemas/ledger';
const IMPLEMENTED = new Set([
  ...Object.keys(formats.stringFormats),
  ...Object.keys(formats.numberFormats),
  ...Object.keys(formats.dateTimeFormats),
  ...Object.keys(formats.jsonFormats),
  ...Object.keys(formats.geoFormats),
]);
const strict = () => new JarenValidator({ unknownFormats: 'error', formatAssertion: true })
  .addFormats(formats.stringFormats)
  .addFormats(formats.numberFormats)
  .addFormats(formats.dateTimeFormats)
  .addFormats(formats.jsonFormats)
  .addFormats(formats.geoFormats);
function formatNames(node: any, into: Set<any> = new Set()) {
  if (Array.isArray(node)) {
    for (const item of node) formatNames(item, into);
  }
  else if (node !== null && typeof node === 'object') {
    if (typeof node.format === 'string') into.add(node.format);
    for (const value of Object.values(node)) formatNames(value, into);
  }
  return into;
}
it('every format name in the JavaScript-defined schemas is implemented', function () {
  // shipped schemas are not all files: the ai ledger's live in a module
  for (const [kind, schema] of Object.entries(LEDGER_SCHEMAS)) {
    for (const name of formatNames(schema)) {
      assert.ok(IMPLEMENTED.has(name), `the ${kind} schema declares unimplemented '${name}'`);
    }
    assert.doesNotThrow(() => strict().compile(schema),
      `the ${kind} schema does not compile with every format asserted`);
  }
});
