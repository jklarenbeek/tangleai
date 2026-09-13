import { it } from 'node:test';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, resolve } from 'node:path';
import { ROOT, config, npm, readJson } from '../../scripts/release/common.ts';
import { assertPackagedGuides } from '../../scripts/release/build.ts';

for (const path of config().packages) {
  const source = resolve(ROOT, path);
  if (!existsSync(resolve(source, 'docs'))) continue;
  it(`${basename(source)} ships all package guides through its real npm files allowlist`, () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'tangle-guide-pack-'));
    try {
      const manifest = readJson(resolve(source, 'package.json'));
      writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'tangle-guide-probe', version: '0.0.0', private: true, files: manifest.files }));
      cpSync(resolve(source, 'README.md'), resolve(directory, 'README.md'));
      cpSync(resolve(source, 'docs'), resolve(directory, 'docs'), { recursive: true });
      const [pack] = JSON.parse(npm(['pack', '--dry-run', '--ignore-scripts', '--json'], { cwd: directory, capture: true }));
      assertPackagedGuides(source, new Set(pack.files.map((file: { path: string }) => file.path)));
    } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
  });
}
