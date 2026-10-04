import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { loadResearchFixture, RESEARCH_FIXTURE_PATH, researchBytesSha256 } from '../../benchmark/lib/research-fixture.ts';
import { verifyResearchBundle, researchCeilings, researchDisclosures } from '../../benchmark/lib/research-oracle.ts';
import { evaluateResearchRun, researchObservationSignature, researchComparison } from '../../benchmark/lib/research-evaluator.ts';
import { executeResearchProgram, researchProgramInput } from '../../benchmark/lib/research-programs.ts';
import { runResearchFixture } from '../../benchmark/lib/research-runner.ts';
import type { ResearchBundle, ResearchFixtureManifest, ResearchFixtureTopic } from '../../benchmark/lib/research.types.ts';

const loaded = await loadResearchFixture();
async function rehashManifest(bundle: ResearchBundle): Promise<void> {
  const { manifestHash: _hash, ...body } = bundle.manifest;
  bundle.manifest.manifestHash = await canonicalSha256(body);
  for (const action of bundle.interventions) action.reviewedManifestHash = action.approvedManifestHash = bundle.manifest.manifestHash;
  bundle.disclosure = researchDisclosures(bundle);
}
async function fixtureCopy(work: (root: string, dir: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'tangle-research-fixture-')), directory = join(root, RESEARCH_FIXTURE_PATH);
  try {
    await cp(RESEARCH_FIXTURE_PATH, directory, { recursive: true });
    await mkdir(join(root, 'benchmark/lib'), { recursive: true });
    await cp('benchmark/lib/research-programs.ts', join(root, 'benchmark/lib/research-programs.ts'));
    await work(root, directory);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function changeRegisteredJson(directory: string, path: string, change: (value: any) => void): Promise<void> {
  const value = JSON.parse(await readFile(join(directory, path), 'utf8')); change(value);
  const bytes = JSON.stringify(value, null, 2) + '\n'; await writeFile(join(directory, path), bytes);
  const manifest: ResearchFixtureManifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  manifest.members.find(member => member.path === path)!.sha256 = researchBytesSha256(bytes);
  const { revision: _revision, ...body } = manifest; manifest.revision = await canonicalSha256(body);
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

describe('research fixture oracle', () => {
  it('the oracle retains every required claim and reaches the attainable source ceiling', async () => {
    assert.equal(loaded.literature.length, 24);
    for (const topic of loaded.topics) {
      const bundle = loaded.oracles.get(topic.id)!, checked = await verifyResearchBundle(loaded, bundle);
      assert.equal(checked.valid, true, JSON.stringify(checked.issues));
      assert.deepEqual(new Set(checked.supported), new Set(loaded.hidden.get(topic.id)!.requiredClaims.map(claim => claim.id)));
      assert.equal(checked.rerun.passed, topic.plan.conditions.length * topic.contract.replicatePolicy.seeds.length);
      assert.deepEqual(researchCeilings(loaded, topic).literatureRecall, { passed: 6, total: 8, value: 0.75 });
    }
  });
  it('every invalid bundle fails for its pinned reason', async () => {
    assert.equal(loaded.invalid.length, 21);
    for (const fixture of loaded.invalid) {
      const result = await verifyResearchBundle(loaded, fixture.bundle);
      assert.equal(result.valid, false, fixture.id);
      assert.deepEqual({ code: result.issues[0]?.code, path: result.issues[0]?.path }, fixture.expected, fixture.id);
      if (fixture.id === 'inflated-claim') assert.deepEqual(result.unresolved, ['kmeans-seeding-literature']);
    }
  });
  it('independent evaluation refuses a fabricated metric after its signature and manifest are rehashed', async () => {
    const bundle = structuredClone(loaded.oracles.get('kmeans-seeding')!), observation = bundle.observations[0];
    observation.value += 100;
    observation.registrySignature = await researchObservationSignature(observation);
    observation.id = 'metric-' + observation.registrySignature;
    bundle.manifest.observationIds = bundle.observations.map(item => item.id); await rehashManifest(bundle);
    const checked = await verifyResearchBundle(loaded, bundle);
    assert.equal(checked.valid, false); assert.equal(checked.issues[0].path, '/observations/0/value');
  });
  it('a self-consistent forged raw output and evaluator metric still fails the independent rerun', async () => {
    const topic = loaded.topics[0], bundle = structuredClone(loaded.oracles.get(topic.id)!), run = bundle.runs[0];
    assert.equal(run.output!.kind, 'clusters'); if (run.output!.kind !== 'clusters') throw new Error('expected clusters');
    run.output!.centroids[0][0] += 1;
    run.rawArtifactHash = await canonicalSha256(run.output); run.trace[1].detail = run.rawArtifactHash;
    const evaluated = await evaluateResearchRun(topic, loaded.datasets.get(topic.datasetPath)!, loaded.hidden.get(topic.id)!, run);
    assert.equal(evaluated.valid, true); if (!evaluated.valid) throw new Error('expected evaluator value');
    bundle.observations[0] = evaluated.observation; bundle.manifest.observationIds = bundle.observations.map(item => item.id);
    await rehashManifest(bundle);
    const checked = await verifyResearchBundle(loaded, bundle);
    assert.equal(checked.valid, false); assert.equal(checked.issues[0].path, '/runs/0/output');
  });
  it('a trace must retain the actual start and raw-output identities', async () => {
    const bundle = structuredClone(loaded.oracles.get('kmeans-seeding')!); bundle.runs[0].trace[1].detail = 'unrelated-output';
    const checked = await verifyResearchBundle(loaded, bundle);
    assert.equal(checked.valid, false); assert.equal(checked.issues[0].path, '/runs/0/trace');
  });
  it('keyless artifacts cannot invent provider spend or a foreign project identity', async () => {
    const cost = structuredClone(loaded.oracles.get('kmeans-seeding')!); cost.runs[0].spend.physical = 1;
    const costChecked = await verifyResearchBundle(loaded, cost);
    assert.equal(costChecked.valid, false); assert.equal(costChecked.issues[0].path, '/runs/0/spend');
    const foreign = structuredClone(loaded.oracles.get('kmeans-seeding')!); foreign.manifest.projectId = 'foreign-project';
    await rehashManifest(foreign);
    const projectChecked = await verifyResearchBundle(loaded, foreign);
    assert.equal(projectChecked.valid, false); assert.equal(projectChecked.issues[0].path, '/manifest/projectId');
  });
  it('native evidence references also retain exact source and raw-output quotes', async () => {
    for (const index of [0, 2]) {
      const bundle = structuredClone(loaded.oracles.get('kmeans-seeding')!);
      bundle.claimLedger.evidence[index].quote = 'invented quotation';
      const checked = await verifyResearchBundle(loaded, bundle);
      assert.equal(checked.valid, false); assert.equal(checked.issues[0].path, '/claimLedger/evidence/' + index + '/quote');
    }
  });
  it('an invented locator or extraction prompt cannot validate an evidence card', async () => {
    const bundle = structuredClone(loaded.oracles.get('kmeans-seeding')!); bundle.evidence[0].extractionPromptRevision = '0'.repeat(64);
    const checked = await verifyResearchBundle(loaded, bundle);
    assert.equal(checked.valid, false); assert.equal(checked.issues[0].path, '/evidence/0/extractionPromptRevision');
  });
  it('artifact ids use the same content address for sources and experiment outputs', () => {
    for (const bundle of loaded.oracles.values()) for (const artifact of bundle.claimLedger.artifacts) {
      assert.equal(artifact.id, 'art-' + artifact.digest);
    }
  });
  it('the reviewed manifest binds claim placement and evidence as well as execution', async () => {
    const bundle = structuredClone(loaded.oracles.get('kmeans-seeding')!);
    bundle.claims[0].section = 'abstract';
    const checked = await verifyResearchBundle(loaded, bundle);
    assert.equal(checked.valid, false); assert.equal(checked.issues[0].path, '/manifest/reviewedEvidenceHash');
  });
  it('the no-model prose builder never reads the hidden claim or literature rubric', async () => {
    const hidden = new Map(loaded.hidden);
    for (const [id, labels] of hidden) hidden.set(id, new Proxy(labels, { get(value, property, receiver) {
      if (property === 'requiredClaims' || property === 'relevantLiterature') throw new Error('Rubric leakage.');
      return Reflect.get(value, property, receiver);
    } }));
    for (const topic of loaded.topics) {
      const bundle = await runResearchFixture({ ...loaded, hidden }, topic, 'no-model-runner');
      assert.equal(bundle.claims.length, 2); assert.ok(bundle.claims.every(claim => claim.kind === 'metric'));
      assert.equal(bundle.interventions.length, 0);
    }
  });
  it('clustering reproduces every registered seed and preserves inconclusive outcomes', async () => {
    const topic = loaded.topics[0], dataset = loaded.datasets.get(topic.datasetPath)!;
    for (const condition of topic.plan.conditions) for (const seed of topic.contract.replicatePolicy.seeds)
      assert.deepEqual(await executeResearchProgram(condition.programId, dataset, seed, condition.params),
        await executeResearchProgram(condition.programId, dataset, seed, condition.params));
    const comparison = researchComparison(topic, loaded.oracles.get(topic.id)!.observations);
    assert.deepEqual([comparison.result, comparison.wins, comparison.losses, comparison.ties, comparison.interval.lower], ['inconclusive', 2, 0, 3, 0]);
  });
  it('both embedding widths are saturated and hidden labels affect only evaluation', async () => {
    const topic = loaded.topics[2], dataset = loaded.datasets.get(topic.datasetPath)!, bundle = loaded.oracles.get(topic.id)!;
    assert.equal(researchComparison(topic, bundle.observations).result, 'SATURATED');
    const changed = structuredClone(loaded.hidden.get(topic.id)!);
    const run = bundle.runs[0]; assert.equal(run.output!.kind, 'rankings');
    const output = run.output;
    if (!output || output.kind !== 'rankings' || dataset.kind !== 'corpus') throw new Error('expected rankings');
    const rankings = output.rankings;
    const missing = dataset.documents.find(document => !rankings[0].hits.some(hit => hit.id === document.id))!;
    changed.queryGold[0].relevantIds = [missing.id];
    const condition = topic.plan.conditions[0];
    const input = { ...dataset, queryGold: changed.queryGold, secret: 'not program input' };
    assert.deepEqual(researchProgramInput(input), dataset);
    const executed = await executeResearchProgram(condition.programId, input, run.seed, condition.params);
    assert.equal(executed.ok, true); if (!executed.ok) throw new Error('expected raw output');
    assert.deepEqual(executed.output, run.output);
    const evaluated = await evaluateResearchRun(topic, dataset, changed, run);
    assert.equal(evaluated.valid, true); if (!evaluated.valid) throw new Error('expected changed metric');
    assert.equal(evaluated.observation.value, 7 / 8);
  });
  it('the negative programs return classified failures or raw files, never observations', async () => {
    const dataset = loaded.datasets.get(loaded.topics[0].datasetPath)!;
    for (const [program, code] of [['throws', 'TRSH1008'], ['reads-hidden', 'TRSH1005'], ['unknown', 'TRSH1003']]) {
      const result = await executeResearchProgram(program, dataset, 1, {});
      assert.equal(result.ok, false); if (result.ok) throw new Error('expected refusal'); assert.equal(result.issue.code, code);
    }
    const files = await executeResearchProgram('writes-metrics', dataset, 1, {});
    assert.equal(files.ok, true); if (!files.ok) throw new Error('expected raw files'); assert.equal(files.output.kind, 'files');
  });
  it('fixture bytes, member census and symlinks cannot silently drift', async () => {
    await fixtureCopy(async (root, directory) => {
      await writeFile(join(directory, 'datasets/blobs.json'), '{}\n');
      await assert.rejects(loadResearchFixture(root), /byte drift/);
    });
    await fixtureCopy(async (root, directory) => {
      await writeFile(join(directory, 'unregistered.txt'), 'extra');
      await assert.rejects(loadResearchFixture(root), /unregistered/);
    });
    await fixtureCopy(async (root, directory) => {
      await symlink('datasets/blobs.json', join(directory, 'redirect.json'));
      await assert.rejects(loadResearchFixture(root), /symbolic links/);
    });
  });
  it('preregistration hashes and licence references are verified beyond member digests', async () => {
    await fixtureCopy(async (root, directory) => {
      await changeRegisteredJson(directory, 'topics/kmeans-seeding.json', (topic: ResearchFixtureTopic) => {
        topic.licence.spdx = 'NOASSERTION'; topic.licence.provenance = 'provider-metadata';
      });
      await assert.rejects(loadResearchFixture(root), /licence/);
    });
    await fixtureCopy(async (root, directory) => {
      await changeRegisteredJson(directory, 'topics/kmeans-seeding.json', (topic: ResearchFixtureTopic) => { topic.contract.successRule.minImprovement = 1; });
      await assert.rejects(loadResearchFixture(root), /contract hash/);
    });
    await fixtureCopy(async (root, directory) => {
      await changeRegisteredJson(directory, 'topics/kmeans-seeding.json', (topic: ResearchFixtureTopic) => { topic.licence.source = '../unlicensed'; });
      await assert.rejects(loadResearchFixture(root), /licence/);
    });
  });
});
