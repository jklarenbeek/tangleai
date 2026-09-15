/**
 * Importing and sealing an immutable skill directory.
 *
 * A skill is a directory, not a record: one root page plus optional
 * `references/`, `scripts/` and `assets/` files. Import is pure — it takes
 * bytes a host already read, normalizes and refuses unsafe names, hashes
 * every file and seals the manifest into a content-addressed bundle. The
 * source directory is never written, and binary bytes live behind an
 * injected artifact seam so a row never carries them.
 */
import { trace2SkillIssue, trace2SkillRefuse, trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import { bundleIdOf, byPath, skillFileDigest } from './identity.ts';
import { validateTrace2SkillShape } from './schema.ts';
import { MINIMAL_SKILL_PROFILE, validateFormat, type SkillFormatProfile } from './format.ts';
import type { SkillBundle, SkillFile, Trace2SkillIssue } from './contracts.gen.ts';

export const SKILL_ROOT_FILE = 'SKILL.md';
export const SKILL_DIRECTORIES = Object.freeze(['references', 'scripts', 'assets']) as readonly string[];
const MAX_PATH_BYTES = 512;
/** The same names the contract's path pattern admits, refused here with the path code. */
const SEGMENT = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

/** Bytes behind an address, so a stored row keeps a hash and never a blob. */
export interface SkillArtifactStore {
  put(bytes: Uint8Array): Promise<string>;
  get(address: string): Promise<Uint8Array | undefined>;
}

/** A file as the compiler and validator see it: text in hand, binary by address. */
export interface SkillFileDraft {
  path: string;
  mediaType: string;
  encoding: 'utf-8' | 'binary';
  executable: boolean;
  content: string | null;
  address: string | null;
  sha256: string | null;
  size: number | null;
}

/** A frozen directory: the sealed manifest and the files it names. */
export interface SkillSnapshot {
  bundle: SkillBundle;
  files: SkillFile[];
}

export interface ImportedFile { path: string, bytes: Uint8Array, executable?: boolean }

export interface ImportBundleOptions {
  scopeKey: string;
  mode: 'deepening' | 'creation';
  origin: SkillBundle['origin'];
  parentId?: string | null;
  status?: SkillBundle['status'];
  profile?: SkillFormatProfile;
  artifacts?: SkillArtifactStore;
}

/** The one path normalizer. Unsafe names are refused, never repaired. */
export function normalizePath(path: unknown): Trace2SkillOutcome<string> {
  const at = '/path';
  if (typeof path !== 'string' || path === '') return trace2SkillRefuse('TT2S1003', at, 'a file path is a non-empty string');
  if (path.includes('\0')) return trace2SkillRefuse('TT2S1003', at, 'a file path carries a NUL');
  if (path.includes('\\')) return trace2SkillRefuse('TT2S1003', at, `a file path uses POSIX separators: ${path}`);
  if (new TextEncoder().encode(path).length > MAX_PATH_BYTES) return trace2SkillRefuse('TT2S1003', at, 'the file path exceeds the length bound');
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return trace2SkillRefuse('TT2S1003', at, `a file path is relative to the directory: ${path}`);
  const segments = path.split('/');
  for (const segment of segments) {
    if (segment === '') return trace2SkillRefuse('TT2S1003', at, `the file path has an empty segment: ${path}`);
    if (segment === '.' || segment === '..') return trace2SkillRefuse('TT2S1003', at, `the file path traverses the directory: ${path}`);
    if (!SEGMENT.test(segment)) return trace2SkillRefuse('TT2S1003', at, `a file name is letters, digits, dot, underscore and dash: ${path}`);
  }
  if (segments.length === 1) {
    if (path !== SKILL_ROOT_FILE) return trace2SkillRefuse('TT2S1003', at, `the only root file is ${SKILL_ROOT_FILE}: ${path}`);
    return { valid: true, value: path };
  }
  if (!SKILL_DIRECTORIES.includes(segments[0]))
    return trace2SkillRefuse('TT2S1003', at, `a file lives in ${SKILL_DIRECTORIES.join(', ')} or is the root page: ${path}`);
  return { valid: true, value: path };
}

const MEDIA_TYPES: Record<string, string> = {
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain', json: 'application/json',
  csv: 'text/csv', yaml: 'text/yaml', yml: 'text/yaml', py: 'text/x-python', sh: 'text/x-shellscript',
  js: 'text/javascript', ts: 'text/x-typescript', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', pdf: 'application/pdf',
};

export function skillMediaType(path: string, encoding: 'utf-8' | 'binary'): string {
  const dot = path.lastIndexOf('.');
  const known = dot > 0 ? MEDIA_TYPES[path.slice(dot + 1).toLowerCase()] : undefined;
  return known ?? (encoding === 'utf-8' ? 'text/plain' : 'application/octet-stream');
}

const decodeText = (bytes: Uint8Array): string | null => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return null; }
};

