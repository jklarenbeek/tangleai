/** Constrain one file's generation, then apply the full grammar/compiler.
 * This helper returns a candidate; the host owns conflict-safe publication. */
import { createStructuredOutput } from '@tangleai/models';
import { validateFile } from '@jarenjs/studio';
import { resolveProjectFile } from '@jarenjs/studio';
import app from '@jarenjs/app/schemas/jaren-app.authoring.schema.json' with { type: 'json' };
import query from '@jarenjs/json/schemas/jaren-query.authoring.schema.json' with { type: 'json' };
import jslt from '@jarenjs/json/schemas/jaren-jslt.authoring.schema.json' with { type: 'json' };
import fsm from '@jarenjs/flow/schemas/jaren-fsm.authoring.schema.json' with { type: 'json' };
import dag from '@jarenjs/flow/schemas/jaren-dag.authoring.schema.json' with { type: 'json' };
import model from '@jarenjs/db/schemas/jaren-model.authoring.schema.json' with { type: 'json' };

export const AUTHORABLE_KINDS = Object.freeze(['app', 'query', 'jslt', 'fsm', 'dag', 'model', 'schema', 'state', 'data', 'contract']);
const PROFILES = {
  app, query, jslt, fsm, dag, model,
  schema: { anyOf: [{ type: 'object' }, { type: 'boolean' }] },
  state: {}, data: {}, contract: { type: 'object' },
};

/** @param options */
export function createStudioFileAuthor(options: {
  client: any;
  operators?: any;
  maxRepairs?: number;
}) {
  return {
    /** @param request
     * @param [hooks] */
    async author(request: {
      project: any;
      name: string;
      kind?: string;
      prompt: string;
    }, hooks: {
      signal?: AbortSignal;
    } = {}) {
      const original = request.project.files.find((f: any) => f.name === request.name);
      const kind = request.kind ?? original?.kind;
      if (!AUTHORABLE_KINDS.includes(kind)) throw new TypeError('choose an authorable file kind');
      // Imported destinations are authored as fragments, never expanded into
      // duplicated members. Their assembled artifact is the acceptance gate.
      const profile = original?.imports ? { type: 'object' } : PROFILES[kind as keyof typeof PROFILES];
      const check = (doc: any) => {
        try {
          const file = { ...original, name: request.name, kind, text: JSON.stringify(doc) };
          const project = { files: [...request.project.files.filter((f: any) => f.name !== file.name), file] };
          const assembled = resolveProjectFile(project, file.name).doc;
          const verdict = validateFile({ ...file, text: JSON.stringify(assembled) }, { operators: options.operators });
          if (!verdict.valid) return verdict;
          return true;
        }
        catch (error: any) {
          return {
            valid: false as const, errors: [{
              code: error.code ?? null,
              docPath: error.docPath ?? '', message: error.reason ?? error.message
            }]
          };
        }
      };
      const generator = createStructuredOutput({
        client: options.client, schema: profile,
        name: `studio_${kind}`, strict: false, validator: check, maxRepairs: options.maxRepairs ?? 2
      });
      const result = await generator.generate([
        { role: 'system', content: `Author exactly one ${kind} file named ${request.name}. Return its JSON value only. Do not return a project envelope. Files available: ${JSON.stringify(request.project.files.map((f: any) => ({ name: f.name, kind: f.kind })))}.${original?.imports ? ` Imported members are supplied by ${JSON.stringify(original.imports)}; omit these members from your output.` : ''}` },
        ...(original ? [{ role: 'user', content: `Current file:\n${original.text}` }] : []),
        { role: 'user', content: request.prompt },
      ], hooks);
      if (!('value' in result)) return result;
      return { ...result, file: { ...original, name: request.name, kind, text: JSON.stringify(result.value, null, 2) } };
    },
  };
}
