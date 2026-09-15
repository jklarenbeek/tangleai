/**
 * The gate on the desktop's public shape.
 *
 * The frozen projection beside this file is the surface a released client
 * negotiated against. Every difference between it and the contract the
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
    assert.equal(frozen.version, DESKTOP_CONTRACT.version, 'the freeze names the release it was taken at');
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

    // `isCompatible` and the classification above answer different
    // questions: the first is version negotiation, the second is shape.
    // The freeze was taken at the current release, so negotiation holds and
    // the explicit same-version form asks the identical question; they stop
    // agreeing the moment a release moves the contract's version.
    assert.equal(isCompatible(frozen, current), true, 'the frozen projection names this release');
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
});
