/** Only the explicitly omitted release jobs may be skipped on a docs push. */
import assert from 'node:assert/strict';

export function assertCiResults(jobs: Record<string, { result: string }>, documentationOnly: boolean) {
  for (const name of ['release-version', 'check', 'minimum-node', 'instruments']) {
    const expected = documentationOnly && ['minimum-node', 'instruments'].includes(name) ? 'skipped' : 'success';
    assert.equal(jobs[name]?.result, expected, `${name} must be ${expected}`);
  }
}
