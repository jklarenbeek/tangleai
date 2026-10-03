/** Explicit operation intent composed with the existing spatial safety gates. */
import { canonicalizeJson } from '@jarenjs/json/canonical';
import { cloneJson } from '@jarenjs/core/object';
import { spatialGates } from '@tangleai/jaren/spatial';
import { checkPlace, placeRefuse, placeSuccess, type PlaceIntent, type PlaceOperation, type PlaceResult } from './contracts.ts';

export interface PlaceGateCall { question: string; sample?: unknown; intent: PlaceIntent; }
export function placeIntent(operation: Pick<PlaceOperation, 'kind'>): PlaceIntent {
  return { proximity: operation.kind === 'nearby', spatial: true };
}
export function placeGates(call: PlaceGateCall): ReturnType<typeof spatialGates> { return spatialGates(call); }
/** These are spatial safety checks; the authoring host still owns compilation and execution gates. */
export function checkAuthoredQuery(document: unknown, call: PlaceGateCall): PlaceResult<unknown> {
  try {
    canonicalizeJson(document);
    if (call.sample !== undefined) canonicalizeJson(call.sample);
    const intent = checkPlace<PlaceIntent>('placeIntent', call.intent); if (intent.status !== 'success') return intent;
    for (const gate of placeGates({ ...call, intent: intent.value })) {
      const verdict = gate(document);
      if (verdict !== true) {
        const error = verdict.errors[0];
        return placeRefuse('TPLC1007', error.message, error.code);
      }
    }
    return placeSuccess(cloneJson(document));
  } catch (cause) { return placeRefuse('TPLC1001', `invalid spatial query input: ${cause instanceof Error ? cause.message : String(cause)}`); }
}
