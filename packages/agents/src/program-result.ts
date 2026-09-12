/** Public program results and bounded access to their stored answers. */

/**
 * Read a complete answer through the owning environment's scoped ledger.
 * Check metadata before loading content, then check its actual length as well.
 * A missing, resized or oversized slot is a refusal, never a parsed preview.
 */
export async function readProgramAnswer(environment: {
  ledger: {
    getSlot: (name: string) => Promise<{
      size: number;
    } | null>;
    readSlot: (name: string) => Promise<unknown>;
  };
}, answer: ProgramAnswer, options: {
  maxChars: number;
}): Promise<{
  ok: true;
  answer: ProgramAnswer;
} | {
  ok: false;
  error: string;
}> {
  const maxChars = options.maxChars;
  if (!Number.isSafeInteger(maxChars) || maxChars < 1)
    throw new RangeError('maxChars must be a positive safe integer');
  if (!answer || typeof answer.slot !== 'string' || !Number.isSafeInteger(answer.size) || answer.size < 0)
    return { ok: false as const, error: 'the program answer has invalid slot metadata' };
  if (answer.size > maxChars)
    return { ok: false as const, error: `the program answer exceeds the ${maxChars} character limit` };
  const slot = await environment.ledger.getSlot(answer.slot);
  if (slot === null) return { ok: false as const, error: `no answer slot '${answer.slot}'` };
  if (slot.size !== answer.size)
    return { ok: false as const, error: `answer slot '${answer.slot}' changed size since the program ran` };
  const raw = await environment.ledger.readSlot(answer.slot);
  if (typeof raw !== 'string' || raw.length !== answer.size || raw.length > maxChars)
    return { ok: false as const, error: `answer slot '${answer.slot}' no longer matches its bounded size` };
  return { ok: true as const, answer: { slot: answer.slot, size: raw.length, text: raw, truncated: false } };
}

export type ProgramAnswer = { slot: string, size: number, text: string, truncated: boolean; };
export type ProgramDiagnostic = { code: string, docPath: string, message: string; };
export type ProgramStepReport = (
  { op: 'chunk', as: string, count: number, family: string; } |
  { op: 'grep', as: string, total: number, slots: number, size: number; } |
  { op: 'select', as: string, size: number, count?: number; } |
  { op: 'stat' | 'peek', as: string, size: number; } |
  {
    op: 'map', as: string, subcalls: number, failed: number, concurrency: number,
    skipped?: number, note?: string, stopped?: string
   } |
  { op: 'reduce', as: string, over: number, size: number; }
);
export type ProgramRunMetrics = {
  ran: number, steps: ProgramStepReport[], subcalls: number,
  failed: number, concurrency: number, ms: number
 };
export type ProgramRunResult = ProgramRunMetrics & (
  { ok: true, answer: ProgramAnswer, error?: never, errors?: never, stopped?: never; } |
  { ok: false, answer: null, error: string, errors?: ProgramDiagnostic[], stopped?: string; }
);
