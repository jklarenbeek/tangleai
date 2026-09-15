/**
 * The authority model, and the capability that does not exist.
 *
 * A principal carries `propose`, `execute` and `approve`. There is no
 * `merge`, `push` or `promote` member and the schema refuses one, so the
 * capability is absent from the vocabulary rather than defended at a call
 * site — a mutator cannot ask for what cannot be spelled. Keeping a change
 * produces a branch and a review bundle; a person merges it.
 */

import { checkShape } from './schema.ts';
import { refuseOne, ok, type EvolveOutcome } from './errors.ts';
import type { EvolvePrincipal } from './contracts.gen.ts';

/** Every action a principal can be asked to hold. */
export type EvolveAction = 'propose' | 'execute' | 'approve';

export const EVOLVE_ACTIONS: readonly EvolveAction[] = Object.freeze(['propose', 'execute', 'approve']);

/**
 * The principal every test and instrument row runs as: it may propose and
 * execute, and it may not approve. Approval is a person's.
 */
export const AUTOMATION_PRINCIPAL: Readonly<EvolvePrincipal> = Object.freeze({
  id: 'evolve-automation',
  authorityId: 'evolve-automation/v1',
  propose: true,
  execute: true,
  approve: false,
});

export function checkPrincipal(value: unknown, path = ''): EvolveOutcome<EvolvePrincipal> {
  return checkShape<EvolvePrincipal>('evolvePrincipal', value, path);
}

/** Refuse an action the principal does not hold. The pointer names the capability. */
export function assertAuthority(principal: EvolvePrincipal, action: EvolveAction): EvolveOutcome<EvolvePrincipal> {
  const checked = checkPrincipal(principal);
  if (!checked.ok) return checked;
  if (checked.value[action] !== true) {
    return refuseOne<EvolvePrincipal>('TEVO1010', '/' + action,
      'Principal ' + checked.value.id + ' does not hold ' + action + '.');
  }
  return ok(checked.value);
}
