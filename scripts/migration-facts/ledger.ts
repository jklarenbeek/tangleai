import { readFileSync } from 'node:fs';
const read = (name: any) => JSON.parse(readFileSync(new URL(`../../benchmark/${name}.json`, import.meta.url), 'utf8'));
/** Ledger policy evidence participates in the shared derivation gate. */
export const ledgerFacts = {
  name: 'ledger lifecycle measurements',
  docs: () => ['benchmark/MIGRATED-JAREN.md', 'docs/AI-MECHANISM-ROADMAP.md', 'packages/models/README.md', 'packages/context/README.md', 'packages/agents/README.md', 'packages/jaren/README.md', 'packages/jaren/docs/AUTHORING.md'],
  facts: () => ({
    'ledger.retention': () => {
      const data = read('retention-result');
      const old = data.rows.find((r: any) => r.policy === 'oldest' && r.maxItems === 8);
      const safe = data.rows.find((r: any) => r.policy === 'unreferenced' && r.maxItems === 8);
      const goal = data.rows.find((r: any) => r.policy === 'checkpoint' && r.maxItems === 48);
      return `On ${data.rounds} seeded rounds, an eight-round oldest policy retains ${(old.referencedResolution * 100).toFixed(1)}% of referenced addresses; protected eviction retains ${(safe.referencedResolution * 100).toFixed(1)}%, while retaining only ${(safe.unreferencedResolution * 100).toFixed(1)}% of unreferenced addresses. A lossless checkpoint reduces goal context from ${old.goalChars.toLocaleString('en-US')} to ${goal.goalChars.toLocaleString('en-US')} characters. Impossible protected budgets are refused.`;
    },
    'ledger.decoding': () => {
      const data = read('patch-decoding-live'), prep = read('patch-decoding-preparatory');
      const cost = (doc: any) => doc.rows.reduce((sum: any, row: any) => sum + (row.usage?.cost ?? 0), 0);
      return `${data.provider}, ${data.model}: ${data.rows.map((row: any) => `${row.syntax} ${row.outcome}`).join('; ')} (${data.requests} calls, $${cost(data).toFixed(8)} reported cost). One trial per syntax is provider acceptance evidence, not proof of grammar enforcement. Two excluded preparatory calls cost $${cost(prep).toFixed(8)} and remain recorded.`;
    },
  }),
};
