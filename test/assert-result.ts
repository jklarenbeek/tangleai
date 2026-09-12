import assert from 'node:assert/strict';

type Member<T, K extends PropertyKey> = T extends unknown ? K extends keyof T ? T : never : never;

/** Assert a result variant before inspecting a value returned inline by a runtime API. */
export function withMember<T, K extends PropertyKey>(value: T, key: K): Member<T, K> {
  assert.ok(value !== null && value !== undefined && key in Object(value),
    `Expected a result with ${String(key)}`);
  return value as Member<T, K>;
}
