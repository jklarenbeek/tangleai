/**
 * The immutable surface: what a proposal may never touch.
 *
 * The policy is compiled from the REPOSITORY record, never from the
 * worktree, so nothing a patch writes can reach the rules that judge it.
 * That is the whole structural argument — a mutator cannot move the
 * goalposts because the goalposts are not in the tree it edits.
 *
 * Five detections, in order, because an earlier one gives the clearer
 * reason: a path that does not normalize is an escape, and there is no
 * point asking whether an escaped path is also a test file.
 *
 *  1. normalization — `..`, absolute, backslash, NUL, empty, or a path
 *     that case-folds onto another;
 *  2. direct edit — an immutable path or prefix, or a generated file;
 *  3. rename — an immutable file removed and its content reappearing, or
 *     its basename reappearing elsewhere, or git's own `R` view saying so;
 *  4. symlink — anything git reports as a link among the changes;
 *  5. budget — more bytes or more files than the repository allows.
 *
 * Rule 3 runs twice in the campaign: here over the file map, and again
 * over git's staged view after the write, because a rename that happens
 * BETWEEN the read and the write is invisible to the first.
 */

import { evolveIssue, type EvolveIssue } from './errors.ts';
import { operationPath, patchBytes, type ProposalOperation } from './proposal.ts';
import type { EvolveRepository, EvolveBudgets } from './contracts.gen.ts';

export type FileMap = Record<string, string>;

export interface SurfaceStatus {
  changed: Array<{ path: string, status: string, renamedFrom?: string }>;
  symlinks: string[];
}

export interface SurfacePolicy {
  check(previous: FileMap, next: FileMap, status?: SurfaceStatus): EvolveIssue[];
  checkPatch(operations: readonly ProposalOperation[]): EvolveIssue[];
  readonly immutablePaths: readonly string[];
  readonly generated: readonly string[];
}

export interface SurfacePolicyInput {
  immutablePaths: readonly string[];
  generated: readonly string[];
  budgets: EvolveBudgets;
}

/** A path that cannot be trusted to mean what it says. */
function malformed(path: string): string | null {
  if (path.length === 0) return 'an empty path';
  if (path.includes('\0')) return 'a NUL byte';
  if (path.includes('\\')) return 'a backslash';
  if (path.startsWith('/')) return 'an absolute path';
  if (/^[A-Za-z]:/.test(path)) return 'a drive-qualified path';
  const parts = path.split('/');
  if (parts.some(part => part === '..')) return 'a parent-directory component';
  if (parts.some(part => part === '.' || part === '')) return 'an empty or current-directory component';
  return null;
}

