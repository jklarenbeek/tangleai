import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import { buildResearchDomainsReport, renderResearchDomains, validateResearchDomainsShape } from '../../benchmark/lib/research-domains.ts';
import { DOMAIN_BUDGET } from '../../benchmark/lib/research-domain-runtime.ts';
import { RESEARCH_DOMAIN_ROW_IDS } from '../../benchmark/lib/research-domains-schema.ts';

test('both profiles reproduce equal-budget native rows, guarded lessons and retained losses twice without network', async () => {
  const previous = globalThis.fetch; let network = 0;
  globalThis.fetch = (async () => { network++; throw Error('The deterministic domain instrument attempted network I/O.'); }) as typeof fetch;
  try {
    const loaded = await loadResearchFixture(), first = await buildResearchDomainsReport(loaded), second = await buildResearchDomainsReport(loaded);
    assert.equal(canonicalizeJson(first), canonicalizeJson(second)); assert.deepEqual(renderResearchDomains(first), renderResearchDomains(second));
    assert.equal(network, 0); assert.deepEqual(first.rows.map(row => row.id), RESEARCH_DOMAIN_ROW_IDS);
    assert.equal(validateResearchDomainsShape(first).valid, true); assert.equal(first.external.reason, 'manifest-unpinned');
    for (const row of first.rows) {
      assert.deepEqual(row.budget, DOMAIN_BUDGET); assert.equal(row.identityStatus, 'run'); assert.equal(row.activated, false);
      for (const topic of row.topics) {
        assert.equal(topic.lifecycle.modelCalls, 0); assert.equal(topic.lifecycle.status, 'completed');
        assert.equal(topic.lifecycle.runs.length, topic.lifecycle.observations.length);
        assert.equal(topic.lifecycle.spend.physical, topic.lifecycle.runs.length);
        assert.equal(topic.lifecycle.state.status, topic.result === 'improvement' ? 'COMPLETE' : 'STOPPED');
        for (const manifest of topic.lifecycle.manifests) assert.equal(manifest.toolVersions.find(value => value.name === 'research-domain-profile')?.version, row.profileRevision);
      }
      if (row.id.endsWith('/lessons-on')) {
        assert.equal(row.lesson?.phase, 'approval'); assert.equal(row.lesson?.code, 'TRSH2007'); assert.equal(row.lesson?.cause, 'OUTC1011');
        assert.ok(row.lesson?.validationRun); assert.ok(row.eligibilityIssues.length); assert.equal(row.spend.calls, 1); assert.equal(row.spend.tokens, 48);
        assert.equal(row.lesson?.procedureReads.length, row.topics.length);
      } else assert.equal(row.lesson, null);
    }
    for (const offset of [0, 3]) {
      const off = first.rows[offset + 1], on = first.rows[offset + 2];
      assert.equal(off.comparisonIdentity, on.comparisonIdentity);
      assert.deepEqual(off.topics.map(row => [row.topicHash, row.result, row.claimSupport]), on.topics.map(row => [row.topicHash, row.result, row.claimSupport]));
    }
    assert.deepEqual(first.rows[3].topics.map(row => row.result), ['improvement', 'no-improvement', 'no-improvement', 'no-improvement']);
    for (const topic of first.rows[3].topics) {
      assert.equal(topic.tabular?.pairs, 24); assert.equal(topic.tabular?.interval.quantile, 'nearest-rank');
      assert.ok(topic.lifecycle.observations.every(row => row.unit === 'points' && row.direction === 'maximize'));
    }
    for (const gate of ['binding', 'controlPlane', 'registry', 'comparable'] as const) {
      const changed = structuredClone(first); changed.gate[gate] = !changed.gate[gate]; assert.equal(validateResearchDomainsShape(changed).valid, false, gate);
    }
    const cost = structuredClone(first); cost.rows[0].topics[0].lifecycle.spend.physical++; assert.equal(validateResearchDomainsShape(cost).valid, false);
    const missing = structuredClone(first) as any; delete missing.rows[4].topics[0].lifecycle.observations[0].registrySignature;
    assert.equal(validateResearchDomainsShape(missing).valid, false);
  } finally { globalThis.fetch = previous; }
});
