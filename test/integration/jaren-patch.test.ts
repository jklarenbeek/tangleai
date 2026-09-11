import { it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchJarenAi } from '../../scripts/patch-jaren-ai.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const patch = fileURLToPath(new URL('../../patches/jarenjs-ai-0.83.2.patch', import.meta.url));

it('applies the exact AI patch once, verifies it, and refuses changed preimages without partial writes', async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), 'tangle-ai-patch-'));
  try {
    await cp(join(root, 'node_modules/@jarenjs/ai'), packageRoot, { recursive: true });
    await patchJarenAi({ packageRoot, check: true });
    const undo = () => execFileSync('git', ['apply', '--reverse', '--unsafe-paths',
      `--directory=${packageRoot}`, patch], { cwd: root, stdio: 'pipe' });
    undo();
    await assert.rejects(patchJarenAi({ packageRoot, check: true }), /missing or changed/);
    assert.equal((await patchJarenAi({ packageRoot })).applied, true);
    assert.equal((await patchJarenAi({ packageRoot })).applied, false);
    await patchJarenAi({ packageRoot, check: true });
    undo();
    const recursive = await readFile(join(packageRoot, 'src/recursive.js'), 'utf8');
    const original = await readFile(join(packageRoot, 'src/index.js'), 'utf8');
    await writeFile(join(packageRoot, 'src/index.js'), original + '\n// unexpected edit\n');
    await assert.rejects(patchJarenAi({ packageRoot }), /Refusing changed JarenJS AI file/);
    assert.equal(await readFile(join(packageRoot, 'src/recursive.js'), 'utf8'), recursive);
    await writeFile(join(packageRoot, 'src/index.js'), original);
    const manifestPath = join(packageRoot, 'package.json');
    const pkg = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(manifestPath, JSON.stringify({ ...pkg, version: '0.83.3' }));
    await assert.rejects(patchJarenAi({ packageRoot }), /exact base version/);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
});