/** The working view the compiler edits; a bundle's manifest never carries content. */
export function draftsOf(files: readonly SkillFile[]): SkillFileDraft[] {
  return files.map(file => ({
    path: file.path, mediaType: file.mediaType, encoding: file.encoding, executable: file.executable,
    content: file.content, address: file.address, sha256: file.sha256, size: file.size,
  })).sort((a, b) => byPath(a.path, b.path));
}

export interface SealBundleOptions {
  scopeKey: string;
  mode: 'deepening' | 'creation';
  origin: SkillBundle['origin'];
  parentId?: string | null;
  status?: SkillBundle['status'];
  profile?: SkillFormatProfile;
}

/** Hash every draft and seal the manifest. Sealing is asynchronous because SHA-256 is. */
export async function sealSkillBundle(drafts: readonly SkillFileDraft[], options: SealBundleOptions): Promise<Trace2SkillOutcome<SkillSnapshot>> {
  const profile = options.profile ?? MINIMAL_SKILL_PROFILE;
  const format = validateFormat(drafts, profile);
  if (!format.valid) return trace2SkillRefusal<SkillSnapshot>(format.issues);
  const encoder = new TextEncoder();
  const sealed: Array<Omit<SkillFile, 'bundleId'>> = [];
  for (const draft of [...drafts].sort((a, b) => byPath(a.path, b.path))) {
    if (draft.content === null) {
      if (draft.sha256 === null || draft.size === null || draft.address === null)
        return trace2SkillRefuse<SkillSnapshot>('TT2S1003', `/files/${draft.path}`, 'a binary file needs an address, a digest and a size');
      sealed.push({ ...draft, content: null, sha256: draft.sha256, size: draft.size, address: draft.address });
      continue;
    }
    const bytes = encoder.encode(draft.content);
    sealed.push({ ...draft, address: null, sha256: await skillFileDigest(bytes), size: bytes.length });
  }
  const manifest = sealed.map(file => ({ path: file.path, sha256: file.sha256, size: file.size }));
  const id = await bundleIdOf({
    scopeKey: options.scopeKey, mode: options.mode, parentId: options.parentId ?? null,
    rootFile: SKILL_ROOT_FILE, files: manifest,
  });
  const bundle = validateTrace2SkillShape<SkillBundle>('skillBundle', {
    id, scopeKey: options.scopeKey, mode: options.mode, parentId: options.parentId ?? null,
    rootFile: SKILL_ROOT_FILE, files: manifest, origin: options.origin,
    status: options.status ?? 'staged', formatProfile: profile.id,
  });
  if (!bundle.valid) return trace2SkillRefusal<SkillSnapshot>(bundle.issues);
  const files: SkillFile[] = [];
  for (const file of sealed) {
    const checked = validateTrace2SkillShape<SkillFile>('skillFile', { bundleId: id, ...file });
    if (!checked.valid) return trace2SkillRefusal<SkillSnapshot>(checked.issues);
    files.push(checked.value);
  }
  return { valid: true, value: { bundle: bundle.value, files } };
}

/** Read bytes a host already gathered into a sealed directory. Nothing is written. */
export async function importBundle(input: readonly ImportedFile[], options: ImportBundleOptions): Promise<Trace2SkillOutcome<SkillSnapshot>> {
  const issues: Trace2SkillIssue[] = [];
  const profile = options.profile ?? MINIMAL_SKILL_PROFILE;
  if (!input.length) return trace2SkillRefuse<SkillSnapshot>('TT2S1005', '/files', 'a skill directory has at least a root page');
  const drafts: SkillFileDraft[] = [];
  const seen = new Set<string>();
  for (const file of input) {
    const path = normalizePath(file.path);
    if (!path.valid) { issues.push(...path.issues); continue; }
    if (seen.has(path.value)) { issues.push(trace2SkillIssue('TT2S1003', `/files/${file.path}`, `the directory carries ${path.value} twice`)); continue; }
    seen.add(path.value);
    if (file.bytes.length > profile.maxFileBytes) {
      issues.push(trace2SkillIssue('TT2S1003', `/files/${path.value}`, `${file.bytes.length} bytes exceed the per-file bound of ${profile.maxFileBytes}`));
      continue;
    }
    const content = decodeText(file.bytes);
    if (content === null && !options.artifacts) {
      issues.push(trace2SkillIssue('TT2S1003', `/files/${path.value}`, 'binary bytes need an injected artifact store'));
      continue;
    }
    drafts.push({
      path: path.value, encoding: content === null ? 'binary' : 'utf-8',
      mediaType: skillMediaType(path.value, content === null ? 'binary' : 'utf-8'),
      executable: file.executable === true, content,
      address: content === null ? await options.artifacts!.put(file.bytes) : null,
      sha256: content === null ? await skillFileDigest(file.bytes) : null,
      size: content === null ? file.bytes.length : null,
    });
  }
  if (issues.length) return trace2SkillRefusal<SkillSnapshot>(issues);
  return sealSkillBundle(drafts, options);
}
