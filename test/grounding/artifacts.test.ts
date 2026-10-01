import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { JarenValidator } from '@jarenjs/validate';
import { compileGmplPromptPack, renderGmplPrompt } from '@tangleai/gmpl';
import { groundingArtifacts } from '@tangleai/grounding';
it('all seven packs compile to their installed artifacts and enforce one question', async () => {
    assert.equal(groundingArtifacts.prompts.length, 7);
    for (const artifact of groundingArtifacts.prompts) {
        const name = artifact.id.replace('grounding-', ''), source = await readFile(`prompts/grounding/${name}.toml`, 'utf8');
        const compiled = await compileGmplPromptPack(source, { variables: artifact.variables, outputSchema: artifact.outputSchema });
        assert.ok(compiled.valid); assert.deepEqual(compiled.value, artifact);
        const minimal = renderGmplPrompt(artifact, { query: 'Which service?', evidence: [] }); assert.ok(minimal.valid);
        assert.ok(!minimal.value.user.includes('Declared stage context:'));
        const full = renderGmplPrompt(artifact, { query: '{{context}} $x', evidence: [], context: { supplied: '{{query}}' } }); assert.ok(full.valid);
        assert.ok(full.value.user.includes('{{context}} $x')); assert.ok(full.value.user.includes('"{{query}}"'));
    }
    const question = groundingArtifacts.prompts.find(prompt => prompt.id === 'grounding-question')!;
    const check = new JarenValidator().compile(question.outputSchema as Record<string, unknown>);
    assert.equal(check({ questions: [{ id: 'q1', text: 'Which service?' }] }), true);
    assert.equal(check({ questions: [{ id: 'q1', text: 'Which service?' }, { id: 'q2', text: 'Where?' }] }), false);
});
it('the artifact check rejects retained-byte drift without rewriting the artifact', async () => {
    execFileSync(process.execPath, ['scripts/grounding-artifacts.ts', '--check'], { stdio: 'pipe' });
    const directory = await mkdtemp(join(tmpdir(), 'grounding-artifacts-'));
    try {
        await mkdir(join(directory, 'prompts/grounding'), { recursive: true }); await mkdir(join(directory, 'packages/grounding/artifacts'), { recursive: true });
        for (const name of ['triage', 'question', 'resolve', 'plan', 'web-agent', 'web-sufficiency', 'web-rerank']) await writeFile(join(directory, `prompts/grounding/${name}.toml`), await readFile(`prompts/grounding/${name}.toml`));
        const path = join(directory, 'packages/grounding/artifacts/catalog.json');
        await writeFile(path, '{}\n');
        assert.throws(() => execFileSync(process.execPath, [resolve('scripts/grounding-artifacts.ts'), '--check'], { cwd: directory, stdio: 'pipe' }), /Grounding artifact drift/);
        assert.equal(await readFile(path, 'utf8'), '{}\n');
    } finally { await rm(directory, { recursive: true, force: true }); }
});
