/**
 * The gate on the desktop's public shape.
 *
 * The frozen projection beside this file is the OLDEST surface still
 * supported — the surface a released client negotiated against. Every difference between it and the contract the
 * tree compiles today is classified by the suite's published rule table,
 * and only the differences named in the two lists below are allowed to be
 * breaking or unclassifiable — so a narrowing nobody declared turns the
 * gate red by exit code rather than reaching a consumer.
 *
 * A deliberate change is made by appending its rule occurrence to the list
 * in the same diff that makes the change, never by loosening an assertion.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { compileContract } from '@jarenjs/contract';
import { publicProjection } from '@jarenjs/contract/project';
import { diffContracts, isCompatible } from '@jarenjs/contract/diff';

import { DESKTOP_CONTRACT } from '../../apps/desktop/src/contract.ts';

const FROZEN_PATH = 'test/fixtures/desktop-contract-0.28.0.json';

/**
 * The release the freeze was taken at, read from the freeze's own name so
 * one fact has one home: rename the file and this moves with it. The
 * freeze is the OLDEST surface still supported, not "the previous
 * release" — it is re-taken only when support for a client is dropped,
 * which is why it can sit at a version the tree left behind.
 */
const FROZEN_VERSION = /desktop-contract-(\d+\.\d+\.\d+)\.json$/.exec(FROZEN_PATH)![1];

/**
 * Deliberate breaking changes since the frozen projection, one entry per
 * rule occurrence: `{ rule, docPath }`, in the order the classifier
 * reports them.
 *
 * Empty because the freeze beside this file is the surface this release
 * ships: a release re-takes it, so the diff it guards is the one a later
 * change makes against what was actually released. The previous freeze is
 * retained as `desktop-contract-0.27.3.json`, and two rule occurrences
 * separate it from this one — neither is negotiable away, and a client
 * built against it cannot talk to this surface, because no `compat`
 * window is declared for a release that removed an operation:
 *
 * R6 `settings.set … /settings/properties/profile`: the stored settings
 * gained the name of the registry profile a run is resolved against, and
 * a typed member constrains a name that used to be an unconstrained
 * extra property. The same classification the optional token settings
 * took, for the same reason.
 *
 * R1 `/operations/dag.live`: the removed operation streamed one
 * process-global slot holding whichever run started last, so a
 * subscriber could neither name the run it watched nor resume it. Run
 * addressing replaces it — `runs.live` for the table, `run.live` for one
 * named run's frames — and an alias answering "the latest run" would
 * reintroduce exactly the defect the removal exists to end.
 */
const DOCUMENTED_BREAKING: Array<{ rule: string, docPath: string }> = [];

/**
 * Constructs the rule table declines to classify (R15) — a moved external
 * `$ref`, an `anyOf`/`if`, a changed `pattern`. Empty by construction: new
 * wire members are plain object documents, and the closed per-kind shapes
 * stay in the store where a validator, not a diff, decides them.
 */
const DOCUMENTED_UNKNOWN: Array<{ rule: string, docPath: string }> = [];

const readFrozen = async (): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(FROZEN_PATH, 'utf8')) as Record<string, unknown>;

const occurrences = (changes: ReadonlyArray<{ rule: string, docPath: string }>): Array<{ rule: string, docPath: string }> =>
  changes.map((change) => ({ rule: change.rule, docPath: change.docPath }));

