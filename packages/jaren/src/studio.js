//@ts-check
/** AI file proposals over the public, revision-checked Studio editor. */
import { resolveProjectFile, writeProjectArtifact } from '@jarenjs/studio';
import { applyJSONPatch } from '@jarenjs/json/patch';
import { createStudioFileAuthor } from './studio-file.js';
export { createStudioFileAuthor, AUTHORABLE_KINDS } from './studio-file.js';
/** @typedef {{ ok: true, candidate: any, expectedRevision: string, attempts: number, file: { name: string, kind: string, text: string } }|{ ok: false, error?: string, errors?: any[], candidate?: any, expectedRevision?: string, attempts?: number }} StudioProposal */
/** @typedef {Pick<ReturnType<typeof import('@jarenjs/studio/component').mountStudioEditor>, 'read'|'validate'|'replace'|'apply'|'run'>} StudioEditor */
/** @param {{ editor: StudioEditor, client?: any, operators?: any, maxRepairs?: number,
 * templates?: Record<string, any> }} options
 * @returns {{ read: StudioEditor['read'], validate: StudioEditor['validate'], apply: StudioEditor['apply'], run: StudioEditor['run'],
 * propose: (request: { name: string, kind?: string, prompt: string }, hooks?: { signal?: AbortSignal }) => Promise<StudioProposal>,
 * accept: (proposal: { candidate: any, expectedRevision: string }) => Promise<Awaited<ReturnType<StudioEditor['replace']>> & { candidate: any }>,
 * write: (request: { name: string, kind?: string, text: string, expectedRevision: string }) => ReturnType<StudioEditor['replace']>,
 * patchFile: (name: string, patch: Parameters<typeof applyJSONPatch>[1], revision: { expectedRevision: string }) => ReturnType<StudioEditor['replace']>,
 * template: (name: string, revision: { expectedRevision: string }) => ReturnType<StudioEditor['replace']> }} */
export function createStudioAdapter(options) {
  const { editor } = options;
  const candidateFor = (project, file) => ({ ...project, active: file.name,
    files: project.files.some(f => f.name === file.name)
      ? project.files.map(f => f.name === file.name ? file : f) : [...project.files, file] });
  /** Generate without publishing. The entire project revision protects imports too.
   * @param {{ name: string, kind?: string, prompt: string }} request
   * @param {{ signal?: AbortSignal }} [hooks] */
  async function propose(request, hooks = {}) {
    const before = editor.read();
    const result = await createStudioFileAuthor(options).author({ ...request, project: before.document }, hooks);
    if (!('file' in result)) return { ok: false, ...result };
    const candidate = candidateFor(before.document, result.file);
    const checked = editor.validate(candidate);
    return { ...result, ...checked, ok: checked.valid, candidate, expectedRevision: before.revision };
  }
  /** @param {{ candidate: any, expectedRevision: string }} proposal */
  async function accept(proposal) {
    const result = await editor.replace(proposal.candidate, { expectedRevision: proposal.expectedRevision });
    return { ...result, candidate: proposal.candidate };
  }
  /** @param {{ name: string, kind?: string, text: string, expectedRevision: string }} request */
  function write(request) {
    const before = editor.read(), previous = before.document.files.find(f => f.name === request.name);
    const file = { ...previous, name: request.name, kind: request.kind ?? previous?.kind, text: request.text };
    return editor.replace(candidateFor(before.document, file), { expectedRevision: request.expectedRevision });
  }
  /** Patch an assembled artifact through Jaren's import-preserving inverse write.
   * @param {string} name @param {Parameters<typeof applyJSONPatch>[1]} patch
   * @param {{ expectedRevision: string }} revision */
  function patchFile(name, patch, revision) {
    try {
      const before = editor.read(), doc = resolveProjectFile(before.document, name).doc;
      const files = writeProjectArtifact(before.document, name, applyJSONPatch(doc, patch));
      return editor.replace({ ...before.document, files, active: name }, revision);
    }
    catch (error) { return Promise.resolve({ ok: false, error: error.message, code: error.code }); }
  }
  /** @param {string} name @param {{ expectedRevision: string }} revision */
  function template(name, revision) {
    const candidate = options.templates?.[name];
    return candidate === undefined ? Promise.resolve({ ok: false, error: `Unknown project template '${name}'.` })
      : editor.replace(structuredClone(candidate), revision);
  }
  return { read: editor.read, validate: editor.validate, propose, accept, write, patchFile,
    apply: editor.apply, run: editor.run, template };
}
