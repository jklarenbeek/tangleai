/** Model proposals use the same full compiler gate and publication path as Flow. */
import { createStructuredOutput } from '@tangleai/models';
import fsm from '@jarenjs/flow/schemas/jaren-fsm.authoring.schema.json' with { type: 'json' };
import dag from '@jarenjs/flow/schemas/jaren-dag.authoring.schema.json' with { type: 'json' };

/** @param options
 * @returns */
export function createFlowAdapter(options: {
  editor: FlowEditor;
  client?: any;
  maxRepairs?: number;
  templates?: Record<string, {
    kind: 'fsm' | 'dag';
    document: any;
  }>;
}): {
  read: FlowEditor['read'];
  validate: FlowEditor['validate'];
  write: FlowEditor['replace'];
  apply: FlowEditor['apply'];
  run: FlowEditor['run'];
  propose: (request: {
    kind?: 'fsm' | 'dag';
    prompt: string;
  }, hooks?: {
    signal?: AbortSignal;
  }) => Promise<FlowProposal>;
  accept: (proposal: {
    candidate: any;
    expectedRevision: string;
    kind: 'fsm' | 'dag';
  }) => Promise<Awaited<ReturnType<FlowEditor['replace']>> & {
    candidate: any;
  }>;
  template: (name: string, revision: {
    expectedRevision: string;
  }) => ReturnType<FlowEditor['replace']>;
} {
  const { editor } = options;
  /** @param request @param [hooks] */
  async function propose(request: {
    kind?: 'fsm' | 'dag';
    prompt: string;
  }, hooks: {
    signal?: AbortSignal;
  } = {}): Promise<FlowProposal> {
    const before = editor.read(), kind = request.kind ?? before.kind;
    if (kind !== 'fsm' && kind !== 'dag') return { ok: false as const, error: 'Choose fsm or dag.' };
    const generator = createStructuredOutput({
      client: options.client, schema: kind === 'fsm' ? fsm : dag,
      name: `studio_${kind}`, strict: false, maxRepairs: options.maxRepairs ?? 2,
      validator: (document: any) => editor.validate(document, kind)
    });
    const result = await generator.generate([
      { role: 'system', content: `Author one ${kind} document. Return its JSON value only.` },
      ...(before.document === null ? [] : [{ role: 'user', content: `Current document:\n${JSON.stringify(before.document)}` }]),
      { role: 'user', content: request.prompt },
    ], hooks);
    return 'value' in result ? { ...result, ok: true as const, candidate: result.value, kind, expectedRevision: before.revision }
      : { ...result, ok: false as const };
  }
  /** @param proposal */
  async function accept(proposal: {
    candidate: any;
    kind: 'fsm' | 'dag';
    expectedRevision: string;
  }) {
    return { ...await editor.replace(proposal.candidate, proposal), candidate: proposal.candidate };
  }
  /** @param name @param revision */
  function template(name: string, revision: {
    expectedRevision: string;
  }) {
    const candidate = options.templates?.[name];
    return candidate === undefined ? Promise.resolve({ ok: false as const, error: `Unknown Flow template '${name}'.` })
      : editor.replace(structuredClone(candidate.document), { ...revision, kind: candidate.kind });
  }
  return {
    read: editor.read, validate: editor.validate, write: editor.replace, apply: editor.apply,
    run: editor.run, propose, accept, template
  };
}

export type FlowProposal = { ok: true, candidate: any, expectedRevision: string, attempts: number, kind: 'fsm' | 'dag'; } | { ok: false, error?: string, errors?: any[], candidate?: any, expectedRevision?: string, attempts?: number; };
export type FlowEditor = Pick<ReturnType<typeof import('@jarenjs/studio/flow').mountFlowEditor>, 'read' | 'validate' | 'replace' | 'apply' | 'run'>;
