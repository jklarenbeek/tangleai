/**
 * The anchored text-edit compiler for skill directories.
 *
 * Five verbs over UTF-8 pages: create a file, insert before or after an
 * anchor, replace or delete a section. An anchor is exact text that must
 * resolve exactly once in the FROZEN page, so a proposal written against a
 * directory that has since moved is refused rather than guessed at. Every
 * operation compiles to a hunk carrying the page's base hash and an exact
 * line interval; overlapping intervals on one page are withheld with a
 * report naming both sides, and a created file together with every link
 * that reaches it stands or falls as one group.
 *
 * Every function here is synchronous and free of I/O so a caller can inject
 * them as the proposal, apply and candidate validators of a guarded editor.
 */
import { trace2SkillIssue, trace2SkillRefuse, trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import { refuseStaleBase, byPath } from './identity.ts';
import { validateTrace2SkillShape } from './schema.ts';
import { MINIMAL_SKILL_PROFILE, internalLinksOf, validateFormat, type SkillFormatProfile } from './format.ts';
import { normalizePath, skillMediaType, type SkillFileDraft } from './bundle.ts';
import type { PatchOperation, SkillBundle, SkillPatch, Trace2SkillIssue } from './contracts.gen.ts';

/** A frozen directory as the compiler reads it: the sealed manifest and its pages. */
export interface FrozenSkill { bundle: SkillBundle, files: readonly SkillFileDraft[] }

export interface CompiledHunk {
  path: string;
  /** The page's digest in the frozen directory; null when the hunk creates the page. */
  baseHash: string | null;
  startLine: number;
  endLine: number;
  replacement: string;
  op: PatchOperation['op'];
  group: string;
  /** Position in the compiler's canonical order, which no input ordering changes. */
  opIndex: number;
}

export interface WithheldHunk { hunk: CompiledHunk, conflict: CompiledHunk | null, reason: string }

export interface CompiledGroup { id: string, opIndexes: number[], creates: string[], withheld: boolean }

export interface CompiledPatch {
  baseHash: string;
  hunks: CompiledHunk[];
  withheld: WithheldHunk[];
  groups: CompiledGroup[];
  issues: Trace2SkillIssue[];
}

export interface CompilePatchOptions {
  /** Task ids, sandbox paths and ground-truth strings reusable guidance may not carry. */
  forbidden?: readonly string[];
  profile?: SkillFormatProfile;
}

const HEADING = /^(#{1,6})\s/;
const BOUNDARY_BEFORE = /[A-Za-z0-9_.,-]/;
const BOUNDARY_AFTER = /[A-Za-z0-9_,]/;

/** Lines keep their own terminator, so joining is exact and a trailing newline survives. */
export function splitLines(content: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let index = 0; index < content.length; index++)
    if (content[index] === '\n') { lines.push(content.slice(start, index + 1)); start = index + 1; }
  if (start < content.length) lines.push(content.slice(start));
  return lines;
}

/** The one anchor resolver: exact text, exactly once, reported as a line interval. */
export function resolveAnchor(content: string, anchor: string, path: string): Trace2SkillOutcome<{ startLine: number, endLine: number }> {
  const at = `/files/${path}`;
  if (anchor === '') return trace2SkillRefuse('TT2S1004', at, 'an anchor is non-empty text');
  const first = content.indexOf(anchor);
  if (first < 0) return trace2SkillRefuse('TT2S1004', at, `the anchor ${JSON.stringify(anchor.slice(0, 60))} is not in the frozen page`);
  if (content.indexOf(anchor, first + 1) >= 0)
    return trace2SkillRefuse('TT2S1004', at, `the anchor ${JSON.stringify(anchor.slice(0, 60))} resolves more than once`);
  const lines = splitLines(content);
  let offset = 0, startLine = 0, endLine = lines.length;
  const last = first + anchor.length - 1;
  for (let index = 0; index < lines.length; index++) {
    const next = offset + lines[index].length;
    if (offset <= first && first < next) startLine = index;
    if (offset <= last && last < next) { endLine = index + 1; break; }
    offset = next;
  }
  return { valid: true, value: { startLine, endLine } };
}

/** A heading anchor owns its whole section; any other anchor owns only its own lines. */
export function sectionEnd(lines: readonly string[], startLine: number, endLine: number): number {
  const heading = HEADING.exec(lines[startLine] ?? '');
  if (!heading) return endLine;
  for (let index = endLine; index < lines.length; index++) {
    const found = HEADING.exec(lines[index]);
    if (found && found[1].length <= heading[1].length) return index;
  }
  return lines.length;
}

/** Reusable guidance may not carry a task id, a sandbox path or a registered answer. */
export function guidanceLeakCheck(text: string, forbidden: readonly string[]): Trace2SkillOutcome<null> {
  for (const term of forbidden) {
    if (!term) continue;
    for (let from = 0; ;) {
      const at = text.indexOf(term, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + term.length;
      const before = at === 0 ? '' : text[at - 1];
      const after = end >= text.length ? '' : text[end];
      const following = end + 1 >= text.length ? '' : text[end + 1];
      if (before !== '' && BOUNDARY_BEFORE.test(before)) continue;
      if (after !== '' && BOUNDARY_AFTER.test(after)) continue;
      if (after === '.' && /[0-9]/.test(following)) continue;
      if (after === '-' && /[A-Za-z0-9]/.test(following)) continue;
      return trace2SkillRefuse('TT2S1006', '/operations', `reusable guidance names the task-instance fact ${JSON.stringify(term)}`);
    }
  }
  return { valid: true, value: null };
}

const operationText = (operation: PatchOperation): string => operation.op === 'delete_section' ? '' : operation.content ?? '';
const overlaps = (a: CompiledHunk, b: CompiledHunk): boolean => {
  if (a.path !== b.path) return false;
  const emptyA = a.startLine === a.endLine, emptyB = b.startLine === b.endLine;
  if (emptyA && emptyB) return false;
  if (emptyA) return b.startLine < a.startLine && a.startLine < b.endLine;
  if (emptyB) return a.startLine < b.startLine && b.startLine < a.endLine;
  return a.startLine < b.endLine && b.startLine < a.endLine;
};
const canonical = (a: CompiledHunk, b: CompiledHunk): number =>
  byPath(a.path, b.path) || a.startLine - b.startLine || a.endLine - b.endLine
  || byPath(a.op, b.op) || byPath(a.replacement, b.replacement) || byPath(a.group, b.group);

/** Compile one patch against the frozen directory. Nothing here writes or mutates. */
export function compilePatch(frozen: FrozenSkill, patch: SkillPatch, options: CompilePatchOptions = {}): Trace2SkillOutcome<CompiledPatch> {
  const shape = validateTrace2SkillShape<SkillPatch>('skillPatch', patch);
  if (!shape.valid) return trace2SkillRefusal<CompiledPatch>(shape.issues);
  const stale = refuseStaleBase<CompiledPatch>(frozen.bundle.id, patch.baseHash, '/baseHash');
  if (stale) return stale;
  const pages = new Map(frozen.files.map(file => [file.path, file]));
  const issues: Trace2SkillIssue[] = [];
  const forbidden = options.forbidden ?? [];
  const created = new Set<string>();
  const hunks: CompiledHunk[] = [];

  for (const [index, operation] of patch.operations.entries()) {
    const at = `/operations/${index}`;
    const path = normalizePath(operation.path);
    if (!path.valid) { issues.push(...path.issues); continue; }
    const leak = guidanceLeakCheck(operationText(operation), forbidden);
    if (!leak.valid) { issues.push(...leak.issues.map(issue => ({ ...issue, path: at }))); continue; }
    if (operation.op === 'create_file') {
      if (pages.has(path.value)) { issues.push(trace2SkillIssue('TT2S1004', at, `${path.value} already exists in the frozen directory`)); continue; }
      if (created.has(path.value)) { issues.push(trace2SkillIssue('TT2S1004', at, `${path.value} is created twice by one patch`)); continue; }
      created.add(path.value);
      hunks.push({ path: path.value, baseHash: null, startLine: 0, endLine: 0, replacement: operation.content, op: operation.op, group: operation.group, opIndex: 0 });
      continue;
    }
    const page = pages.get(path.value);
    if (!page) { issues.push(trace2SkillIssue('TT2S1004', at, `${path.value} is not a page of the frozen directory`)); continue; }
    if (page.encoding !== 'utf-8' || page.content === null) { issues.push(trace2SkillIssue('TT2S1004', at, `${path.value} is not UTF-8 text and cannot be edited by anchor`)); continue; }
    if (page.sha256 === null) { issues.push(trace2SkillIssue('TT2S1002', at, `${path.value} carries no digest in the frozen directory`)); continue; }
    let startLine: number, endLine: number;
    if (operation.op === 'insert_before' || operation.op === 'insert_after') {
      const found = resolveAnchor(page.content, operation.anchor, path.value);
      if (!found.valid) { issues.push(...found.issues.map(issue => ({ ...issue, path: at }))); continue; }
      startLine = operation.op === 'insert_before' ? found.value.startLine : found.value.endLine;
      endLine = startLine;
    }
    else if (operation.op === 'replace_section' || operation.op === 'delete_section') {
      const found = resolveAnchor(page.content, operation.from, path.value);
      if (!found.valid) { issues.push(...found.issues.map(issue => ({ ...issue, path: at }))); continue; }
      startLine = found.value.startLine;
      if (operation.to === null) endLine = sectionEnd(splitLines(page.content), startLine, found.value.endLine);
      else {
        const closing = resolveAnchor(page.content, operation.to, path.value);
        if (!closing.valid) { issues.push(...closing.issues.map(issue => ({ ...issue, path: at }))); continue; }
        if (closing.value.endLine < found.value.endLine) { issues.push(trace2SkillIssue('TT2S1004', at, 'the closing anchor precedes the opening anchor')); continue; }
        endLine = closing.value.endLine;
      }
    }
    else { issues.push(trace2SkillIssue('TT2S1004', at, 'unknown directory operation')); continue; }
    hunks.push({ path: path.value, baseHash: page.sha256, startLine, endLine, replacement: operationText(operation), op: operation.op, group: operation.group, opIndex: 0 });
  }
  if (issues.length) return trace2SkillRefusal<CompiledPatch>(issues);

  hunks.sort(canonical);
  hunks.forEach((hunk, index) => { hunk.opIndex = index; });

  const groups = new Map<string, CompiledGroup>();
  for (const hunk of hunks) {
    const group = groups.get(hunk.group) ?? { id: hunk.group, opIndexes: [], creates: [], withheld: false };
    group.opIndexes.push(hunk.opIndex);
    if (hunk.baseHash === null) group.creates.push(hunk.path);
    groups.set(hunk.group, group);
  }
  const withheldBy = new Map<number, WithheldHunk>();
  const withhold = (hunk: CompiledHunk, conflict: CompiledHunk | null, reason: string, detail: string) => {
    if (withheldBy.has(hunk.opIndex)) return;
    withheldBy.set(hunk.opIndex, { hunk, conflict, reason });
    issues.push(trace2SkillIssue('TT2S1004', `/hunks/${hunk.opIndex}`, detail));
  };

  /** A created page and every link that reaches it are one atomic group. */
  for (const hunk of hunks) {
    if (!created.size) break;
    const links = hunk.replacement.includes('](') ? internalLinksOf(hunk.path, hunk.replacement) : [];
    for (const target of links) {
      if (!created.has(target)) continue;
      const source = hunks.find(other => other.baseHash === null && other.path === target);
      if (!source || source.group === hunk.group) continue;
      withhold(hunk, source, 'non-atomic-create', `the link to ${target} is in group ${hunk.group} while its file is created in group ${source.group}`);
      withhold(source, hunk, 'non-atomic-create', `${target} is created in group ${source.group} while the link that reaches it is in group ${hunk.group}`);
    }
  }
  /** Overlapping intervals on one page: the earlier in canonical order survives. */
  for (let index = 0; index < hunks.length; index++)
    for (let other = index + 1; other < hunks.length; other++)
      if (overlaps(hunks[index], hunks[other]))
        withhold(hunks[other], hunks[index], 'overlap',
          `lines ${hunks[other].startLine}–${hunks[other].endLine} of ${hunks[other].path} overlap the edit at lines ${hunks[index].startLine}–${hunks[index].endLine}`);
  /** An atomic create group stands or falls together; a plain label does not bind peers. */
  for (const group of groups.values()) {
    if (!group.creates.length) continue;
    if (!group.opIndexes.some(index => withheldBy.has(index))) continue;
    group.withheld = true;
    for (const index of group.opIndexes) {
      const hunk = hunks[index];
      withhold(hunk, null, 'group', `group ${group.id} is withheld because one of its operations is`);
    }
  }
  const withheld = [...withheldBy.values()].sort((a, b) => a.hunk.opIndex - b.hunk.opIndex);
  return {
    valid: true,
    value: {
      baseHash: patch.baseHash,
      hunks: hunks.filter(hunk => !withheldBy.has(hunk.opIndex)),
      withheld, groups: [...groups.values()].sort((a, b) => byPath(a.id, b.id)), issues,
    },
  };
}

/** Apply a compiled patch to an in-memory copy and validate the resulting directory. */
export function applyCompiled(files: readonly SkillFileDraft[], compiled: CompiledPatch, profile: SkillFormatProfile = MINIMAL_SKILL_PROFILE): Trace2SkillOutcome<SkillFileDraft[]> {
  const next = new Map(files.map(file => [file.path, { ...file }]));
  for (const hunk of compiled.hunks) {
    if (hunk.baseHash !== null) continue;
    if (next.has(hunk.path)) return trace2SkillRefuse<SkillFileDraft[]>('TT2S1004', `/files/${hunk.path}`, 'the created page already exists');
    // A created page is UTF-8 text and never executable: a proposal cannot
    // introduce a runnable script into a directory a host loads.
    next.set(hunk.path, {
      path: hunk.path, mediaType: skillMediaType(hunk.path, 'utf-8'), encoding: 'utf-8', executable: false,
      content: hunk.replacement, address: null, sha256: null, size: null,
    });
  }
  const edits = new Map<string, CompiledHunk[]>();
  for (const hunk of compiled.hunks) {
    if (hunk.baseHash === null) continue;
    const page = next.get(hunk.path);
    if (!page || page.content === null) return trace2SkillRefuse<SkillFileDraft[]>('TT2S1004', `/files/${hunk.path}`, 'the edited page is not in the directory');
    if (page.sha256 !== null && page.sha256 !== hunk.baseHash)
      return trace2SkillRefuse<SkillFileDraft[]>('TT2S1002', `/files/${hunk.path}`, 'the page moved since the hunk was compiled');
    (edits.get(hunk.path) ?? edits.set(hunk.path, []).get(hunk.path)!).push(hunk);
  }
  for (const [path, list] of edits) {
    const page = next.get(path)!;
    const lines = splitLines(page.content!);
    // Applied last-first so earlier intervals keep their indices, and equal
    // positions in reverse canonical order so the output reads in that order.
    for (const hunk of [...list].sort((a, b) => b.startLine - a.startLine || b.endLine - a.endLine || b.opIndex - a.opIndex)) {
      const block = hunk.replacement === '' ? [] : splitLines(hunk.replacement.endsWith('\n') ? hunk.replacement : `${hunk.replacement}\n`);
      if (block.length && hunk.startLine > 0 && !lines[hunk.startLine - 1].endsWith('\n')) lines[hunk.startLine - 1] += '\n';
      lines.splice(hunk.startLine, hunk.endLine - hunk.startLine, ...block);
    }
    next.set(path, { ...page, content: lines.join(''), sha256: null, size: null });
  }
  const drafts = [...next.values()].sort((a, b) => byPath(a.path, b.path));
  const format = validateFormat(drafts, profile);
  if (!format.valid) return trace2SkillRefusal<SkillFileDraft[]>(format.issues);
  return { valid: true, value: drafts };
}
