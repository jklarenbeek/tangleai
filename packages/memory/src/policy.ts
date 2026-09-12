/** Serializable memory defaults selected by the registered policy experiment. */
import { DEFAULT_MEMORY_POLICY, MEASURED_MEMORY_POLICIES, SHIPPED_LEGACY_CELL_ID } from './policy.gen.ts';

import type { Policy as MemoryPolicyValues } from './policy.types.ts';
export type { Policy as MemoryPolicyValues } from './policy.types.ts';

export { DEFAULT_MEMORY_POLICY, POLICY_PROVENANCE, MEASURED_MEMORY_POLICIES, SHIPPED_LEGACY_CELL_ID, POLICY_CONTRACT_REVISION } from './policy.gen.ts';

/** The historical control is an explicit opt-in, including its historical hash width. */
export const SHIPPED_LEGACY_POLICY = MEASURED_MEMORY_POLICIES[SHIPPED_LEGACY_CELL_ID];

/** Disabled cosine policies lower to the existing threshold-2 seam. */
export function policyThresholds(policy: MemoryPolicyValues = DEFAULT_MEMORY_POLICY): { novelty: number, contradiction: number, crystallize: number } {
  return {
    novelty: policy.novelty.enabled ? policy.novelty.threshold : 2,
    contradiction: policy.contradiction.enabled ? policy.contradiction.threshold : 2,
    crystallize: policy.crystallization.enabled ? policy.crystallization.threshold : 2,
  };
}
