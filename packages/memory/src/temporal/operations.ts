/** Durable accounting immediately around the one-attempt injected transport. */
import { checkTemporal, refuse, success, temporalIdentity, type TemporalResult, type TemporalOperation, type TemporalLimits, type PhysicalAttempt, type Json, type Refusal } from './contracts.ts';
import type { TemporalStore } from './store.ts';
export class TemporalFailure extends Error {
  refusal: Refusal;
  constructor(refusal: Refusal) { super(refusal.detail); this.refusal = refusal; }
}
export function temporalValue<T>(result: TemporalResult<T>): T { if (result.status !== 'success') throw new TemporalFailure(result); return result.value; }
export function temporalFailure(cause: unknown): Refusal {
  // The models transport preserves injected failures as Error.cause.
  let current = cause;
  for (let depth = 0; depth < 8 && current instanceof Error; depth++, current = current.cause) if (current instanceof TemporalFailure) return current.refusal;
  return refuse('provider-refusal', cause instanceof Error ? cause.message : String(cause));
}
export interface TemporalExecutionOptions { fetch: typeof fetch; signal?: AbortSignal; probe?: (step: 'before-transport' | 'after-transport') => void }
export async function createTemporalExecution(store: TemporalStore, reserved: TemporalOperation, limits: TemporalLimits, options: TemporalExecutionOptions) {
  temporalValue(checkTemporal<TemporalLimits>('temporalLimits', limits));
  let operation = temporalValue(await store.updateOperation({ ...reserved, phase: 'in-flight', revision: reserved.revision + 1 }, reserved.revision));
  const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(new Error('temporal deadline exceeded')), limits.deadlineMs);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline.signal]) : deadline.signal;
  async function update(next: TemporalOperation) { operation = temporalValue(await store.updateOperation(next, operation.revision)); }
  async function settle(index: number, changes: Partial<PhysicalAttempt>) {
    await update({ ...operation, revision: operation.revision + 1, attempts: operation.attempts.map((a, i) => i === index ? { ...a, ...changes } : a) });
  }
  function abortable<T>(task: Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true });
      task.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  return {
    operation: () => operation,
    signal,
    close: () => clearTimeout(timer),
    transport(role: PhysicalAttempt['role']): typeof fetch {
      return async (url, init) => {
        signal.throwIfAborted();
        if (operation.attempts.some(a => a.phase === 'in-flight')) throw new TemporalFailure(refuse('provider-refusal', 'a physical request is already in progress'));
        if (operation.attempts.length >= limits.maxPhysicalRequests) throw new TemporalFailure(refuse('budget-exhausted', 'physical request budget exhausted before transport'));
        const body = String(init?.body ?? ''), inputTokens = new TextEncoder().encode(body).length;
        // Conservative UTF-8 byte reservation, not measured tokenizer usage. Actual usage remains in the persisted wire reply.
        if (inputTokens > limits.maxInputTokens) throw new TemporalFailure(refuse('budget-exhausted', 'request UTF-8 byte token ceiling exceeds maxInputTokens'));
        const index = operation.attempts.length;
        await update({ ...operation, revision: operation.revision + 1, attempts: [...operation.attempts,
          { role, phase: 'in-flight', inputTokens, outputTokens: null, requestHash: await temporalIdentity({ url: String(url), body }), reply: null }] });
        let responseKnown = false;
        try {
          options.probe?.('before-transport'); signal.throwIfAborted();
          const response = await abortable(options.fetch(url, { ...init, signal, redirect: 'error' }));
          const text = await abortable(response.text()); responseKnown = true;
          options.probe?.('after-transport');
          let reply: Json; try { reply = JSON.parse(text) as Json; } catch { reply = text; }
          const usage = reply && typeof reply === 'object' && !Array.isArray(reply) ? reply.usage : null;
          const output = usage && typeof usage === 'object' && !Array.isArray(usage) ? usage.completion_tokens : null;
          const outputTokens = typeof output === 'number' && Number.isSafeInteger(output) && output >= 0 ? output : null;
          await settle(index, { phase: response.ok ? 'completed' : 'failed', outputTokens, reply });
          if (outputTokens !== null && outputTokens > limits.maxOutputTokens) throw new TemporalFailure(refuse('budget-exhausted', 'provider exceeded the output token ceiling'));
          return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
        } catch (cause) {
          if (operation.attempts[index].phase === 'in-flight') {
            // A persisted in-flight attempt with no receipt is never an automatic retry ticket.
            try { await settle(index, { phase: 'unknown' }); } catch { /* Original durable in-flight marker remains recoverable. */ }
          }
          throw cause instanceof TemporalFailure ? cause : new TemporalFailure(refuse('provider-refusal', `${responseKnown ? 'unpersisted-response' : 'unknown-external-outcome'}: ${String(cause)}`));
        }
      };
    },
    async fail(reason: Refusal): Promise<void> {
      if (['completed', 'failed', 'unknown'].includes(operation.phase)) return;
      const unknown = operation.attempts.some(a => a.phase === 'unknown' || a.phase === 'in-flight');
      try { await update({ ...operation, revision: operation.revision + 1, phase: unknown ? 'unknown' : 'failed',
        attempts: operation.attempts.map(a => a.phase === 'in-flight' ? { ...a, phase: 'unknown' } : a), receipt: reason as unknown as Json }); }
      catch { /* The durable reservation remains visible and cannot be spent automatically. */ }
    },
  };
}
/** Host asserts the previous owner stopped. Recovery records uncertainty; it never retries a call. */
export async function recoverTemporalOperation(store: TemporalStore, scope: string, key: string, expectedRevision: number): Promise<TemporalResult<TemporalOperation>> {
  const current = await store.operation(scope, key); if (current.status !== 'success') return current;
  const prior = current.value;
  if (!prior) return refuse('identity-mismatch', 'operation does not exist');
  if (prior.revision !== expectedRevision) return refuse('stale-projection', 'operation changed since recovery inspection');
  if (['completed', 'failed', 'unknown'].includes(prior.phase)) return success(prior);
  return store.updateOperation({ ...prior, revision: prior.revision + 1, phase: 'unknown',
    attempts: prior.attempts.map(a => a.phase === 'in-flight' ? { ...a, phase: 'unknown' } : a), receipt: { reason: 'owner-stopped', automaticRetry: false } }, prior.revision);
}
