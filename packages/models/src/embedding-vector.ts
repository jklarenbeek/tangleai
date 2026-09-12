/**
 * The embeddings wire and replay share one AI0003 conversion policy:
 * each component must remain finite in the Float32Array the client
 * returns. Shape and width are checked by the caller, which also
 * supplies the subject naming the input or stored entry that failed.
 */

import { AiError } from './errors.ts';

/**
 * Verify embedding components into a fresh Float32Array, refusing
 * non-numbers, non-finite values and finite numbers that overflow
 * Float32. The source array is never changed.
 * @param components - an array whose shape and width were checked
 * @param subject - the subject and verb of a refusal
 */
export function verifyEmbeddingComponents(components: any[], subject: string): Float32Array {
  const vector = new Float32Array(components.length);
  for (let i = 0; i < components.length; i++) {
    const x = components[i];
    if (typeof x !== 'number' || !Number.isFinite(x))
      throw new AiError('AI0003', `${subject} a component that is not a finite number at ${i}`);
    vector[i] = x;
    if (!Number.isFinite(vector[i]))
      throw new AiError('AI0003', `${subject} a component outside the finite Float32 range at ${i}`);
  }
  return vector;
}