function isImmutable(path: string, immutablePaths: readonly string[]): boolean {
  for (const rule of immutablePaths) {
    if (rule.endsWith('/') ? path.startsWith(rule) : path === rule) return true;
  }
  return false;
}

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export function compileSurfacePolicy(input: SurfacePolicyInput): SurfacePolicy {
  const immutablePaths = [...input.immutablePaths];
  const generated = [...input.generated];
  const budgets = input.budgets;

  const pointerFor = (path: string): string => '/files/' + path.replaceAll('~', '~0').replaceAll('/', '~1');

  function check(previous: FileMap, next: FileMap, status?: SurfaceStatus): EvolveIssue[] {
    const issues: EvolveIssue[] = [];
    const before = new Set(Object.keys(previous));
    const after = new Set(Object.keys(next));
    const added = [...after].filter(path => !before.has(path));
    const removed = [...before].filter(path => !after.has(path));
    const modified = [...after].filter(path => before.has(path) && previous[path] !== next[path]);
    const changed = [...new Set([...added, ...removed, ...modified])].sort();

    // 1. Normalization. An escaped path is refused before anything asks
    //    what kind of file it claims to be.
    const folded = new Map<string, string>();
    for (const path of [...before, ...after].sort()) {
      const key = path.toLowerCase();
      const held = folded.get(key);
      if (held !== undefined && held !== path) {
        issues.push(evolveIssue('TEVO1004', pointerFor(path),
          'escape: ' + path + ' case-folds onto ' + held + '.'));
      }
      folded.set(key, path);
    }
    for (const path of changed) {
      const why = malformed(path);
      if (why !== null) issues.push(evolveIssue('TEVO1004', pointerFor(path), 'escape: ' + why + '.'));
    }
    if (issues.length > 0) return issues;

    // 2. Direct edit of a surface the experiment is measured against.
    for (const path of changed) {
      if (isImmutable(path, immutablePaths)) {
        issues.push(evolveIssue('TEVO1004', pointerFor(path),
          'goalpost: ' + path + ' is part of the surface this experiment is measured against.'));
      }
      else if (generated.includes(path)) {
        issues.push(evolveIssue('TEVO1004', pointerFor(path),
          'goalpost: ' + path + ' is generated; edit its source and regenerate.'));
      }
    }

    // 3. Rename of an immutable file, by content or by name.
    for (const gone of removed) {
      if (!isImmutable(gone, immutablePaths) && !generated.includes(gone)) continue;
      // The contents are compared directly rather than hashed: equality is
      // the whole question, and a hash would only add a crypto dependency
      // to a module that must load in a browser.
      const was = previous[gone];
      for (const arrived of added) {
        const sameContent = next[arrived] === was;
        const sameName = basename(arrived) === basename(gone);
        if (sameContent || sameName) {
          issues.push(evolveIssue('TEVO1004', pointerFor(arrived),
            'goalpost: ' + gone + ' reappears as ' + arrived
            + (sameContent ? ' with identical content' : ' under the same basename') + '.'));
        }
      }
    }
    if (status !== undefined) {
      for (const entry of status.changed) {
        if (entry.status !== 'R') continue;
        const from = entry.renamedFrom ?? '';
        if (isImmutable(from, immutablePaths) || isImmutable(entry.path, immutablePaths)
          || generated.includes(from) || generated.includes(entry.path)) {
          issues.push(evolveIssue('TEVO1004', pointerFor(entry.path),
            'goalpost: git reports ' + from + ' renamed to ' + entry.path + '.'));
        }
      }
      // 4. A symlink among the changes, on git's own view.
      for (const link of status.symlinks) {
        issues.push(evolveIssue('TEVO1004', pointerFor(link),
          'escape: ' + link + ' is a symbolic link.'));
      }
    }

    // 5. Budgets, last: a refusal for content is more useful than one for size.
    let bytes = 0;
    for (const path of [...added, ...modified]) bytes += Buffer.byteLength(next[path], 'utf8');
    if (bytes > budgets.patchBytes) {
      issues.push(evolveIssue('TEVO1005', '/budgets/patchBytes',
        'over-budget: ' + bytes + ' bytes exceeds ' + budgets.patchBytes + '.'));
    }
    if (changed.length > budgets.patchFiles) {
      issues.push(evolveIssue('TEVO1005', '/budgets/patchFiles',
        'over-budget: ' + changed.length + ' files exceeds ' + budgets.patchFiles + '.'));
    }
    return issues;
  }

  /**
   * The same rules read straight off the operations, before any apply. A
   * patch whose own bytes already exceed the budget never reaches the
   * engine, and an escaped path is named as it was written rather than as
   * it resolved.
   */
  function checkPatch(operations: readonly ProposalOperation[]): EvolveIssue[] {
    const issues: EvolveIssue[] = [];
    for (const [index, operation] of operations.entries()) {
      const path = operationPath(operation);
      const why = malformed(path);
      if (why !== null) {
        issues.push(evolveIssue('TEVO1004', '/patch/' + index, 'escape: ' + why + ' in ' + path + '.'));
        continue;
      }
      if (isImmutable(path, immutablePaths)) {
        issues.push(evolveIssue('TEVO1004', '/patch/' + index,
          'goalpost: ' + path + ' is part of the surface this experiment is measured against.'));
      }
      else if (generated.includes(path)) {
        issues.push(evolveIssue('TEVO1004', '/patch/' + index,
          'goalpost: ' + path + ' is generated; edit its source and regenerate.'));
      }
    }

    const bytes = patchBytes(operations);
    if (bytes > budgets.patchBytes) {
      issues.push(evolveIssue('TEVO1005', '/budgets/patchBytes',
        'over-budget: ' + bytes + ' bytes exceeds ' + budgets.patchBytes + '.'));
    }
    const touched = new Set(operations.map(operationPath));
    if (touched.size > budgets.patchFiles) {
      issues.push(evolveIssue('TEVO1005', '/budgets/patchFiles',
        'over-budget: ' + touched.size + ' files exceeds ' + budgets.patchFiles + '.'));
    }
    return issues;
  }

  return { check, checkPatch, immutablePaths, generated };
}

/** Compile from a repository record's own declared policy. */
export function policyFromRepository(repository: EvolveRepository): SurfacePolicy {
  return compileSurfacePolicy({
    immutablePaths: repository.policy.immutablePaths,
    generated: repository.policy.generated,
    budgets: repository.budgets,
  });
}
