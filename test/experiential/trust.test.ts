import { it } from 'node:test';
import assert from 'node:assert/strict';
import { taintOf } from '@tangleai/experiential';
import { selectionFixture, selectionNegative } from './selection-fixtures.ts';

it('sanitized text and verified labels cannot cleanse inherited untrusted evidence', async () => {
  const input = await selectionNegative('tainted-lineage'), e = input.experiences[0];
  const before = taintOf(e, input.trustView);
  assert.equal(before.trust, 'untrusted'); assert.ok(before.reasons.includes('tainted-lineage'));
  e.trust = 'operator'; e.contentDigest = '1'.repeat(64);
  assert.equal(taintOf(e, input.trustView).trust, 'untrusted');
});

it('only resolved independent evidence for the same lesson can qualify tainted lineage', async () => {
  const clean = await selectionFixture(), input = await selectionNegative('tainted-lineage'), e = input.experiences[0];
  e.observedOutcome = clean.experiences[0].observedOutcome;
  const qualified = taintOf(e, input.trustView);
  assert.equal(qualified.trust, 'verified'); assert.equal(qualified.independentOutcome, true);
  assert.deepEqual(qualified.taintedSourceIds, ['tainted-ancestor']);
  input.trustView.sources[1].outcome!.contentDigest = '2'.repeat(64);
  assert.equal(taintOf(e, input.trustView).trust, 'untrusted');
  input.trustView.sources[1].outcome!.contentDigest = e.contentDigest;
  input.trustView.sources[1].producerId = input.trustView.producers[0].producerId;
  assert.ok(taintOf(e, input.trustView).reasons.includes('self-judged'));
});

it('missing, ambiguous, private, cross-scope and cyclic source resolution stays visible', async () => {
  const input = await selectionFixture(), e = input.experiences[0], source = input.trustView.sources[0];
  source.parents = [{ sourceId: source.sourceId, digest: source.digest, kind: source.kind }];
  e.observedOutcome = null;
  assert.ok(taintOf(e, input.trustView).reasons.includes('tainted-lineage'));
  source.scope = 'foreign'; source.privacy = 'private';
  assert.ok(taintOf(e, input.trustView).reasons.includes('cross-scope'));
  assert.ok(taintOf(e, input.trustView).reasons.includes('private-scope'));
  input.trustView.sources.push({ ...source, producerId: 'ambiguous' });
  assert.ok(taintOf(e, input.trustView).reasons.includes('missing-source-id'));
});
