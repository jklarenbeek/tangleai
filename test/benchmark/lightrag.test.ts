/** An independent scorer gate precedes every graph mechanism and published score. */
import { it } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadLightRagFixture, buildLightRagReport, createLightRagValidator, requireLightRagGate, renderLightRagDocument, renderLightRagReport, LIGHTRAG_ROWS } from '../../benchmark/lib/lightrag.ts';
import { graphMetrics } from '../../benchmark/lib/lightrag-measure.ts';
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
it('all four graph rows execute with named candidate sources, observed denominators and unchanged baseline rows', () => {
    assert.deepEqual(report.rows.map(row => row.key), LIGHTRAG_ROWS);
    const hashes=['12169967f92fe16a1c1280c022f0c427afd30432d794ef23a84aecb92cffbaea','c8c9a4b6bf4b391c4e1197777cd1afd44880c04dbe34da5704e8ddb8e204043f','c55fc169d88aede12cc44440f3d8fa95c3e8954f6a9135299ea65b587732b2c8'];
    for(const [i,row]of report.rows.entries()){
        assert.equal(row.status,'executed');assert.equal(row.cases.length,18);assert.equal(row.byKind.length,3);assert.deepEqual(row.cost,{calls:0,tokens:0,ms:0});
        if(i<3){const {resolution,...citations}=row.citations;assert.equal(resolution,1);assert.equal(createHash('sha256').update(JSON.stringify({...row,citations})).digest('hex'),hashes[i]);continue;}
        assert.equal(row.identity.providerStatus,'scripted');assert.equal(row.graph!.skipped.unresolvable,0);assert.equal(row.metrics.graph!.entityQuestions,18);assert.equal(row.metrics.graph!.relationQuestions,18);
        assert.ok(row.cases.every(value=>value.graph!.contextTokens<=row.limits.contextTokens));
        assert.equal(row.graph!.candidateSources.entityKeywords,row.key!=='lightrag-high');assert.equal(row.graph!.candidateSources.relationKeywords,row.key!=='lightrag-low');assert.equal(row.graph!.candidateSources.originalChunks,row.key!=='lightrag-hybrid-no-original');
    }
    const {stages,...indexing}=report.indexing;assert.deepEqual(indexing,{backend:'memory',contributions:7,entities:20,relations:18,entityClaims:62,relationClaims:38,localCalls:14,budgetTokens:214,providerCalls:0,providerTokens:0,documentEmbeddingCalls:7,extractionPasses:34,profiledCanonicals:51,coreferenceCalls:4});assert.equal(stages.length,7);
    assert.equal(report.incremental.length,2);const {fixtureId,...guild}=report.incremental[0];assert.equal(fixtureId,loaded.fixtureId);
    assert.deepEqual(guild,{source:'guild',previousVersion:'guild@1',version:'guild@2',chunks:2,reextractedChunks:2,unrelatedChunksExtracted:0,canonicalsTouched:8,unaffectedCanonicals:6,unaffectedRevisionsChanged:0,claimsWithdrawn:13,withdrawnSupportRemaining:0,localCalls:2,budgetTokens:27,providerCalls:0});
    assert.deepEqual(report.incremental[1],{fixtureId:'b3af26a423ff7f1210e4c03b119ffe295530c539930c60f68a64334c240f5285',source:'relay-history',previousVersion:'relay-history@1',version:'relay-history@2',chunks:1,reextractedChunks:1,unrelatedChunksExtracted:0,canonicalsTouched:5,unaffectedCanonicals:1,unaffectedRevisionsChanged:0,claimsWithdrawn:3,withdrawnSupportRemaining:0,localCalls:2,budgetTokens:13,providerCalls:0});
    assert.equal(report.graphCoverage.entities.fraction,1);assert.equal(report.graphCoverage.relations.fraction,1);assert.ok(report.rows.every(row=>row.citations.resolution===1));
});
it('specific low and abstract high queries retrieve every gold citation, while expansion alone reaches the distinct one-hop fact',()=>{
    for(const [key,kind]of [['lightrag-low','specific'],['lightrag-high','abstract']])for(const row of report.rows.find(row=>row.key===key)!.cases.filter(row=>row.kind===kind)){
        const question=loaded.fixture.questions.find(question=>question.id===row.question)!;assert.ok(question.goldChunks.every(id=>row.ranked.includes(id)),row.question);
    }
    assert.equal(report.gate.oneHop.oneHopFound,true);assert.equal(report.gate.oneHop.twoHopFound,false);assert.equal(report.gate.oneHop.withoutExpansionOneHopFound,false);
    const hybrid=report.rows[5],ablated=report.rows[6];assert.deepEqual(hybrid.metrics,ablated.metrics);
    for(const [i,row]of hybrid.cases.entries()){assert.deepEqual(row.ranked,ablated.cases[i].ranked);assert.deepEqual(row.graph!.entities,ablated.cases[i].graph!.entities);assert.deepEqual(row.graph!.relations,ablated.cases[i].graph!.relations);assert.equal(ablated.cases[i].graph!.originalChunks,0);}
    const document=renderLightRagDocument(report);assert.ok(document.indexOf('same chunk recall as hybrid by construction')<document.indexOf('| Row |'));assert.match(document,/Every graph loss against dense/);assert.ok(report.rows[2].metrics.recall[5]>report.rows[5].metrics.recall[5]);
});
it('native assertions reject forged graph costs, strata, recall, ablations, budgets and hop outcomes',()=>{
    const mutations:Array<(value:typeof report)=>void>=[
        value=>{value.rows[3].graph!.localCalls++;},value=>{value.rows[3].byKind[0].metrics.graph!.entityQuestions--;},value=>{value.rows[3].byKind[0].metrics.recall[3]=0;},
        value=>{value.rows[3].graph!.candidateSources.relationKeywords=true;},value=>{value.rows[3].cases[0].graph!.candidates.relationKeywords=1;},value=>{value.rows[3].cases[0].graph!.entityRecall=0;},
        value=>{value.rows[3].cases[0].graph!.contextTokens=4001;},value=>{value.rows[3].cases[0].graph!.prune['context-budget']++;},value=>{value.rows[3].cases[0].graph!.skipped.width++;},
        value=>{value.rows[6].cases[0].graph!.originalChunks=1;},value=>{value.rows[6].cases[0].ranked.reverse();},value=>{value.gate.oneHop.oneHopFound=false;},value=>{value.gate.oneHop.withExpansion.chunkKeys.push('far-fact');},
        value=>{value.indexing.entities--;},value=>{value.indexing.profiledCanonicals++;},value=>{value.indexing.stages[0].profileCalls++;},value=>{value.incremental[0].unrelatedChunksExtracted++;},value=>{value.incremental[0].unaffectedRevisionsChanged++;},value=>{value.incremental[0].reextractedChunks++;},value=>{value.graphCoverage.entities.reached.pop();},value=>{value.rows[3].citations.resolution=0;},value=>{value.rows[3].cases.splice(0,1);}
    ];for(const [i,mutate]of mutations.entries()){const copy=structuredClone(report);mutate(copy);assert.equal(validate(copy).valid,false,'mutation '+i);}
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
        const dry=await exec(process.execPath,['benchmark/lightrag.ts','--live'],{maxBuffer:16*1024*1024});assert.match(dry.stdout,/lightrag-live-plan/);assert.match(dry.stderr,/Zero provider requests/);
        await assert.rejects(exec(process.execPath,['benchmark/lightrag.ts','--live','--authorize','incorrect'],{maxBuffer:16*1024*1024}),/zero requests/);
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

it('absent graph gold has a null recall and a zero observed denominator',()=>{
    const original=report.rows[3].cases[0],copy=structuredClone(original);copy.graph!.goldEntities=[];copy.graph!.goldRelations=[];copy.graph!.entityRecall=null;copy.graph!.relationRecall=null;
    assert.deepEqual(graphMetrics([copy]),{entityRecall:null,relationRecall:null,entityQuestions:0,relationQuestions:0});
    assert.deepEqual(graphMetrics([copy,original]),{entityRecall:original.graph!.entityRecall,relationRecall:original.graph!.relationRecall,entityQuestions:1,relationQuestions:1});
});
