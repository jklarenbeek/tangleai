/**
 * @file The file replay cache — the published adapter and the live tiers'
 * store over it: a round trip under the earlier file names, the `fresh`
 * mode that remembers without answering, the `replay` mode that fails
 * closed, and the key check that turns a hash collision into a miss.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createEmbeddingClient } from '@tangleai/models/embed';
import { AiError } from '@tangleai/models/errors';
import { createFileReplayCache as createReplayDirectory } from '@tangleai/models/replay-file';

import { createFileReplayCache } from '../../benchmark/lib/replay-cache.ts';

/** @param run */
async function inTempDir(run: (dir: string) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'replay-cache-'));
  try {
    await run(join(dir, 'replay'));
  }
  finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('the file replay cache', function () {
  it('round-trips a value, keeps the key beside it, and counts its files', async function () {
    await inTempDir(async (dir) => {
      const cache = createFileReplayCache(dir);
      assert.strictEqual(cache.size(), 0, 'nothing before the first set, and no directory either');
      assert.strictEqual(await cache.get('k'), undefined);
      await cache.set('k', { vector: [1, 2.5, -3], ms: 12 });
      assert.deepStrictEqual(await cache.get('k'), { vector: [1, 2.5, -3], ms: 12 });
      assert.strictEqual(cache.size(), 1);
      const [file] = readdirSync(dir);
      const stored = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      assert.strictEqual(stored.key, 'k');
      assert.ok(/^[0-9a-f]{64}\.json$/.test(file), 'the file is named by the sha256 of the key');
      assert.strictEqual(file, `${createHash('sha256').update('k', 'utf8').digest('hex')}.json`, 'the same name the earlier store used');
    });
  });

  it('fresh answers nothing while still remembering what is bought', async function () {
    await inTempDir(async (dir) => {
      const fresh = createFileReplayCache(dir, { fresh: true });
      await fresh.set('k', { value: 1 });
      assert.strictEqual(await fresh.get('k'), undefined);
      assert.deepStrictEqual(await createFileReplayCache(dir).get('k'), { value: 1 }, 'a plain adapter over the same directory sees what fresh bought');
    });
  });

  it('replay mode answers what it holds and fails, without writing, on what it does not', async function () {
    await inTempDir(async (dir) => {
      await createFileReplayCache(dir).set('held', { value: 'yes' });
      const replay = createReplayDirectory({ dir, files, mode: 'replay' });
      assert.deepStrictEqual(await replay.get('held'), { value: 'yes' });
      await assert.rejects(Promise.resolve(replay.get('absent')), (err: any) => err instanceof AiError && err.code === 'AI0001');
      await assert.rejects(Promise.resolve(replay.set('absent', 1)), /read-only/);
      assert.strictEqual(await replay.size(), 1);
    });
  });

  it('a file whose recorded key differs is a miss, never someone else\'s answer; a broken file fails closed', async function () {
    await inTempDir(async (dir) => {
      const cache = createFileReplayCache(dir);
      await cache.set('real', { value: 'mine' });
      const [file] = readdirSync(dir);
      writeFileSync(join(dir, file), JSON.stringify({ key: 'other', value: 'theirs' }));
      assert.strictEqual(await cache.get('real'), undefined);
      writeFileSync(join(dir, file), '{"half":');
      await assert.rejects(Promise.resolve(cache.get('real')));
      assert.deepStrictEqual(readdirSync(dir).filter((name) => name.endsWith('.tmp')), [], 'writes leave no temporary file');
    });
  });

  it('carries an embedding client\'s vectors across two client lifetimes', async function () {
    await inTempDir(async (dir) => {
      const calls: any[] = [];
      const make = () => createEmbeddingClient({
        provider: 'ollama', model: 'nomic-embed-text', cache: createFileReplayCache(dir),
        fetch: (url: any, init: any) => {
          const input = JSON.parse(init.body).input;
          calls.push(input);
          return Promise.resolve(new Response(JSON.stringify({
            data: input.map((text: any, index: any) => ({ index, embedding: [text.length, 0.5, -0.25] })),
          }), { status: 200 }));
        },
      });
      const [first] = await make().embed(['hello']);
      const [again] = await make().embed(['hello']);
      assert.deepStrictEqual(calls, [['hello']], 'the second client bought nothing');
      assert.deepStrictEqual(Array.from(again), Array.from(first));
      assert.ok(again instanceof Float32Array);
    });
  });
});
