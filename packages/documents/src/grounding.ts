import { createStructuredOutput } from '@tangleai/models/structured';
import { validateClaimEvidence } from '@tangleai/context/evidence';

/**
 * The measured grounded-answer contract — the one schema the benchmark
 * scored and configured chat now generates under. An answer is either
 * claims-with-citations or an explicit abstention; there is no
 * free-prose member a material claim can hide in, because the visible
 * answer is DERIVED from the claim texts (or the abstention reason) by
 * `renderGroundedAnswer`.
 */
export const GROUNDED_ANSWER_SCHEMA = {
  $id: 'https://tangleai.dev/schemas/grounding-answer',
  oneOf: [
    {
      type: 'object',
      required: ['disposition', 'claims'],
      additionalProperties: false,
      properties: {
        disposition: { const: 'answer' },
        claims: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['id', 'text', 'citations'],
            additionalProperties: false,
            properties: {
              id: { type: 'string', minLength: 1, description: 'A reply-local claim id, unique within this answer.' },
              text: { type: 'string', minLength: 1, description: 'One factual proposition, complete on its own.' },
              citations: { type: 'array', items: { type: 'string', minLength: 1 }, description: 'The evidence ids this claim was read from — only ids listed in the prompt.' },
            },
          },
        },
      },
    },
    {
      type: 'object',
      required: ['disposition', 'reason', 'claims'],
      additionalProperties: false,
      properties: {
        disposition: { const: 'abstain' },
        reason: { type: 'string', minLength: 1, description: 'Why the supplied evidence cannot answer the question.' },
        claims: { type: 'array', maxItems: 0 },
      },
    },
  ],
} as const;

export interface GroundedClaim {
  id: string;
  text: string;
  citations: string[];
}

export type GroundedAnswer =
  | { disposition: 'answer', claims: GroundedClaim[] }
  | { disposition: 'abstain', reason: string, claims: [] };

/** The visible answer, derived from the ledger — never free prose. */
export function renderGroundedAnswer(answer: GroundedAnswer): string {
  if (answer.disposition === 'abstain') return answer.reason;
  return answer.claims.map((claim) => claim.text).join('; ');
}

/**
 * The supplied-reference gate: every cited id must be one the request
 * actually serialized, and reply-local claim ids must be unique. Its
 * pointered errors go back through the suite's one bounded repair, so a
 * fabricated id is corrected instead of surfacing. This proves
 * answer-declared USE plus reference integrity — semantic support needs
 * a domain oracle the runtime does not have, and no claim of it is made.
 */
export function suppliedReferenceGate(listed: ReadonlySet<string>): (value: unknown) => true | { valid: false, errors: Array<{ instancePath: string, keyword: string, message: string }> } {
  const artifacts = [...listed].map((id) => ({ id, kind: 'prompt-evidence' }));
  const evidence = [...listed].map((id) => ({ id, artifact: id }));
  return (value) => {
    const answer = value as GroundedAnswer;
    if (answer.disposition !== 'answer') return true;
    // Keep the measured answer schema and its allowance for uncited claims.
    // Jaren owns referential integrity; Tangle's scorer owns semantic support.
    const outcome = validateClaimEvidence({
      version: 1, artifacts, evidence, visibleEvidence: [...listed],
      claims: answer.claims.map((claim) => ({
        id: claim.id, text: claim.text, critical: false,
        status: claim.citations.length === 0 ? 'unresolved' : 'supported',
        evidence: [...new Set(claim.citations)],
      })),
    }, { artifacts });
    const errors = outcome.errors.map((error: { instancePath?: string, code?: string, message: string }) => {
      const path = error.instancePath ?? '';
      const reference = /^\/claims\/(\d+)\/evidence\/(\d+)$/.exec(path);
      let instancePath = path;
      if (reference !== null) {
        const claim = answer.claims[Number(reference[1])];
        const id = [...new Set(claim.citations)][Number(reference[2])];
        instancePath = `/claims/${reference[1]}/citations/${claim.citations.indexOf(id)}`;
      }
      return { instancePath, keyword: error.code === 'EVIDENCE_DUPLICATE' ? 'duplicate-claim-id' : 'unknown-citation', message: error.message };
    });
    return errors.length === 0 ? true : { valid: false, errors };
  };
}

export interface GroundedGenerationOutcome {
  /** The validated answer, or null when generation stayed invalid after repair. */
  answer: GroundedAnswer | null;
  /** Why there is no answer, when there is none. */
  failure: { kind: 'invalid' | 'wire', detail: string } | null;
  /** Provider-reported usage of the last completed call, verbatim. */
  usage: unknown;
  attempts: number;
}

/**
 * Generate one grounded answer through the suite's structured output —
 * the schema above, one bounded repair, and the supplied-reference gate
 * over exactly the ids this request serialized. The app owns no parser,
 * repair loop or provider response mode; a wire failure and a
 * permanently invalid reply are values the caller degrades on.
 *
 * `hooks` carries the run's cancellation signal and, when a subscriber
 * is watching, a delta consumer. Deltas are provisional raw model text —
 * the validated answer is the only thing anyone renders as the reply.
 */
export async function generateGroundedAnswer(
  client: { endpoint: { provider: string }, complete: (request: any) => Promise<any> },
  messages: Array<{ role: string, content: string }>,
  listedIds: ReadonlySet<string>,
  hooks: { signal?: AbortSignal, onDelta?: (text: string) => void } = {},
): Promise<GroundedGenerationOutcome> {
  let usage: unknown = null;
  const observed = {
    endpoint: client.endpoint,
    async complete(request: any) {
      const result = await client.complete({ ...request, signal: hooks.signal, onDelta: hooks.onDelta }) as { usage?: unknown };
      usage = result.usage ?? null;
      return result;
    },
  };
  const generator = createStructuredOutput({
    client: observed,
    schema: GROUNDED_ANSWER_SCHEMA,
    name: 'grounding_answer',
    maxRepairs: 1,
    gate: suppliedReferenceGate(listedIds),
    // streaming is opt-in in the suite because it changes what a caller
    // with a delta consumer observes; the desktop asks for it exactly
    // when a run is watching the generation, never otherwise
    stream: hooks.onDelta !== undefined,
  });
  try {
    const reply = await generator.generate(messages, { signal: hooks.signal }) as
      | { value: GroundedAnswer, attempts: number }
      | { errors: unknown[], raw: string, attempts: number };
    if ('value' in reply) return { answer: reply.value, failure: null, usage, attempts: reply.attempts };
    return {
      answer: null,
      failure: { kind: 'invalid', detail: `the reply failed the answer contract after repair (${reply.errors.length} error(s))` },
      usage,
      attempts: reply.attempts,
    };
  } catch (error) {
    return {
      answer: null,
      failure: { kind: 'wire', detail: error instanceof Error ? error.message : String(error) },
      usage,
      attempts: 0,
    };
  }
}
