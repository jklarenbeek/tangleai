import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dnsLogPathOf, readDnsLog, recordingLookup, replayingLookup, writeDnsLog } from '../../benchmark/lib/dns-capture.ts';

it('records each host\'s answers in order, failures included, and replays them without resolving', async () => {
  const answers = [[{ address: '93.184.216.34', family: 4 }], [{ address: '2606:2800:220:1::', family: 6 }]];
  let calls = 0;
  const recorded = recordingLookup(async (hostname) => {
    if (hostname === 'missing.example') throw Object.assign(new Error('getaddrinfo ENOTFOUND missing.example'), { code: 'ENOTFOUND' });
    return answers[calls++];
  });
  assert.deepEqual(await recorded.lookup('a.example'), answers[0]);
  assert.deepEqual(await recorded.lookup('a.example'), answers[1]);
  await assert.rejects(recorded.lookup('missing.example'), /ENOTFOUND/);

  const dir = await mkdtemp(join(tmpdir(), 'dns-capture-'));
  try {
    const path = dnsLogPathOf(join(dir, 'grounding-http.sqlite'));
    assert.equal(path, join(dir, 'grounding-http-dns.json'));
    await writeDnsLog(path, recorded.log);
    const replay = replayingLookup(await readDnsLog(path));
    assert.deepEqual(await replay.lookup('a.example'), answers[0]);
    assert.deepEqual(await replay.lookup('a.example'), answers[1]);
    assert.deepEqual(await replay.lookup('a.example'), answers[1], 'the last answer repeats');
    await assert.rejects(replay.lookup('missing.example'), (error: any) => error.code === 'ENOTFOUND');
    await assert.rejects(replay.lookup('never.example'), /no recorded resolution for never\.example/);
    assert.equal(replay.misses(), 1);

    await writeFile(path, JSON.stringify({ version: 1, hosts: { 'a.example': [{ addresses: [{ address: 7 }] }] } }));
    await assert.rejects(readDnsLog(path), /not a recorded DNS log/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
