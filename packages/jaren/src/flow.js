//@ts-check
/** Model proposals use the same full compiler gate and publication path as Flow. */
import { createStructuredOutput } from '@tangleai/models';
import fsm from '@jarenjs/flow/schemas/jaren-fsm.authoring.schema.json' with { type: 'json' };
import dag from '@jarenjs/flow/schemas/jaren-dag.authoring.schema.json' with { type: 'json' };
/** @typedef {{ ok: true, candidate: any, expectedRevision: string, attempts: number, kind: 'fsm'|'dag' }|{ ok: false, error?: string, errors?: any[], candidate?: any, expectedRevision?: string, attempts?: number }} FlowProposal */
/** @typedef {Pick<ReturnType<typeof import('@jarenjs/studio/flow').mountFlowEditor>, 'read'|'validate'|'replace'|'apply'|'run'>} FlowEditor */
/** @param {{ editor: FlowEditor, client?: any, maxRepairs?: number,
 * templates?: Record<string, { kind: 'fsm'|'dag', document: any }> }} options
 * @returns {{ read: FlowEditor['read'], validate: FlowEditor['validate'], write: FlowEditor['replace'], apply: FlowEditor['apply'], run: FlowEditor['run'],
 * propose: (request: { kind?: 'fsm'|'dag', prompt: string }, hooks?: { signal?: AbortSignal }) => Promise<FlowProposal>,
 * accept: (proposal: { candidate: any, expectedRevision: string, kind: 'fsm'|'dag' }) => Promise<Awaited<ReturnType<FlowEditor['replace']>> & { candidate: any }>,
 * template: (name: string, revision: { expectedRevision: string }) => ReturnType<FlowEditor['replace']> }} */
export function createFlowAdapter(options) {
  const { editor } = options;
  /** @param {{ kind?: 'fsm'|'dag', prompt: string }} request @param {{ signal?: AbortSignal }} [hooks] */
  async function propose(request, hooks = {}) {
    const before = editor.read(), kind = request.kind ?? before.kind;
    if (kind !== 'fsm' && kind !== 'dag') return { ok: false, error: 'Choose fsm or dag.' };
    const generator = createStructuredOutput({ client: options.client, schema: kind === 'fsm' ? fsm : dag,
      name: `studio_${kind}`, strict: false, maxRepairs: options.maxRepairs ?? 2,
      validator: document => editor.validate(document, kind) });
    const result = await generator.generate([
      { role: 'system', content: `Author one ${kind} document. Return its JSON value only.` },
      ...(before.document === null ? [] : [{ role: 'user', content: `Current document:\n${JSON.stringify(before.document)}` }]),
      { role: 'user', content: request.prompt },
    ], hooks);
    return 'value' in result ? { ...result, ok: true, candidate: result.value, kind, expectedRevision: before.revision }
      : { ...result, ok: false };
  }
  /** @param {{ candidate: any, kind: 'fsm'|'dag', expectedRevision: string }} proposal */
  async function accept(proposal) {
    return { ...await editor.replace(proposal.candidate, proposal), candidate: proposal.candidate };
  }
  /** @param {string} name @param {{ expectedRevision: string }} revision */
  function template(name, revision) {
    const candidate = options.templates?.[name];
    return candidate === undefined ? Promise.resolve({ ok: false, error: `Unknown Flow template '${name}'.` })
      : editor.replace(structuredClone(candidate.document), { ...revision, kind: candidate.kind });
  }
  return { read: editor.read, validate: editor.validate, write: editor.replace, apply: editor.apply,
    run: editor.run, propose, accept, template };
}