describe('the desktop contract gate', () => {
  it('freezes the released surface: every operation, and the run-addressed subscribes among them', async () => {
    const frozen = await readFrozen() as { version: string, operations: Record<string, { kind: string }> };
    const operations = Object.entries(frozen.operations);
    assert.equal(operations.length, 37, 'the frozen projection is the whole released surface');
    assert.deepEqual(operations.filter(([, operation]) => operation.kind === 'subscribe').map(([id]) => id), ['runs.live', 'run.live'],
      'the released surface streams a collection and one named run, never a global slot');
    const live = Object.entries(DESKTOP_CONTRACT.operations as unknown as Record<string, { kind: string, input: { required?: readonly string[] } }>)
      .filter(([, operation]) => operation.kind === 'subscribe');
    assert.deepEqual(live.map(([id]) => id), ['runs.live', 'run.live'], 'today every live thing is a collection or a run');
    assert.deepEqual(live.find(([id]) => id === 'run.live')?.[1].input.required, ['runId'],
      'a subscriber must name the run it watches');
    assert.equal(frozen.version, FROZEN_VERSION,
      `the freeze must name the release it was taken at: re-take it with `
      + `\`node scripts/desktop-contract-fixture.ts ${FROZEN_PATH}\`, or rename the file to ${frozen.version}`);
    // The frozen bytes must still compile as a contract: a projection that
    // cannot be compiled could never be diffed against.
    assert.match(await compileContract(frozen).revision(), /^[0-9a-f]{64}$/);
  });

  it('classifies every change since the freeze as a documented one', async () => {
    const frozen = await readFrozen();
    const current = publicProjection(compileContract(DESKTOP_CONTRACT));
    const diff = diffContracts(frozen, current);

    assert.deepEqual(occurrences(diff.breaking), DOCUMENTED_BREAKING,
      `undocumented breaking change: ${JSON.stringify(diff.breaking.slice(0, 3))}`);
    assert.deepEqual(occurrences(diff.unknown), DOCUMENTED_UNKNOWN,
      `unclassifiable construct on the wire: ${JSON.stringify(diff.unknown.slice(0, 3))}`);

    // `diffContracts` computes WHAT changed; `isCompatible` reads what the
    // authors CLAIM. The suite keeps them independent on purpose, so neither
    // is derived from the other here — instead the gate asserts the two
    // agree, which is the one thing a person can get wrong. A surface that
    // broke nothing owes its oldest supported client a way in; a surface
    // that removed or narrowed something must not claim to accept it.
    const claimed = isCompatible(frozen, current);
    const sameVersion = frozen.version === DESKTOP_CONTRACT.version;
    if (sameVersion) {
      assert.equal(claimed, true, 'a freeze at this very version always negotiates');
    }
    else if (diff.breaking.length === 0) {
      assert.equal(claimed, true,
        `nothing in this surface broke, so a client at ${FROZEN_VERSION} must still be able to speak to it: `
        + `add '${FROZEN_VERSION}' to DESKTOP_CONTRACT.compat in apps/desktop/src/contract.ts`);
    }
    else {
      assert.equal(claimed, false,
        `this surface has ${diff.breaking.length} documented breaking change(s) since ${FROZEN_VERSION}, `
        + `so it must not claim to accept a client there: remove '${FROZEN_VERSION}' from DESKTOP_CONTRACT.compat, `
        + `or re-take the freeze once that client is no longer supported`);
    }
    assert.equal(isCompatible({ ...frozen, version: DESKTOP_CONTRACT.version }, current), true,
      'same-version negotiation is separate from the shape diff');

    const revision = await compileContract(DESKTOP_CONTRACT).revision();
    assert.match(revision, /^[0-9a-f]{64}$/, 'the compiled surface has a content address');
    console.log(`desktop contract revision ${revision}`);
  });

  it('the gate bites: a removed output member is a breaking change nobody documented', async () => {
    const frozen = await readFrozen() as unknown as {
      operations: Record<string, { output: { required?: string[], properties: Record<string, unknown> } }>,
    };
    const narrowed = structuredClone(frozen);
    const status = narrowed.operations['status.get'].output;
    status.required = (status.required ?? []).filter((member) => member !== 'counts');
    delete status.properties.counts;

    const diff = diffContracts(frozen as never, narrowed as never);
    assert.equal(diff.breaking.length > 0, true, 'removing a required output member is a breaking change');
    assert.equal(diff.breaking[0].rule, 'R8');
    assert.notDeepEqual(occurrences(diff.breaking), DOCUMENTED_BREAKING,
      'an undeclared narrowing can never match the documented list');
  });

  it('the claim must match the classification, in both directions', async () => {
    // The invariant above, exercised on a synthetic pair, so that neither
    // arm is a branch this suite has never taken. A gate whose failing side
    // is never executed is a gate nobody has tested.
    const frozen = await readFrozen() as unknown as {
      version: string,
      operations: Record<string, { output: { required?: string[], properties: Record<string, unknown> } }>,
    };
    const released = structuredClone(frozen);
    released.version = '9.0.0';

    // A later surface that added nothing and removed nothing, and does not
    // name the older client: compatible by neither rule, so the gate speaks.
    const silent = structuredClone(frozen);
    silent.version = '9.0.1';
    assert.equal(diffContracts(released as never, silent as never).breaking.length, 0,
      'the pair differs only by version');
    assert.equal(isCompatible(released as never, silent as never), false,
      'a bumped version alone ends negotiation until someone declares it');

    // The declaration is what restores it — the one thing a person maintains.
    const declared = { ...silent, compat: [released.version] };
    assert.equal(isCompatible(released as never, declared as never), true,
      'declaring the older version is what lets its client back in');

    // And a surface that really did remove something must not declare it.
    const narrowed = structuredClone(declared) as typeof silent & { compat: string[] };
    const status = narrowed.operations['status.get'].output;
    status.required = (status.required ?? []).filter((member) => member !== 'counts');
    delete status.properties.counts;
    assert.equal(diffContracts(released as never, narrowed as never).breaking.length > 0, true,
      'the narrowed pair really is breaking');
    assert.equal(isCompatible(released as never, narrowed as never), true,
      'the declaration still reads as compatible — which is exactly the lie the gate refuses');
  });
});
