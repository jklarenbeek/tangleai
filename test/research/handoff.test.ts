import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { RESEARCH_RECORD_KINDS } from '@tangleai/research';
import { createResearchHandoff, RESEARCH_HANDOFF_PATH, RESEARCH_HANDOFF_QUERY_PATH } from '../../benchmark/lib/research-handoff.ts';
import { RESEARCH_ROW_IDS } from '../../benchmark/lib/research-schema.ts';
import { requireResearchShape } from '../../benchmark/lib/research-validation.ts';
import type { ResearchReport, ResearchHandoff } from '../../benchmark/lib/research.types.ts';

const report: ResearchReport = JSON.parse(await readFile('benchmark/results/research.json', 'utf8'));
const query = JSON.parse(await readFile(RESEARCH_HANDOFF_QUERY_PATH, 'utf8'));
const committed = await readFile(RESEARCH_HANDOFF_PATH, 'utf8');

it('the native query reproduces the complete pinned handoff without fetching or changing its report', async () => {
  const before = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('The handoff has no network capability.'); };
  try {
    const first = await createResearchHandoff(report, query), second = await createResearchHandoff(report, query);
    assert.deepEqual(first, second); assert.equal(JSON.stringify(first, null, 2) + '\n', committed);
    assert.deepEqual(requireResearchShape<ResearchHandoff>('ResearchHandoff', first), first);
    assert.deepEqual(first.handoff.rows.map(row => row.id), RESEARCH_ROW_IDS);
    assert.deepEqual(first.handoff.recordNames, RESEARCH_RECORD_KINDS);
    assert.deepEqual(first.handoff.modes.map(row => [row.id, row.experimental, row.interventions.total, row.interventions.automatic]),
      [['gate-only-full', false, 6, 0], ['full-auto-full', true, 6, 6]]);
    const { artifactId, ...content } = first;
    assert.equal(artifactId, await canonicalSha256(content));
    assert.deepEqual(first.handoff.limitations, report.limitations);
  } finally { globalThis.fetch = before; }
});

it('handoff admission rejects changed report hashes, missing rows and a rehashed false public record census', async () => {
  const altered = structuredClone(report); altered.reportId = 'f'.repeat(64);
  await assert.rejects(createResearchHandoff(altered, query));
  for (const change of [(value: ResearchReport) => { value.rows.pop(); },
    (value: ResearchReport) => { value.recordNames.pop(); }]) {
    const value = structuredClone(report); change(value);
    const { reportId: _id, ...content } = value; value.reportId = await canonicalSha256(content);
    await assert.rejects(createResearchHandoff(value, query));
  }
});

it('a query cannot substitute identities, invent costs or remove experimental mode and limitation disclosures', async () => {
  const changes = [
    (value: typeof query) => { value.reportId = 'f'.repeat(64); },
    (value: typeof query) => { value.fixture.id = 'invented-fixture'; },
    (value: typeof query) => { value.rows[0].$return.id = 'artifact-oracle'; },
    (value: typeof query) => { value.rows[0].$return.cost = { calls: 999, tokens: 0, ms: 0, physical: 0 }; },
    (value: typeof query) => { value.modes[0].$return.experimental = false; },
    (value: typeof query) => { value.limitations = ['Invented unrestricted quality claim.']; },
  ];
  for (const change of changes) { const value = structuredClone(query); change(value); await assert.rejects(createResearchHandoff(report, value)); }
});

it('handoff creation captures both report and query before hashing yields', async () => {
  const value = structuredClone(report), document = structuredClone(query), pending = createResearchHandoff(value, document);
  value.limitations.length = 0; document.reportId = 'a'.repeat(64);
  assert.equal(JSON.stringify(await pending, null, 2) + '\n', committed);
});
