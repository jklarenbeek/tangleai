import type { ResearchProject } from './contracts.gen.ts';
import { immutableResearchJson } from './identity.ts';
import { researchFail } from './workflow-contract.ts';

export type ResearchMode = { mode?: 'gate-only'; experimental?: false } | { mode: 'full-auto'; experimental: true };
export function researchMode(input: ResearchMode = {}): { mode: ResearchProject['mode']; experimental: boolean } {
  const value = immutableResearchJson(input);
  if (Object.keys(value).some(key => key !== 'mode' && key !== 'experimental')
    || ![undefined, 'gate-only', 'full-auto'].includes(value.mode)
    || value.mode === 'full-auto' && value.experimental !== true
    || value.mode !== 'full-auto' && value.experimental !== undefined && value.experimental !== false)
    researchFail('TRSH1001', '/mode', 'Full-auto requires an explicit experimental opt-in; gate-only is the default.');
  return { mode: value.mode ?? 'gate-only', experimental: value.mode === 'full-auto' };
}
