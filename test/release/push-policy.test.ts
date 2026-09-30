import { it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { ROOT, config, git, readJson } from '../../scripts/release/common.ts';
import { isDocumentationOnly, pushBase } from '../../scripts/release/push-policy.ts';
import { checkPush } from '../../scripts/release/pre-push.ts';
import { assertCiResults } from '../../scripts/release/ci-results.ts';

const zero = '0'.repeat(40);
function put(root: string, path: string, contents = 'fixture\n') {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), contents);
}
function commit(root: string) {
  git(root, 'add', '--all');
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Fixture');
  return git(root, 'rev-parse', 'HEAD');
}
function fixture(t: TestContext) {
  const root = mkdtempSync(resolve(tmpdir(), 'tangle-push-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'core.filemode', 'true');
  git(root, 'config', 'core.excludesFile', resolve(root, '.git/empty-ignore'));
  writeFileSync(resolve(root, '.git/empty-ignore'), '');
  put(root, 'README.md');
  put(root, 'packages/core/src/index.ts');
  const base = commit(root);
  git(root, 'update-ref', 'refs/remotes/origin/main', base);
  return { root, base };
}
function push(head: string, base: string, ref = 'refs/heads/main') {
  return `${ref} ${head} ${ref} ${base}\n`;
}

it('accepts a PDF-only push without release records, tarballs or a version bump', t => {
  const { root, base } = fixture(t);
  put(root, 'docs/refs/2609.26891v1.pdf', '%PDF fixture');
  const head = commit(root);
  assert.equal(isDocumentationOnly(root, base, head), true);
  checkPush(root, push(head, base));
  checkPush(root, push(head, zero, 'refs/heads/docs'));
  checkPush(root, push(head, base, 'refs/heads/docs'));
});

it('accepts documentation edits, deletions, renames and filenames with spaces or newlines', t => {
  const { root, base } = fixture(t);
  git(root, 'mv', 'README.md', 'docs renamed.md');
  // Only the root README is exempt, so move the destination into docs.
  mkdirSync(resolve(root, 'docs'));
  git(root, 'mv', 'docs renamed.md', 'docs/renamed guide.md');
  put(root, 'docs/line\nbreak.md');
  put(root, 'docs/diagram.png');
  const head = commit(root);
  assert.equal(isDocumentationOnly(root, base, head), true);
  rmSync(resolve(root, 'docs/renamed guide.md'));
  assert.equal(isDocumentationOnly(root, head, commit(root)), true);
});

for (const path of ['packages/core/src/index.ts', 'packages/core/README.md', 'packages/core/docs/GUIDE.md',
  'prompts/agent.md', '.changeset/fix.md', 'CHANGELOG.md', 'package.json', 'package-lock.json', '.bun-version',
  'release.config.json', 'releases/0.30.1.json', '.github/workflows/ci.yml', 'scripts/release/check.ts',
  'docs/migrations/foundations.json', 'docs/migrations/fix.patch', 'docs/workflow/archives/ci.yml',
  'docs/script.ts', 'docs/script.svg', 'docs/page.html']) {
  it(`requires the full release gate when docs are mixed with ${path}`, t => {
    const { root, base } = fixture(t);
    put(root, 'docs/guide.md');
    put(root, path, 'changed\n');
    const head = commit(root);
    assert.equal(isDocumentationOnly(root, base, head), false);
    assert.throws(() => checkPush(root, push(head, base)), /artifacts.json/);
  });
}

it('does not hide source deletions behind a rename into documentation', t => {
  const { root, base } = fixture(t);
  mkdirSync(resolve(root, 'docs'));
  git(root, 'mv', 'packages/core/src/index.ts', 'docs/code.md');
  assert.equal(isDocumentationOnly(root, base, commit(root)), false);
});

it('rejects symlinks and executable documentation modes', t => {
  const { root, base } = fixture(t);
  put(root, 'docs/run.md');
  chmodSync(resolve(root, 'docs/run.md'), 0o755);
  assert.equal(isDocumentationOnly(root, base, commit(root)), false);
  rmSync(resolve(root, 'docs/run.md'));
  symlinkSync('../README.md', resolve(root, 'docs/link.md'));
  assert.equal(isDocumentationOnly(root, base, commit(root)), false);
});

it('refuses empty, missing and non-ancestor bases', t => {
  const { root, base } = fixture(t);
  assert.equal(isDocumentationOnly(root, base, base), false);
  put(root, 'docs/guide.md');
  const head = commit(root);
  for (const unknown of [zero, 'f'.repeat(40), '', 'HEAD^']) assert.equal(isDocumentationOnly(root, unknown, head), false);
  assert.equal(isDocumentationOnly(root, head, base), false);
  assert.throws(() => checkPush(root, push(head, 'f'.repeat(40))), /artifacts.json/);
});

it('includes earlier source commits in topic branches and multi-commit main pushes', t => {
  const { root, base } = fixture(t);
  put(root, 'packages/core/src/index.ts', 'changed\n');
  const source = commit(root);
  put(root, 'docs/guide.md');
  const head = commit(root);
  assert.equal(isDocumentationOnly(root, source, head), true);
  assert.equal(pushBase(root, 'refs/heads/topic', source), base);
  assert.throws(() => checkPush(root, push(head, source, 'refs/heads/topic')), /artifacts.json/);
  assert.throws(() => checkPush(root, push(head, base)), /artifacts.json/);
});

it('retains clean-tree and current-commit requirements and never exempts tags or other refs', t => {
  const { root, base } = fixture(t);
  put(root, 'docs/guide.md');
  const head = commit(root);
  assert.throws(() => checkPush(root, push(base, base)), /current verified commit/);
  assert.throws(() => checkPush(root, push(head, base, 'refs/tags/v0.30.1')), /artifacts.json/);
  assert.throws(() => checkPush(root, push(head, base, 'refs/notes/docs')), /artifacts.json/);
  put(root, 'docs/uncommitted.md');
  assert.throws(() => checkPush(root, push(head, base)), /clean committed tree/);
});

it('does not exempt rewritten topic branches or unknown topic history', t => {
  const { root, base } = fixture(t);
  put(root, 'docs/remote.md');
  const remote = commit(root);
  git(root, 'checkout', '-q', '--detach', base);
  put(root, 'docs/local.md');
  const head = commit(root);
  assert.equal(isDocumentationOnly(root, base, head), true);
  assert.throws(() => checkPush(root, push(head, remote, 'refs/heads/topic')), /artifacts.json/);
  assert.throws(() => checkPush(root, push(head, 'f'.repeat(40), 'refs/heads/topic')), /artifacts.json/);
});

it('the CI command uses the supplied main base and emits its decision only on success', t => {
  const { root } = fixture(t);
  for (const file of ['common.ts', 'check.ts', 'push-policy.ts']) {
    put(root, `scripts/release/${file}`, readFileSync(resolve(ROOT, 'scripts/release', file), 'utf8'));
  }
  put(root, 'package.json', '{"type":"module"}\n');
  const base = commit(root);
  put(root, 'docs/refs/paper.pdf');
  const head = commit(root);
  // A hosted checkout has origin/main at the new tip, unlike the pre-push hook.
  git(root, 'update-ref', 'refs/remotes/origin/main', head);
  const output = resolve(root, '.git/policy-output');
  const run = (ref: string, before: string) => {
    writeFileSync(output, '');
    return spawnSync(process.execPath, ['scripts/release/push-policy.ts', '--ref', ref, '--base', before],
      { cwd: root, env: { ...process.env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
  };
  const docs = run('refs/heads/main', base);
  assert.equal(docs.status, 0, docs.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'documentation-only=true\n');
  for (const before of ['', zero, 'f'.repeat(40)]) {
    assert.notEqual(run('refs/heads/main', before).status, 0);
    assert.equal(readFileSync(output, 'utf8'), '');
  }
  assert.notEqual(run('refs/tags/v0.30.1', base).status, 0);
  assert.equal(readFileSync(output, 'utf8'), '');
  git(root, 'update-ref', 'refs/remotes/origin/main', base);
  assert.equal(run('refs/heads/docs', zero).status, 0);
  put(root, 'packages/core/src/index.ts', 'changed\n');
  commit(root);
  assert.notEqual(run('refs/heads/docs', head).status, 0);
  assert.equal(readFileSync(output, 'utf8'), '');
});

it('CI accepts only the exact jobs intentionally skipped for documentation', () => {
  const jobs = Object.fromEntries(['release-version', 'check', 'minimum-node', 'instruments'].map(name => [name, { result: 'success' }]));
  assertCiResults(jobs, false);
  const docs = { ...jobs, 'minimum-node': { result: 'skipped' }, instruments: { result: 'skipped' } };
  assertCiResults(docs, true);
  assert.throws(() => assertCiResults(docs, false));
  for (const name of Object.keys(jobs)) {
    for (const result of ['failure', 'cancelled']) assert.throws(() => assertCiResults({ ...docs, [name]: { result } }, true));
  }
  assert.throws(() => assertCiResults({ ...docs, check: { result: 'skipped' } }, true));
  assert.throws(() => assertCiResults({}, true));
});

it('Bun pins, workspace engines, lock metadata and container runtime agree', () => {
  const bun = config().bun;
  assert.equal(bun, '1.4.2');
  assert.equal(readFileSync(resolve(ROOT, '.bun-version'), 'utf8').trim(), bun);
  const lock = readJson<any>(resolve(ROOT, 'package-lock.json'));
  for (const dir of ['', 'apps/desktop', 'apps/scraper', 'packages/documents']) {
    const pkg = readJson<any>(resolve(ROOT, dir, 'package.json'));
    assert.equal(pkg.engines.bun, `>=${bun}`);
    assert.deepEqual(lock.packages[dir].engines, pkg.engines);
  }
  assert.ok(readFileSync(resolve(ROOT, 'apps/scraper/Dockerfile'), 'utf8').includes(`FROM oven/bun:${bun} AS bun-runtime`));
});
