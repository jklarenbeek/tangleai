/**
 * The git vocabulary, written out one subcommand at a time.
 *
 * This is an allow-list of whole argument vectors, not a deny-list of
 * dangerous verbs. `push`, `merge`, `switch`, `checkout`, `reset`,
 * `rebase`, `remote` and `config` are not refused here — they are simply
 * not present, and a validator that does not recognise its argv refuses
 * it. The difference matters: a deny-list has to anticipate every spelling
 * of a bad idea, and this does not.
 *
 * The global options that turn git into a general-purpose executor are
 * absent for the same reason. `-c` can set `core.hooksPath` and make any
 * later command run an arbitrary script; `-C` moves the working directory
 * out from under the runner's realpath check; `--exec-path` replaces the
 * binaries git itself calls. None of them can be expressed.
 *
 * A ref is either an experiment branch or the pinned base commit. Every
 * other spelling — `main`, `refs/heads/main`, `HEAD~1`, `@{-1}`, a remote
 * — fails the pattern before anything is spawned.
 */

import { refuseOne, ok, type EvolveOutcome } from '../errors.ts';

/** An experiment branch. Nothing else is writable. */
export const EXPERIMENT_BRANCH = /^exp\/[a-z0-9][a-z0-9-]*$/;

/** A full commit object name. Abbreviations and revision expressions are not accepted. */
export const PINNED_REVISION = /^[a-f0-9]{40}$/;

/** Global options that would let git run something else, or somewhere else. */
const FORBIDDEN_GLOBAL = ['-c', '-C', '--exec-path', '--git-dir', '--work-tree', '--namespace', '--config-env'];

const accept = (): EvolveOutcome<true> => ok(true as const);

const rejectArg = (detail: string): EvolveOutcome<true> =>
  refuseOne<true>('TEVO1006', '/args', detail);

/** No argument may carry a global option, wherever it appears. */
function withoutGlobals(argv: string[]): EvolveOutcome<true> | null {
  for (const arg of argv) {
    for (const forbidden of FORBIDDEN_GLOBAL) {
      if (arg === forbidden || arg.startsWith(forbidden + '=')) {
        return rejectArg('The option ' + forbidden + ' is not part of this vocabulary.');
      }
    }
  }
  return null;
}

export function isExperimentBranch(ref: string): boolean {
  return EXPERIMENT_BRANCH.test(ref);
}

export function isPinnedRevision(ref: string): boolean {
  return PINNED_REVISION.test(ref);
}

/** Exactly matches an argv template, where `null` means "any single value". */
function shape(argv: string[], template: Array<string | null>): boolean {
  if (argv.length !== template.length) return false;
  return template.every((expected, index) => expected === null || argv[index] === expected);
}

/**
 * Every accepted git invocation. A validator sees the complete argv and
 * must recognise all of it; a trailing extra argument is a refusal.
 */
export function validateGitArgs(argv: string[]): EvolveOutcome<true> {
  const global = withoutGlobals(argv);
  if (global) return global;
  if (argv.length === 0) return rejectArg('An empty git invocation is not a command.');

  const [verb, ...rest] = argv;
  switch (verb) {
    case 'rev-parse':
      if (shape(rest, ['HEAD']) || shape(rest, ['--show-toplevel']) || shape(rest, ['--git-dir'])) return accept();
      return rejectArg('rev-parse accepts HEAD, --show-toplevel or --git-dir.');

    case 'status':
      if (shape(rest, ['--porcelain']) || shape(rest, ['--porcelain=v2'])) return accept();
      return rejectArg('status is read only in its porcelain forms.');

    case 'symbolic-ref':
      if (shape(rest, ['HEAD']) || shape(rest, ['--short', 'HEAD'])) return accept();
      return rejectArg('symbolic-ref reads HEAD and writes nothing.');

    case 'show-ref':
      if (rest.length === 2 && rest[0] === '--verify') return accept();
      return rejectArg('show-ref reads one verified ref.');

    case 'worktree':
      if (shape(rest, ['list', '--porcelain']) || shape(rest, ['prune'])) return accept();
      if (rest[0] === 'add') {
        if (!shape(rest, ['add', '-b', null, null, null])) return rejectArg('worktree add has one accepted form.');
        if (!isExperimentBranch(rest[2])) return rejectArg('A worktree branch must be an experiment branch.');
        if (!isPinnedRevision(rest[4])) return rejectArg('A worktree starts at a pinned commit.');
        return accept();
      }
      if (rest[0] === 'remove') {
        if (!shape(rest, ['remove', '--force', null])) return rejectArg('worktree remove has one accepted form.');
        return accept();
      }
      return rejectArg('worktree accepts list, add, remove and prune.');

    case 'branch':
      if (!shape(rest, ['-D', null])) return rejectArg('branch only deletes an experiment branch.');
      if (!isExperimentBranch(rest[1])) return rejectArg('Only an experiment branch may be deleted.');
      return accept();

    case 'add':
      if (shape(rest, ['-A'])) return accept();
      return rejectArg('add stages the whole worktree or nothing.');

    case 'diff':
      if (shape(rest, ['--cached', '--name-status', '-M', '-z'])) return accept();
      if (shape(rest, ['--cached', '--binary'])) return accept();
      return rejectArg('diff reads the index in one of two accepted forms.');

    case 'ls-files':
      if (shape(rest, ['-s', '-z'])) return accept();
      return rejectArg('ls-files reads the staged inventory.');

    case 'commit':
      if (!shape(rest, ['-m', null])) return rejectArg('commit takes exactly one message.');
      if (rest[1].length === 0) return rejectArg('A commit message cannot be empty.');
      return accept();

    default:
      // Absent, not denied: push, merge, switch, checkout, reset, rebase,
      // remote, config, fetch, clone, tag and everything else land here.
      return rejectArg('git ' + verb + ' is not part of this vocabulary.');
  }
}

/**
 * The refs this host must never write, as one set: the repository's
 * declared protected refs, the operator's own branch, and every branch
 * checked out in some other worktree.
 */
export function neverWriteSet(options: {
  protectedRefs: readonly string[],
  operatorBranch: string,
  checkedOut: readonly string[],
}): ReadonlySet<string> {
  const refs = new Set<string>();
  for (const ref of [...options.protectedRefs, options.operatorBranch, ...options.checkedOut]) {
    if (ref.length === 0) continue;
    refs.add(ref);
    // Both spellings, so a short name and its full ref path are the same
    // member of the set rather than two different strings.
    refs.add(ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : 'refs/heads/' + ref);
  }
  return refs;
}

/** Refuse an argv that names a ref the host must never write. */
export function refuseProtectedRef(argv: string[], never: ReadonlySet<string>): EvolveOutcome<true> {
  for (const arg of argv) {
    if (never.has(arg)) {
      return refuseOne<true>('TEVO1003', '/args', 'The ref ' + arg + ' is never a write target.');
    }
  }
  return accept();
}
