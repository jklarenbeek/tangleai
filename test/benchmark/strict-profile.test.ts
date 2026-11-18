/**
 * The published strict-profile run: it adds up, names its model, and every
 * schema it measured still derives a profile with no `oneOf` left.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));

describe('the published strict-profile run', () => {
  it('adds up per condition, and the document states it', () => {
    const report = read('benchmark/results/strict-profile-live.json');
    assert.ok(report.generated.model);
    for (const condition of ['as-is', 'profile']) {
      const rows = report.rows.filter((r: any) => r.condition === condition);
      assert.equal(rows.length, report.generated.schemas.length);
      for (const outcome of ['refused', 'valid', 'invalid', 'error'])
        assert.equal(report.summary[condition][outcome], rows.filter((r: any) => r.outcome === outcome).length, `${condition} ${outcome}`);
    }
    const doc = readFileSync(new URL('../../docs/STRICT_PROFILE_BENCHMARK.md', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    assert.ok(doc.includes(`refused ${report.summary['as-is'].refused} of ${report.generated.schemas.length}`));
    assert.ok(doc.includes(`and ${report.summary.profile.refused} of ${report.generated.schemas.length} as their strict profile`));
  });
});
