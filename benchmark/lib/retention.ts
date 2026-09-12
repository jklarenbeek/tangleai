import { createLedger } from '@tangleai/context/ledger';
import { createMemoryStorage } from '@tangleai/context/storage/memory';
import { createHashEmbedder } from '@tangleai/models/embed';
import { ledgerFootprint, checkpointProgress, goalPrompt } from '@tangleai/context/retention';

/** Seeded addressed corpus with repeated progress, independent citations and Unicode. */
export async function retentionFixture(rounds: number = 48, seed: number = 73) {
  const backing = new Map(), storage = createMemoryStorage(backing);
  const ledger = createLedger({ storage, now: () => '2026-09-09T00:00:00Z', embedder: createHashEmbedder({ dims: 32 }), embedOnWrite: true });
  await ledger.setGoal({ objective: 'Resume the verified import.' });
  const references: any[] = [];
  for (let i = 0; i < rounds; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const name = `round-${String(i).padStart(4, '0')}`;
    const referenced = i % 8 === 0;
    if (referenced) references.push(name);
    await ledger.putSlot(name, JSON.stringify({ answer: seed, text: 'évidence '.repeat(40), referenced }), { kind: 'agent-round' });
    await ledger.recordProgress({ note: `Verified batch ${i % 4}: ${'accepted '.repeat(14)}`, evidence: `receipt-${i % 4}: ${'source '.repeat(16)}` });
    if (referenced) await ledger.addMemory({
      text: `Verified batch ${i}`, evidence: {
        version: 1, artifacts: [{ id: name, kind: 'slot', locator: name }],
        evidence: [{ id: `e${i}`, artifact: name }], visibleEvidence: [`e${i}`],
        claims: [{ id: `c${i}`, text: `answer ${seed}`, critical: true, status: 'supported', evidence: [`e${i}`] }],
      }
    });
  }
  await ledger.addSkill({ name: 'resume', when: 'restart', instructions: 'Use verified receipts.' });
  const records = Object.fromEntries([...backing].map(([key, raw]) => [key, JSON.parse(raw)]));
  records['ai/state/goal/active'].progress.forEach((entry: any, i: any) => { entry.id ??= `progress-${i}`; });
  return { records, references, rounds, seed };
}

/** Offline policies expose all address loss; no production eviction is invoked. */
export async function measureRetention(fixture: any, maxItems: any, policy: any) {
  const records = structuredClone(fixture.records), evicted: any[] = [];
  const rounds = Object.keys(records).filter((key) => records[key]?.kind === 'agent-round').sort();
  let remaining = rounds.length;
  for (const key of rounds) {
    if (remaining <= maxItems || policy === 'none' || policy === 'checkpoint') break;
    const name = records[key].name;
    if (policy === 'unreferenced' && fixture.references.includes(name)) continue;
    delete records[key]; delete records[`ai/state/slot-content/${name}`];
    evicted.push(name); remaining--;
  }
  const goal = records['ai/state/goal/active'];
  if (policy === 'checkpoint') { goal.checkpoint = checkpointProgress(goal); goal.progress = []; }
  const storage = createMemoryStorage(new Map(Object.entries(records).map(([key, value]) => [key, JSON.stringify(value)])));
  const resumed = createLedger({ storage, embedder: createHashEmbedder({ dims: 32 }) });
  const retrieved = await resumed.recall({ near: 'Verified batch', limit: 10 });
  const resolved = fixture.references.filter((name: any) => records[`ai/state/slot/${name}`]).length;
  const notes = goal.checkpoint ? goal.checkpoint.records : goal.progress;
  return {
    policy, maxItems, footprint: ledgerFootprint(records), evicted,
    addressResolution: remaining / fixture.rounds, referencedResolution: resolved / fixture.references.length,
    unreferencedResolution: (remaining - resolved) / (fixture.rounds - fixture.references.length),
    resumedCorrectness: notes.some((entry: any) => entry.evidence.includes('receipt-0')) ? 1 : 0,
    retrievalRecall10: (retrieved as import('@tangleai/context/ledger').LedgerRankedMemories).memories.length / fixture.references.length,
    failedWrites: remaining > maxItems ? 1 : 0, goalChars: goalPrompt(goal).length
  };
}
