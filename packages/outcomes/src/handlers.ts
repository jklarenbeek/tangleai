/** One dispatch table over the direct service; no transport-owned business ledger. */
import type { Handler, RequestContext } from '@jarenjs/contract/http';
import type { OutcomeService } from './service.ts';
import { refuse } from './errors.ts';
const methods = {
  'outcomes.create': 'create', 'outcomes.resolve': 'resolve', 'outcomes.score': 'score',
  'outcomes.project': 'project', 'outcomes.reflect': 'reflect', 'outcomes.evaluate': 'evaluate',
  'outcomes.approve': 'approve', 'outcomes.promote': 'promote', 'outcomes.rollback': 'rollback',
  'outcomes.inject': 'injectChecked', 'outcomes.inspect': 'inspect', 'outcomes.history': 'history',
  'outcomes.reconcile': 'reconcile',
} as const;
export const OUTCOME_MODEL_OPERATIONS = Object.freeze(Object.keys(methods).filter(id => id !== 'outcomes.approve' && id !== 'outcomes.reconcile'));
export interface OutcomeHandlerBinding {
  /** Constructed with this authenticated host's principal and registry. */
  service: OutcomeService;
  /** Host scope access policy, evaluated before every read, write and replay. */
  allowScope(scopeId: string, context: RequestContext): boolean | Promise<boolean>;
}
export interface OutcomeHandlerOptions {
  /** A closure for local calls, or a resolver of already authenticated HTTP ctx.host. */
  resolveHost(context: RequestContext): OutcomeHandlerBinding | undefined | Promise<OutcomeHandlerBinding | undefined>;
}
export function createOutcomeHandlers(options: OutcomeHandlerOptions): Record<string, Handler> {
  return Object.fromEntries(Object.entries(methods).map(([id, method]) => [id, async (input: unknown, context: RequestContext) => {
      const binding = await options.resolveHost(context);
      const scopeId = (input as { scopeId?: unknown } | null)?.scopeId;
      if (!binding || typeof scopeId !== 'string' || !await binding.allowScope(scopeId, context)) return refuse('OUTC1003', 'The authenticated host refused scope access.');
      return await binding.service[method](input);
  }]));
}
