import assert from 'node:assert/strict';
import { it } from 'node:test';
import { loadResearchFixture } from '../../benchmark/lib/research-fixture.ts';
import { runResearchReasoningFixture } from '../../benchmark/lib/research-reasoning.ts';

it('research receipts reproduce when parallel request hashes finish in reverse order', { timeout: 180000 }, async t => {
  const loaded = await loadResearchFixture();
  const first = (await runResearchReasoningFixture(loaded, loaded.topics[0], 'debate')).measurement;
  assert.ok(first);
  const targets = new Set(first.requests.filter(row => row.role === 'research-synthesis-analysis-analyst'
    && row.phase === 'completion').map(row => row.sha256));
  assert.equal(targets.size, 3);
  const original = crypto.subtle.digest;
  const waiting: Array<{ hash: string; release: () => void }> = [], completions: string[] = [];
  const releaseAll = () => { for (const held of waiting) held.release(); };
  t.signal.addEventListener('abort', releaseAll, { once: true });
  crypto.subtle.digest = async function (algorithm, data) {
    const result = await original.call(this, algorithm, data);
    const hash = Buffer.from(result).toString('hex');
    if (targets.has(hash)) {
      await new Promise<void>(resolve => {
        waiting.push({ hash, release: resolve });
        if (waiting.length === targets.size) queueMicrotask(() => { for (const held of [...waiting].reverse()) held.release(); });
      });
      completions.push(hash);
    }
    return result;
  };
  try {
    const second = (await runResearchReasoningFixture(loaded, loaded.topics[0], 'debate')).measurement;
    assert.ok(second);
    assert.equal(waiting.length, targets.size);
    assert.deepEqual(completions, waiting.map(row => row.hash).reverse());
    assert.equal(second.requests.length, 26);
    assert.deepEqual(second.requests, first.requests);
    assert.equal(JSON.stringify(second), JSON.stringify(first));
  } finally {
    crypto.subtle.digest = original;
    t.signal.removeEventListener('abort', releaseAll);
    releaseAll();
  }
});
