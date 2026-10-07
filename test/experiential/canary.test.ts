import assert from 'node:assert/strict';
import { it } from 'node:test';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { canaryShareOf, routesToCanary } from '@tangleai/experiential';

const deployment = { id: 'd73221b1bb6e5611f5113288ff1d296cdc6d8da7fdc177ec845e35683c376afd',
  canaryArtifactId: '53c32dc020d8cc6f60190589927256eb8b1240c25207cee6ef954de466277aca', rolloutFraction: 0.25 };

it('retains the measured 10,000-run assignment twice without random or clock reads', async () => {
  const random = Math.random, now = Date.now;
  Math.random = () => { throw Error('Unexpected random read.'); };
  Date.now = () => { throw Error('Unexpected clock read.'); };
  const routed: boolean[] = [];
  try {
    for (let index = 0; index < 10000; index++) routed.push(await routesToCanary(deployment, 'synthetic-' + index));
    for (let index = 0; index < routed.length; index++) assert.equal(await routesToCanary(deployment, 'synthetic-' + index), routed[index]);
  } finally { Math.random = random; Date.now = now; }
  assert.equal(routed.filter(Boolean).length, 2469);
  assert.ok(Math.abs(2469 - 10000 * deployment.rolloutFraction) <= 150);
  assert.equal(await canonicalSha256(routed), '662f4d0feeb21e547c2da731573f25ecf1522c45134883c347b1b98507c276d6');
});

it('uses strict share boundaries, including zero, one and an absent canary', async () => {
  const share = await canaryShareOf(deployment.id, 'boundary');
  assert.ok(share >= 0 && share < 1);
  assert.equal(await routesToCanary({ ...deployment, rolloutFraction: share }, 'boundary'), false);
  assert.equal(await routesToCanary({ ...deployment, rolloutFraction: 0 }, 'boundary'), false);
  assert.equal(await routesToCanary({ ...deployment, rolloutFraction: 1 }, 'boundary'), true);
  assert.equal(await routesToCanary({ ...deployment, canaryArtifactId: null, rolloutFraction: 0 }, 'boundary'), false);
  await assert.rejects(routesToCanary({ ...deployment, canaryArtifactId: null }, 'boundary'), TypeError);
});

it('refuses unbounded run ids and invalid fractions before assignment', async () => {
  for (const runId of ['', ' ', 'x'.repeat(257)]) await assert.rejects(canaryShareOf(deployment.id, runId), TypeError);
  await assert.rejects(canaryShareOf('not-an-address', 'run'), TypeError);
  for (const rolloutFraction of [-1, 1.1, NaN, Infinity]) await assert.rejects(routesToCanary({ ...deployment, rolloutFraction }, 'run'), TypeError);
});
