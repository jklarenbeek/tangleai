/**
 * The evidence trail: what a strategy's proposals actually turned out to be.
 *
 * A decision is worth nothing to the next run unless the strategy that
 * produced it carries the record. This module is the ONE way that trail is
 * written, and it is a `createGuardedRefiner` consumer for the same reason
 * `patch.ts` is: the engine owns read-validate-apply-validate-plan-commit,
 * and a second hand-rolled copy of that sequence is how one of them ends up
 * missing a check.
 *
 * WHERE the evidence lands is decided by the ledger, not by this package.
 * The ledger's refinement vocabulary is
 * `/memories/(-|N)`, `/skills/(-|N)` and `/goal/progress/-`, and it states
 * outright that addressing INSIDE a record is deliberately impossible — a
 * record is revised by replacing it whole so that everything stored was
 * validated whole, exactly once. The skill schema is closed and carries no
 * evidence member at all. So the trail is an appended ledger MEMORY citing
 * the sealed decision record, which is the ledger's own sanctioned form for
 * "here is a durable fact, and here is what backs it".
 *
 * What does NOT happen here is as important. No confidence number is ever
 * written — not to a skill, not to a memory. Confidence belongs to the
 * outcome lifecycle, moves only through `projectOutcomeConfidence` inside
 * the outcome service's transaction, and a second path that could nudge it
 * would make "how well has this strategy done" a question with two answers.
 *
 * Both validators are SYNCHRONOUS and every refusal carries at least one
 * error. A validator that returns a Promise is read by the engine as
 * `{ valid: false, errors: [] }` — a refusal with no reason — and an empty
 * `errors` is indistinguishable from having fallen into that trap.
 */

import { createGuardedRefiner } from '@jarenjs/core/guarded';

import { evolveIssue, refuse, ok, type EvolveIssue, type EvolveOutcome } from './errors.ts';

/** The one pointer this refiner accepts. Anything else is TEVO1011. */
export const STRATEGY_EVIDENCE_PATH = '/memories/-';

/** The ledger members this module uses. Structural, so a stub fits. */
export interface RefinableLedger {
  getGoal(): Promise<unknown>;
  listMemories(): Promise<unknown[]>;
  listSkills(): Promise<unknown[]>;
  transaction<T>(expected: unknown, work: (ledger: RefinableLedger) => Promise<T>): Promise<T | { error: string, errors?: unknown[] }>;
  addMemory(input: { text: string, evidence: string, tags?: string[], at?: string }): Promise<unknown>;
}

export interface LedgerSnapshot {
  goal: unknown;
  memories: unknown[];
  skills: unknown[];
}

export interface EvidenceOperation {
  op: 'add';
  path: typeof STRATEGY_EVIDENCE_PATH;
  value: { text: string, evidence: string, tags?: string[] };
}

export interface AppendEvidenceInput {
  strategyId: string;
  /** The sealed decision record this strategy earned. */
  decisionRecordId: string;
  decision: string;
  reason: string;
  experimentId: string;
}

interface Verdict { valid: boolean; errors: EvolveIssue[] }

const invalid = (errors: EvolveIssue[]): Verdict =>
  // Never empty: an empty refusal reads like the accidental-Promise trap.
  ({ valid: false, errors: errors.length > 0 ? errors : [evolveIssue('TEVO1011', '', 'The proposal was refused without a stated reason.')] });

/** Build the one legal operation. Nothing else forms a valid proposal. */
export function evidenceOperation(input: AppendEvidenceInput): EvidenceOperation {
  return {
    op: 'add',
    path: STRATEGY_EVIDENCE_PATH,
    value: {
      text: 'Strategy ' + input.strategyId + ' proposed experiment ' + input.experimentId
        + ', which was ' + input.decision + ' (' + input.reason + ').',
      // The citation IS the evidence: a record id something else can read.
      evidence: input.decisionRecordId,
      tags: ['evolve-strategy-evidence', input.strategyId],
    },
  };
}

export interface StrategyRefinerOptions {
  ledger: RefinableLedger;
  /** Fixed by the caller so a record's time is never this module's to choose. */
  at?: string;
}

