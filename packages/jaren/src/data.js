//@ts-check
/** Thin model/query authoring over the shared Data contract. Accepting a model
 * changes an editor buffer only. Opening/recreating a store is always explicit. */
import { createStructuredOutput } from '@tangleai/models';
import query from '@jarenjs/json/schemas/jaren-query.authoring.schema.json' with { type: 'json' };
import model from '@jarenjs/db/schemas/jaren-model.authoring.schema.json' with { type: 'json' };
/** @typedef {{ ok: true, candidate: {model: any, query: any}, expectedRevision: string, attempts: number }|{ ok: false, error?: string, errors?: any[], candidate?: {model: any, query: any}, expectedRevision?: string, attempts?: number }} DataProposal */
/** @typedef {Pick<ReturnType<typeof import('@jarenjs/studio/data').mountDataEditor>, 'read'|'validate'|'replace'|'apply'|'run'>} DataEditor */
/** @param {{ editor: DataEditor, client?: any, maxRepairs?: number }} options
 * @returns {{ read: DataEditor['read'], validate: DataEditor['validate'], write: DataEditor['replace'], apply: DataEditor['apply'], run: DataEditor['run'],
 * propose: (request: { member: 'model'|'query', prompt: string }, hooks?: { signal?: AbortSignal }) => Promise<DataProposal>,
 * accept: (proposal: { candidate: { model: any, query: any }, expectedRevision: string }) => Promise<Awaited<ReturnType<DataEditor['replace']>> & { candidate: { model: any, query: any } }>,
 * inspect: () => Pick<ReturnType<DataEditor['read']>, 'result'|'explain'|'revision'> }} */
export function createDataAdapter(options) {
  const { editor } = options;
  /** @param {{ member: 'model'|'query', prompt: string }} request @param {{ signal?: AbortSignal }} [hooks] */
  async function propose(request, hooks = {}) {
    if (!['model', 'query'].includes(request.member)) return { ok: false, error: 'Choose model or query.' };
    const before = editor.read(), member = request.member;
    const candidateFor = value => ({ ...before.document, [member]: value });
    const generator = createStructuredOutput({ client: options.client, schema: member === 'model' ? model : query,
      name: `studio_${member}`, strict: false, maxRepairs: options.maxRepairs ?? 2,
      validator: value => editor.validate(candidateFor(value)) });
    const result = await generator.generate([
      { role: 'system', content: `Author one ${member} document. Return its JSON value only. Proposals do not execute queries or migrate the store.` },
      { role: 'user', content: `Current model and query:\n${JSON.stringify(before.document)}` },
      { role: 'user', content: request.prompt },
    ], hooks);
    return 'value' in result ? { ...result, ok: true, candidate: candidateFor(result.value), expectedRevision: before.revision }
      : { ...result, ok: false };
  }
  /** @param {{ candidate: { model: any, query: any }, expectedRevision: string }} proposal */
  async function accept(proposal) {
    return { ...await editor.replace(proposal.candidate, proposal), candidate: proposal.candidate };
  }
  /** Inspect the last actual contract result and plan; never execute implicitly. */
  function inspect() { const { result, explain, revision } = editor.read(); return { result, explain, revision }; }
  return { read: editor.read, validate: editor.validate, write: editor.replace, apply: editor.apply,
    run: editor.run, propose, accept, inspect };
}
