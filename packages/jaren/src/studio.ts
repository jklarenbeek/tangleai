/** AI file proposals over the public, revision-checked Studio editor. */
import { resolveProjectFile, writeProjectArtifact } from '@jarenjs/studio';
import { applyJSONPatch } from '@jarenjs/json/patch';
import { createStudioFileAuthor } from './studio-file.ts';
export { createStudioFileAuthor, AUTHORABLE_KINDS } from './studio-file.ts';

/** @param options
 * @returns */
export function createStudioAdapter(options: {
  editor: StudioEditor;
  client?: any;
  operators?: any;
  maxRepairs?: number;
  templates?: Record<string, any>;
}): {
  read: StudioEditor['read'];
  validate: StudioEditor['validate'];
  apply: StudioEditor['apply'];
  run: StudioEditor['run'];
  propose: (request: {
    name: string;
    kind?: string;
    prompt: string;
  }, hooks?: {
    signal?: AbortSignal;
  }) => Promise<StudioProposal>;
  accept: (proposal: {
    candidate: any;
    expectedRevision: string;
  }) => Promise<Awaited<ReturnType<StudioEditor['replace']>> & {
    candidate: any;
  }>;
  write: (request: {
    name: string;
    kind?: string;
    text: string;
    expectedRevision: string;
  }) => ReturnType<StudioEditor['replace']>;
  patchFile: (name: string, patch: Parameters<typeof applyJSONPatch>[1], revision: {
    expectedRevision: string;
  }) => ReturnType<StudioEditor['replace']>;
  template: (name: string, revision: {
    expectedRevision: string;
  }) => ReturnType<StudioEditor['replace']>;
} {
  const { editor } = options;
  const candidateFor = (project: any, file: any) => ({
    ...project, active: file.name,
    files: project.files.some((f: any) => f.name === file.name)
      ? project.files.map((f: any) => f.name === file.name ? file : f) : [...project.files, file]
  });
  /** Generate without publishing. The entire project revision protects imports too.
   * @param [hooks] */
  async function propose(request: {
    name: string;
    kind?: string;
    prompt: string;
  }, hooks: {
    signal?: AbortSignal;
  } = {}): Promise<StudioProposal> {
    const before = editor.read();
    const result = await createStudioFileAuthor({ ...options, client: options.client }).author({ ...request, project: before.document }, hooks);
    if (!('file' in result)) return { ok: false as const, ...result };
    const candidate = candidateFor(before.document, result.file);
    const checked = editor.validate(candidate);
    return { ...result, ...checked, ok: checked.valid, candidate, expectedRevision: before.revision };
  }
  /** @param proposal */
  async function accept(proposal: {
    candidate: any;
    expectedRevision: string;
  }) {
    const result = await editor.replace(proposal.candidate, { expectedRevision: proposal.expectedRevision });
    return { ...result, candidate: proposal.candidate };
  }
  /** @param request */
  function write(request: {
    name: string;
    kind?: string;
    text: string;
    expectedRevision: string;
  }) {
    const before = editor.read(), previous = before.document.files.find((f: any) => f.name === request.name);
    const file = { ...previous, name: request.name, kind: request.kind ?? previous?.kind, text: request.text };
    return editor.replace(candidateFor(before.document, file), { expectedRevision: request.expectedRevision });
  }
  /** Patch an assembled artifact through Jaren's import-preserving inverse write.
   * @param name @param patch
   * @param revision */
  function patchFile(name: string, patch: Parameters<typeof applyJSONPatch>[1], revision: {
    expectedRevision: string;
  }) {
    try {
      const before = editor.read(), doc = resolveProjectFile(before.document, name).doc;
      const files = writeProjectArtifact(before.document, name, applyJSONPatch(doc, patch));
      return editor.replace({ ...before.document, files, active: name }, revision);
    }
    catch (error: any) { return Promise.resolve({ ok: false as const, error: error.message, code: error.code }); }
  }
  /** @param name @param revision */
  function template(name: string, revision: {
    expectedRevision: string;
  }) {
    const candidate = options.templates?.[name];
    return candidate === undefined ? Promise.resolve({ ok: false as const, error: `Unknown project template '${name}'.` })
      : editor.replace(structuredClone(candidate), revision);
  }
  return {
    read: editor.read, validate: editor.validate, propose, accept, write, patchFile,
    apply: editor.apply, run: editor.run, template
  };
}

export type StudioProposal = { ok: true, candidate: any, expectedRevision: string, attempts: number, file: { name: string, kind: string, text: string; }; } | { ok: false, error?: string, errors?: any[], candidate?: any, expectedRevision?: string, attempts?: number; };
export type StudioEditor = Pick<ReturnType<typeof import('@jarenjs/studio/component').mountStudioEditor>, 'read' | 'validate' | 'replace' | 'apply' | 'run'>;
