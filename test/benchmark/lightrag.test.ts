/** An independent scorer gate precedes every graph mechanism and published score. */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadLightRagFixture, buildLightRagReport, createLightRagValidator, requireLightRagGate, renderLightRagDocument, renderLightRagReport, LIGHTRAG_ROWS } from '../../benchmark/lib/lightrag.ts';
const exec = promisify(execFile), loaded = await loadLightRagFixture(), report = await buildLightRagReport({ loaded }), validate = createLightRagValidator();
it('the fixture freezes graph identities, repeated source elements and six questions of each kind', () => {
    assert.equal(report.fixture.sources, 6); assert.equal(report.fixture.questions, 18); assert.equal(report.fixture.entities, 20); assert.equal(report.fixture.relations, 18);
    assert.equal(report.fixture.aliasPairs, 2); assert.equal(report.fixture.sameNameCollisions, 2); assert.equal(report.fixture.reversedEdgePairs, 1);
    assert.equal(report.fixture.multipleRelationPairs, 1); assert.ok(report.fixture.duplicateElementPairs >= 3);
    assert.ok(loaded.fixture.sources.some(source => source.versions.some(version => version.status === 'superseded')));
    for (const kind of ['specific','abstract','one-hop']) assert.equal(loaded.fixture.questions.filter(question => question.kind === kind).length, 6);
});
it('gold and support ids all resolve and the oracle equals its exact ceilings', () => {
    assert.equal(report.gate.passed, true); requireLightRagGate(report);
    assert.equal(report.gate.resolution.unresolved, 0); assert.deepEqual(report.gate.oracle.actual, report.gate.oracle.expected);
    assert.ok(report.gate.random.every(row => row.passed)); assert.equal(validate(report).valid, true);
});
it('dense retrieval executes while every graph row retains null missing measurements', () => {
    assert.deepEqual(report.rows.map(row => row.key), LIGHTRAG_ROWS);
    assert.equal(report.rows[2].status, 'executed'); assert.equal(report.rows[2].cases.length, 18); assert.equal(report.rows[2].byKind.length, 3);
    for (const row of report.rows.slice(3)) {
        assert.equal(row.status, 'not-run'); assert.equal(row.reason, 'implementation-missing'); assert.equal(row.metrics, null);
        assert.deepEqual(row.cost, { calls: null, tokens: null, ms: null }); assert.equal(row.citations, null); assert.deepEqual(row.cases, []);
    }
});
it('the schema refuses a row without corpus, question-set, retrieval, identity, embedder, cost or limits', () => {
    for (const key of ['corpusId','questionSetId','retrievalMode','model','prompts','embeddedBy','chunker']) {
        const copy = structuredClone(report); delete (copy.rows[2].identity as unknown as Record<string,unknown>)[key]; assert.equal(validate(copy).valid, false, key);
    }
    for (const key of ['cost','limits']) {
        const copy = structuredClone(report); delete (copy.rows[2] as unknown as Record<string,unknown>)[key]; assert.equal(validate(copy).valid, false, key);
    }
    for (const mutate of [
        (value: typeof report) => { value.rows.reverse(); },
        (value: typeof report) => { value.rows[2].cases.reverse(); },
        (value: typeof report) => { value.rows[2].cases[0].question = value.rows[2].cases[1].question; },
    ]) { const changed = structuredClone(report); mutate(changed); assert.equal(validate(changed).valid, false); }
    const forged = structuredClone(report); forged.rows[2].metrics!.count--; assert.equal(validate(forged).valid, false);
    const hidden = structuredClone(report); hidden.rows[3].metrics = report.rows[2].metrics; assert.equal(validate(hidden).valid, false);
});
it('an unknown gold id fails the oracle resolution gate without repairing the fixture', async () => {
    const copy = structuredClone(loaded); copy.fixture.questions[0].goldChunks = ['unknown'];
    const result = await buildLightRagReport({ loaded: copy });
    assert.equal(result.gate.passed, false); assert.equal(result.gate.resolution.unresolved, 1);
    assert.throws(() => requireLightRagGate(result), /oracle.*unresolved/);
});
it('the CLI rejects an unresolved gold chunk before printing or writing any report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lightrag-invalid-gold-'));
    try {
        await mkdir(join(root, 'benchmark/fixtures'), { recursive: true });
        await cp('benchmark/fixtures/lightrag', join(root, 'benchmark/fixtures/lightrag'), { recursive: true });
        const changed = structuredClone(loaded.fixture); changed.questions[0].goldChunks = ['unknown-gold-chunk'];
        await writeFile(join(root, 'benchmark/fixtures/lightrag/manifest.json'), JSON.stringify(changed));
        const json = join(root, 'rejected.json'), md = join(root, 'rejected.md');
        await assert.rejects(exec(process.execPath, [join(process.cwd(), 'benchmark/lightrag.ts'), '--json', json, '--md', md], { cwd: root }),
            (error: unknown) => {
                const failure = error as { code: number; stdout: string; stderr: string };
                assert.equal(failure.code, 1); assert.equal(failure.stdout, '');
                assert.match(failure.stderr, /oracle\/support reference is unresolved: unknown-gold-chunk/); return true;
            });
        await assert.rejects(access(json)); await assert.rejects(access(md));
    } finally { await rm(root, { recursive: true, force: true }); }
});
it('two keyless runs render byte-identical JSON and Markdown and never reach a network', async () => {
    const original = globalThis.fetch; let requests = 0;
    globalThis.fetch = async () => { requests++; throw Error('Unexpected network.'); };
    try {
        const repeat = await buildLightRagReport();
        assert.equal(renderLightRagReport(repeat), renderLightRagReport(report)); assert.equal(renderLightRagDocument(repeat), renderLightRagDocument(report));
        assert.equal(requests, 0);
    } finally { globalThis.fetch = original; }
});
it('substituted source bytes and dangling authored support are refused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lightrag-fixture-'));
    try {
        await mkdir(join(root,'benchmark/fixtures'),{recursive:true}); await cp('benchmark/fixtures/lightrag',join(root,'benchmark/fixtures/lightrag'),{recursive:true});
        const manifest = join(root,'benchmark/fixtures/lightrag/manifest.json'), copy = structuredClone(loaded.fixture);
        copy.entities[0].supportChunks = ['unknown']; await writeFile(manifest,JSON.stringify(copy)); await assert.rejects(loadLightRagFixture(root), /oracle\/support reference is unresolved/);
        await writeFile(manifest,JSON.stringify(loaded.fixture)); await writeFile(join(root,'benchmark/fixtures/lightrag',copy.sources[0].versions[0].file),'Substituted corpus.');
        await assert.rejects(loadLightRagFixture(root), /manifest digest/);
    } finally { await rm(root,{recursive:true,force:true}); }
});
it('the CLI writes only gated artifacts, checks without writing and refuses live spending', async () => {
    const root = await mkdtemp(join(tmpdir(),'lightrag-cli-'));
    try {
        const json = join(root,'report.json'), md = join(root,'report.md');
        await exec(process.execPath,['benchmark/lightrag.ts','--json',json,'--md',md]);
        assert.equal(await readFile(json,'utf8'),renderLightRagReport(report)); assert.equal(await readFile(md,'utf8'),renderLightRagDocument(report));
        await exec(process.execPath,['benchmark/lightrag.ts','--check','--json',json,'--md',md]);
        await assert.rejects(exec(process.execPath,['benchmark/lightrag.ts','--live']), /Live tier arrives with the ablation order; zero requests/);
        await writeFile(json,'{}'); await assert.rejects(exec(process.execPath,['benchmark/lightrag.ts','--check','--json',json,'--md',md]), /artifact drift/);
    } finally { await rm(root,{recursive:true,force:true}); }
});
it('the committed report and document are the measured command output', async () => {
    assert.equal(await readFile('benchmark/results/lightrag.json','utf8'),renderLightRagReport(report));
    assert.equal(await readFile('docs/LIGHTRAG_BENCHMARK.md','utf8'),renderLightRagDocument(report));
});
it('registered adversaries carry the future native refusal vocabulary', async () => {
    const directory='test/fixtures/lightrag', names=(await readdir(directory)).filter(name=>name.endsWith('.json')).sort();
    assert.equal(names.length,8);const codes=new Set<string>();
    for(const name of names){const value=JSON.parse(await readFile(join(directory,name),'utf8'));assert.match(value.expectedCode,/^TLRAG100[13689]$/);codes.add(value.expectedCode);}
    assert.deepEqual([...codes].sort(),['TLRAG1001','TLRAG1003','TLRAG1006','TLRAG1008','TLRAG1009']);
});
