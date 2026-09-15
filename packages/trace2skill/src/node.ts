/**
 * The only module here that touches a filesystem.
 *
 * Reading a directory follows its own symlinks but never one that leaves the
 * directory, and materializing writes into a fresh directory only — the source
 * a human authored and the workspace a host runs in are never written.
 */
import { lstat, mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { trace2SkillIssue, trace2SkillRefuse, trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import { byPath } from './identity.ts';
import { normalizePath, type ImportedFile, type SkillArtifactStore, type SkillSnapshot } from './bundle.ts';
import type { Trace2SkillIssue } from './contracts.gen.ts';

const inside = (root: string, target: string): boolean => target === root || target.startsWith(root + sep);

/** Gather a directory's bytes for the pure importer. Nothing is written or resolved outward. */
export async function readBundleDirectory(directory: string): Promise<Trace2SkillOutcome<ImportedFile[]>> {
  let root: string;
  try { root = await realpath(directory); }
  catch (cause) { return trace2SkillRefuse<ImportedFile[]>('TT2S1003', '/directory', `${directory} is not a readable directory`, cause); }
  const files: ImportedFile[] = [];
  const issues: Trace2SkillIssue[] = [];
  const walk = async (current: string, prefix: string): Promise<void> => {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => byPath(a.name, b.name));
    for (const entry of entries) {
      const full = join(current, entry.name);
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const link = await lstat(full);
      if (link.isSymbolicLink()) {
        const target = await realpath(full).catch(() => null);
        if (target === null || !inside(root, target)) {
          issues.push(trace2SkillIssue('TT2S1003', `/files/${path}`, `${path} is a symlink that leaves the directory`));
          continue;
        }
      }
      const resolved = await stat(full);
      if (resolved.isDirectory()) { await walk(full, path); continue; }
      if (!resolved.isFile()) { issues.push(trace2SkillIssue('TT2S1003', `/files/${path}`, `${path} is not a regular file`)); continue; }
      files.push({ path, bytes: new Uint8Array(await readFile(full)), executable: (resolved.mode & 0o111) !== 0 });
    }
  };
  await walk(root, '');
  if (issues.length) return trace2SkillRefusal<ImportedFile[]>(issues);
  return { valid: true, value: files };
}

export interface MaterializeBundleOptions { artifacts?: SkillArtifactStore }

/** Write a frozen directory into a fresh location. A non-empty target is refused. */
export async function materializeBundle(snapshot: SkillSnapshot, directory: string, options: MaterializeBundleOptions = {}): Promise<Trace2SkillOutcome<string[]>> {
  const existing = await readdir(directory).catch(() => null);
  if (existing !== null && existing.length)
    return trace2SkillRefuse<string[]>('TT2S1003', '/directory', `${directory} already holds ${existing.length} entries`);
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const file of [...snapshot.files].sort((a, b) => byPath(a.path, b.path))) {
    const path = normalizePath(file.path);
    if (!path.valid) return trace2SkillRefusal<string[]>(path.issues);
    const target = join(directory, ...path.value.split('/'));
    await mkdir(dirname(target), { recursive: true });
    if (file.content !== null) await writeFile(target, file.content, { mode: file.executable ? 0o755 : 0o644 });
    else {
      if (!options.artifacts || file.address === null)
        return trace2SkillRefuse<string[]>('TT2S1003', `/files/${file.path}`, 'binary bytes need an injected artifact store');
      const bytes = await options.artifacts.get(file.address);
      if (!bytes) return trace2SkillRefuse<string[]>('TT2S1003', `/files/${file.path}`, `the artifact store holds nothing at ${file.address}`);
      await writeFile(target, bytes, { mode: file.executable ? 0o755 : 0o644 });
    }
    written.push(path.value);
  }
  return { valid: true, value: written };
}
