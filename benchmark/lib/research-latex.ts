/** Optional host qualification; the public research package emits text and never spawns. */
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { equalsJson } from '@jarenjs/core/object';
import { createProcessRunner, type ProcessRunnerOptions } from '@tangleai/evolve/host';
import { ok, refuseOne } from '@tangleai/evolve';
import { researchArtifactIdOf, renderLatexBundle, immutableResearchJson, type ResearchExportManifest, type ExportReceipt } from '@tangleai/research';

type Compilation = { latex: ExportReceipt['latex']; spawns: number; log: string };
const compileArgs = ['-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'main.tex'];
export async function compileLatex(manifest: ResearchExportManifest, options: {
  spawn?: ProcessRunnerOptions['spawn']; binaries?: { pdflatex: string; bibtex: string }; signal?: AbortSignal;
} = {}): Promise<Compilation> {
  const spawn = options.spawn, signal = options.signal, binaries = options.binaries ? immutableResearchJson(options.binaries) : undefined;
  const rendered = await renderLatexBundle(manifest);
  if (!rendered.valid) return { latex: { state: 'refused', reason: rendered.issues.map(issue => issue.code + ' ' + issue.detail).join('; '), files: [] }, spawns: 0, log: '' };
  const files = rendered.value.files;
  const cwd = await mkdtemp(join(tmpdir(), 'tangle-research-tex-')), logs: string[] = [];
  const allowed = (argv: string[], choices: string[][]) => choices.some(choice => equalsJson(choice, argv)) ? ok(true as const)
    : refuseOne<true>('TEVO1006', '/args', 'Only the fixed TeX qualification arguments are admitted.');
  const runner = createProcessRunner({ ...(spawn ? { spawn } : {}), roots: { base: cwd },
    allow: { pdflatex: { file: binaries?.pdflatex ?? 'pdflatex', cwd: 'base', args: argv => allowed(argv, [['--version'], compileArgs]) },
      bibtex: { file: binaries?.bibtex ?? 'bibtex', cwd: 'base', args: argv => allowed(argv, [['--version'], ['main']]) } },
    env: { allow: ['PATH'], set: { TEXMFOUTPUT: cwd, TEXMFVAR: join(cwd, 'texmf-var'), TEXMFCONFIG: join(cwd, 'texmf-config') } },
    limits: { legMs: 30000, stdoutBytes: 131072, stderrBytes: 65536 } });
  const finish = (state: Compilation['latex']['state'], reason: string | null, entries: Compilation['latex']['files'] = []): Compilation => ({
    latex: { state, reason, files: entries }, spawns: runner.spawns, log: logs.join('\n') });
  try {
    for (const name of ['pdflatex', 'bibtex']) {
      const version = await runner.run({ name, args: ['--version'], cwd, ...(signal ? { signal } : {}) });
      if (!version.ok) {
        const missing = version.issues.some(issue => issue.detail.includes('is not on the PATH.'));
        return finish(missing ? 'skipped' : 'refused', name + ': ' + version.issues.map(issue => issue.code + ' ' + issue.detail).join('; '));
      }
      logs.push(version.value.stdout, version.value.stderr);
      if (version.value.exitCode !== 0) return finish('refused', name + ' did not answer its version probe successfully.');
    }
    await Promise.all(Object.entries(files).map(([path, content]) => writeFile(join(cwd, path), content)));
    for (const [name, args] of [['pdflatex', compileArgs], ['bibtex', ['main']], ['pdflatex', compileArgs], ['pdflatex', compileArgs]] as const) {
      const ran = await runner.run({ name, args: [...args], cwd, ...(signal ? { signal } : {}) });
      if (!ran.ok) return finish('refused', ran.issues.map(issue => issue.code + ' ' + issue.detail).join('; '));
      logs.push(ran.value.stdout, ran.value.stderr);
      if (ran.value.exitCode !== 0) return finish('refused', name + ' compilation exited ' + ran.value.exitCode + '.');
    }
    const log = await readFile(join(cwd, 'main.log'), 'utf8'); logs.push(log);
    if (/undefined references|Citation[^\n]*undefined|Reference[^\n]*undefined/i.test(log)) return finish('refused', 'Final TeX pass retains an undefined reference or citation.');
    const pdf = await readFile(join(cwd, 'main.pdf'));
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) return finish('refused', 'Compilation did not produce a PDF artifact.');
    const entries = await Promise.all(Object.entries(files).map(async ([path, content]) => ({ path, sha256: (await researchArtifactIdOf(new TextEncoder().encode(content))).slice(4) })));
    entries.push({ path: 'main.pdf', sha256: (await researchArtifactIdOf(pdf)).slice(4) });
    return finish('compiled', null, entries);
  } catch (cause) { return finish('refused', 'TeX host qualification failed: ' + (cause instanceof Error ? cause.message : String(cause))); }
  finally { await rm(cwd, { recursive: true, force: true }); }
}
