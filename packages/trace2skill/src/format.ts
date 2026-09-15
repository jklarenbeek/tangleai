/**
 * The one skill-directory format validator.
 *
 * A directory is valid when it has exactly one non-empty root page, every
 * path is a safe relative name inside the four permitted locations, every
 * internal link reaches a file the directory actually carries, and it stays
 * inside the profile's size bounds. A host profile may additionally require
 * frontmatter keys or declared tool names; nothing here rewrites or
 * reformats content, because the directory a human wrote is the artifact.
 */
import { trace2SkillIssue, trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import type { Trace2SkillIssue } from './contracts.gen.ts';
import { normalizePath, SKILL_ROOT_FILE, type SkillFileDraft } from './bundle.ts';

export interface SkillFormatProfile {
  id: string;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  requiredFrontmatter: readonly string[];
  requiredTools: readonly string[];
}

export const MINIMAL_SKILL_PROFILE: SkillFormatProfile = Object.freeze({
  id: 'minimal', maxFiles: 64, maxFileBytes: 262144, maxTotalBytes: 2097152,
  requiredFrontmatter: Object.freeze([]) as readonly string[],
  requiredTools: Object.freeze([]) as readonly string[],
});

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Markdown links that point inside the directory, resolved against the page that carries them. */
export function internalLinksOf(path: string, content: string): string[] {
  const base = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const targets: string[] = [];
  for (const match of content.matchAll(LINK)) {
    const raw = match[1];
    if (raw.startsWith('#') || raw.startsWith('//') || SCHEME.test(raw)) continue;
    const bare = raw.split('#')[0].split('?')[0];
    if (!bare) continue;
    const resolved = bare.startsWith('/') ? bare.slice(1) : base === '' ? bare : `${base}/${bare}`;
    const segments: string[] = [];
    for (const segment of resolved.split('/')) {
      if (segment === '' || segment === '.') continue;
      if (segment === '..') { segments.pop(); continue; }
      segments.push(segment);
    }
    targets.push(segments.join('/'));
  }
  return targets;
}

const frontmatterKeys = (content: string): Set<string> => {
  const keys = new Set<string>();
  if (!content.startsWith('---\n')) return keys;
  const end = content.indexOf('\n---', 3);
  if (end < 0) return keys;
  for (const line of content.slice(4, end + 1).split('\n')) {
    const colon = line.indexOf(':');
    if (colon > 0 && !line.startsWith(' ')) keys.add(line.slice(0, colon).trim());
  }
  return keys;
};

/** Byte length of the draft as it will be stored. */
export const draftSize = (draft: SkillFileDraft): number =>
  draft.content === null ? draft.size ?? 0 : new TextEncoder().encode(draft.content).length;

export function validateFormat(files: readonly SkillFileDraft[], profile: SkillFormatProfile = MINIMAL_SKILL_PROFILE): Trace2SkillOutcome<null> {
  const issues: Trace2SkillIssue[] = [];
  const at = (path: string) => `/files/${path}`;
  if (files.length > profile.maxFiles) issues.push(trace2SkillIssue('TT2S1005', '/files', `${files.length} files exceed the profile bound of ${profile.maxFiles}`));
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path.valid) { issues.push(...path.issues); continue; }
    if (seen.has(path.value)) issues.push(trace2SkillIssue('TT2S1005', at(file.path), 'the directory carries this name twice'));
    seen.add(path.value);
    const size = draftSize(file);
    total += size;
    if (size > profile.maxFileBytes) issues.push(trace2SkillIssue('TT2S1005', at(file.path), `${size} bytes exceed the per-file bound of ${profile.maxFileBytes}`));
  }
  if (total > profile.maxTotalBytes) issues.push(trace2SkillIssue('TT2S1005', '/files', `${total} bytes exceed the directory bound of ${profile.maxTotalBytes}`));
  const root = files.find(file => file.path === SKILL_ROOT_FILE);
  if (!root) issues.push(trace2SkillIssue('TT2S1005', `/files/${SKILL_ROOT_FILE}`, 'the directory has no root page'));
  else if (root.content === null || root.content.trim() === '') issues.push(trace2SkillIssue('TT2S1005', `/files/${SKILL_ROOT_FILE}`, 'the root page is empty'));
  for (const file of files) {
    if (file.content === null || !file.path.endsWith('.md')) continue;
    for (const target of internalLinksOf(file.path, file.content))
      if (!seen.has(target)) issues.push(trace2SkillIssue('TT2S1005', at(file.path), `the link to ${target} reaches no file in the directory`));
  }
  if (root?.content) {
    const keys = frontmatterKeys(root.content);
    for (const key of profile.requiredFrontmatter)
      if (!keys.has(key)) issues.push(trace2SkillIssue('TT2S1005', `/files/${SKILL_ROOT_FILE}`, `the profile requires the frontmatter key ${key}`));
    for (const tool of profile.requiredTools)
      if (!root.content.includes(tool)) issues.push(trace2SkillIssue('TT2S1005', `/files/${SKILL_ROOT_FILE}`, `the profile requires the declared tool ${tool}`));
  }
  return issues.length ? trace2SkillRefusal<null>(issues) : { valid: true, value: null };
}