export function createStrategyRefiner(options: StrategyRefinerOptions) {
  const { ledger } = options;

  /** The ledger's own snapshot, in the ledger's own key order. */
  const read = async (): Promise<LedgerSnapshot> => ({
    goal: await ledger.getGoal(),
    memories: await ledger.listMemories(),
    skills: await ledger.listSkills(),
  });

  const guarded = createGuardedRefiner({
    read,

    validateProposal: (value: unknown): Verdict => {
      if (!Array.isArray(value) || value.length === 0) {
        return invalid([evolveIssue('TEVO1011', '/patch', 'A refinement is at least one operation.')]);
      }
      const errors: EvolveIssue[] = [];
      for (const [index, raw] of value.entries()) {
        const at = '/patch/' + index;
        const operation = raw as Partial<EvidenceOperation>;
        if (operation?.op !== 'add') {
          errors.push(evolveIssue('TEVO1011', at, 'Evidence is only ever appended; ' + String(operation?.op) + ' is not.'));
          continue;
        }
        if (operation.path !== STRATEGY_EVIDENCE_PATH) {
          // The whole point of the allow-list: a pointer that could reach a
          // skill, a goal or an existing record is not a refinement this
          // module performs, whatever it claims to be doing.
          errors.push(evolveIssue('TEVO1011', at + '/path',
            'Only ' + STRATEGY_EVIDENCE_PATH + ' is an evidence target, not ' + String(operation.path) + '.'));
          continue;
        }
        const body = operation.value as { text?: unknown, evidence?: unknown, tags?: unknown } | undefined;
        if (body === null || typeof body !== 'object') {
          errors.push(evolveIssue('TEVO1011', at + '/value', 'An appended memory is a JSON object.'));
          continue;
        }
        if (typeof body.text !== 'string' || body.text.length === 0) {
          errors.push(evolveIssue('TEVO1011', at + '/value/text', 'An appended memory states one fact.'));
        }
        if (typeof body.evidence !== 'string' || body.evidence.length === 0) {
          errors.push(evolveIssue('TEVO1011', at + '/value/evidence',
            'An appended memory cites the record that backs it.'));
        }
        if (Object.hasOwn(body, 'confidence')) {
          // Refused rather than stripped: a proposal that tried to set a
          // confidence was written by something that believes it may.
          errors.push(evolveIssue('TEVO1011', at + '/value/confidence',
            'Confidence moves only through the outcome lifecycle, never through a refinement.'));
        }
      }
      return errors.length === 0 ? { valid: true, errors: [] } : invalid(errors);
    },

    apply: (document: unknown, proposal: unknown): LedgerSnapshot => {
      const snapshot = document as LedgerSnapshot;
      const operations = proposal as EvidenceOperation[];
      // On a copy the engine already made; the reader's object is never touched.
      return { ...snapshot, memories: [...snapshot.memories, ...operations.map(one => one.value)] };
    },

    applyFailure: (error: unknown): EvolveIssue => {
      const held = error as { code?: string, docPath?: string, message?: string };
      return evolveIssue('TEVO1011', '/patch', 'The refinement did not apply.', {
        code: typeof held?.code === 'string' ? held.code : 'refinement/failed',
        docPath: typeof held?.docPath === 'string' ? held.docPath : '/patch',
        message: typeof held?.message === 'string' ? held.message : String(error),
      });
    },

    validateCandidate: (next: unknown, previous: unknown): Verdict => {
      const after = next as LedgerSnapshot;
      const before = previous as LedgerSnapshot;
      const errors: EvolveIssue[] = [];
      // The skills and the goal are not this refiner's to touch. Asserted
      // rather than assumed, because "the pointer could not reach it" is a
      // claim about the validator above, and this is the check of it.
      if (JSON.stringify(after.skills) !== JSON.stringify(before.skills)) {
        errors.push(evolveIssue('TEVO1011', '/skills', 'An evidence append never edits a skill.'));
      }
      if (JSON.stringify(after.goal) !== JSON.stringify(before.goal)) {
        errors.push(evolveIssue('TEVO1011', '/goal', 'An evidence append never edits the goal.'));
      }
      if (after.memories.length <= before.memories.length) {
        errors.push(evolveIssue('TEVO1011', '/memories', 'An evidence append adds a memory.'));
      }
      for (const [index, memory] of after.memories.entries()) {
        if (index < before.memories.length) continue;
        if (Object.hasOwn(memory as object, 'confidence')) {
          errors.push(evolveIssue('TEVO1011', '/memories/' + index + '/confidence',
            'No refinement writes a confidence number.'));
        }
      }
      return errors.length === 0 ? { valid: true, errors: [] } : invalid(errors);
    },

    planCommit: (next: unknown, previous: unknown) => {
      const after = (next as LedgerSnapshot).memories;
      const before = (previous as LedgerSnapshot).memories;
      const appends = after.slice(before.length) as EvidenceOperation['value'][];
      return { valid: true, errors: [], plan: { appends } };
    },

    commit: async (plan: unknown, context: { previous: unknown }) => {
      const { appends } = plan as { appends: EvidenceOperation['value'][] };
      // `expected` is the snapshot the engine READ, in the ledger's own key
      // order, which is why the ledger's `JSON.stringify` comparison cannot
      // produce a false conflict against a state nobody changed.
      const outcome = await ledger.transaction(context.previous, async scoped => {
        const written: unknown[] = [];
        for (const value of appends) {
          written.push(await scoped.addMemory({
            text: value.text,
            evidence: value.evidence,
            tags: value.tags ?? [],
            ...(options.at === undefined ? {} : { at: options.at }),
          }));
        }
        return written;
      });
      return outcome;
    },
  });

  return {
    /** Validate and plan without writing. Synchronous, by the engine's contract. */
    prepare(snapshot: LedgerSnapshot, proposal: unknown) {
      return guarded.prepare(snapshot, proposal as Record<string, unknown>);
    },

    /** The ledger snapshot, for a caller that wants to prepare against it. */
    read,

    /** Append one strategy's decision evidence, through the guarded path. */
    async appendEvidence(input: AppendEvidenceInput): Promise<EvolveOutcome<{ memories: unknown[] }>> {
      const result = await guarded.commit([evidenceOperation(input)]);
      if (!result.ok) {
        const errors = (result.errors ?? []) as EvolveIssue[];
        const issues = errors.filter((one): one is EvolveIssue => typeof one?.code === 'string' && one.code.startsWith('TEVO'));
        return refuse<{ memories: unknown[] }>(issues.length > 0
          ? issues
          : [evolveIssue('TEVO1011', '/commit', 'The ledger refused the refinement.', {
            code: 'LEDGER_CONFLICT',
            docPath: '',
            message: JSON.stringify(errors.length > 0 ? errors[0] : (result.cause ?? 'refused')),
          })]);
      }
      const value = result.value as { error?: string } | unknown[];
      if (!Array.isArray(value)) {
        // The ledger answers a rejection as a value rather than a throw; it
        // is carried rather than restated, so the reason survives.
        return refuse<{ memories: unknown[] }>([evolveIssue('TEVO1011', '/commit',
          'The ledger refused the refinement.', {
            code: 'LEDGER_CONFLICT', docPath: '', message: String((value as { error?: string })?.error ?? 'refused'),
          })]);
      }
      return ok({ memories: value });
    },
  };
}
