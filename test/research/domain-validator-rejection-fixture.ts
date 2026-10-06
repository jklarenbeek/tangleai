import assert from 'node:assert/strict';
import { bindDomainProfile, type ResearchDomainBindings } from '@tangleai/research';
import { domainFixture } from './domain-fixtures.ts';
import { checked, frozen } from './fixtures.ts';

const kind = process.argv[2];
assert.ok(['rejected-promise', 'rejected-thenable', 'throwing-accessor'].includes(kind));
const fixture = await domainFixture(), plan = await frozen();
fixture.bindings.planValidators['fixture-plan'].validate = (() => {
  fixture.calls.validator++;
  if (kind === 'rejected-promise') return Promise.reject(new Error('Invalid async plan validator.'));
  if (kind === 'rejected-thenable') return { then(_resolve: unknown, reject: (reason: unknown) => void) { reject(new Error('Rejected host thenable.')); } };
  return { get then(): unknown { throw new Error('Invalid thenable accessor.'); } };
}) as unknown as ResearchDomainBindings['planValidators'][string]['validate'];
const bound = checked(await bindDomainProfile(fixture.profile, fixture.bindings));
const result = bound.validatePlan(plan.contract, plan.plan);
assert.equal(result.valid, false);
if (!result.valid) assert.equal(result.issues[0].code, 'TRSH2008');
await new Promise<void>(resolve => setImmediate(resolve));
assert.deepEqual(fixture.calls, { model: 0, runner: 0, validator: 1, evaluator: 0, exporter: 0 });
console.log(JSON.stringify({ kind, code: 'TRSH2008', unhandled: false, modelCalls: 0, runnerInvocations: 0 }));
