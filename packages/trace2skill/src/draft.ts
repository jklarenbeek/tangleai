/**
 * The trajectory-blind starting directory that creation mode begins from.
 *
 * Creation has no human directory to deepen, so one is drafted from the scope
 * alone — its description, the tool names an executor will have, the format
 * profile and optional reference text that belongs to no task. The signature
 * is the guarantee: there is no parameter through which a task, an input path
 * or a registered answer could reach the draft, so the directory it produces
 * cannot have been fitted to either half of the split. The draft is then
 * measured as a starting directory in its own right, before any
 * trajectory-grounded edit, because a creation result that never states what
 * the draft alone scored is not a comparison.
 */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import { createStructuredOutput } from '@tangleai/models/structured';
import { importBundle, type SkillFileDraft, type SkillSnapshot } from './bundle.ts';
import { trace2SkillIssue, trace2SkillRefusal, type Trace2SkillOutcome } from './errors.ts';
import { MINIMAL_SKILL_PROFILE, validateFormat, type SkillFormatProfile } from './format.ts';
import { skillMediaType } from './bundle.ts';
import { DRAFT_SKILL_SCHEMA } from './schemas/draft.ts';
import { trace2SkillPrompt } from './artifacts.ts';
import { renderTrace2SkillPrompt } from './prompts.ts';
import type { SkillChatClient } from './executor.ts';
import type { Trace2SkillIssue, Trace2SkillPromptArtifact } from './contracts.gen.ts';

export { DRAFT_SKILL_SCHEMA };

/** The compiled draft pack's revision, which is the prompt version a creation run records. */
export const DRAFT_PROMPT_VERSION = trace2SkillPrompt('draft').revision;

/** The scope a draft is allowed to see. There is no member a task could arrive through. */
export interface SkillScope {
  scopeKey: string;
  description: string;
  tools: ReadonlyArray<{ name: string, description: string }>;
  answerShape: string;
  /** Domain reference text that belongs to no task instance. */
  reference?: string;
}

export interface DraftedSkill {
  snapshot: SkillSnapshot;
  /** The exact text the request carried, so a test can prove what the draft could see. */
  requestText: string;
  requestDigest: string;
  attempts: number;
  raw: string;
}

export interface DraftS0Options {
  profile?: SkillFormatProfile;
  maxRepairs?: number;
  /** The compiled pack this request renders through; the default is the published one. */
  prompt?: Trace2SkillPromptArtifact;
  promptVersion?: string;
}

/** The scope, rendered once, so the request text and its digest describe the same bytes. */
export function renderSkillScope(scope: SkillScope): string {
  return [
    `Domain: ${scope.scopeKey}`,
    `What the work is: ${scope.description}`,
    `What an answer looks like: ${scope.answerShape}`,
    'Tools an executor will have:',
    ...scope.tools.map(tool => `- ${tool.name}: ${tool.description}`),
    ...(scope.reference === undefined ? [] : ['', 'Domain reference:', scope.reference]),
  ].join('\n');
}

/** Drafts as the format validator reads them, before anything is hashed. */
function draftsOfAuthored(files: ReadonlyArray<{ path: string, content: string }>): SkillFileDraft[] {
  return files.map(file => ({
    path: file.path, mediaType: skillMediaType(file.path, 'utf-8'), encoding: 'utf-8' as const,
    executable: false, content: file.content, address: null, sha256: null, size: null,
  }));
}

/**
 * One structured call, gated by the format validator so a directory that does
 * not hold together never becomes a bundle.
 */
export async function draftS0(
  client: SkillChatClient & { endpoint: { provider: string } },
  scope: SkillScope,
  options: DraftS0Options = {},
): Promise<Trace2SkillOutcome<DraftedSkill>> {
  const profile = options.profile ?? MINIMAL_SKILL_PROFILE;
  const rendered = renderTrace2SkillPrompt(options.prompt ?? trace2SkillPrompt('draft'), { scope: renderSkillScope(scope) });
  if (!rendered.valid) return trace2SkillRefusal<DraftedSkill>(rendered.issues);
  const messages = [
    { role: 'system', content: rendered.value.system },
    { role: 'user', content: rendered.value.user },
  ];
  const author = createStructuredOutput({
    client,
    schema: DRAFT_SKILL_SCHEMA,
    name: 'skill_directory',
    maxRepairs: options.maxRepairs ?? 1,
    // Synchronous by construction: the same validator a stored directory is
    // sealed against, so a repair round is told exactly what a store would say.
    gate: (value: unknown) => {
      const files = (value as { files?: Array<{ path: string, content: string }> }).files ?? [];
      const format = validateFormat(draftsOfAuthored(files), profile);
      return format.valid
        ? true
        : { valid: false, errors: format.issues.map(issue => ({ instancePath: issue.path, keyword: issue.code, message: issue.detail })) };
    },
  });

  const requestText = messages.map(message => message.content).join('\n\n');
  const requestDigest = await canonicalSha256(messages);
  const generated = await author.generate(messages);
  if (generated.value === undefined) {
    const issues: Trace2SkillIssue[] = (generated.errors ?? []).slice(0, 6).map((error: { instancePath?: unknown, message?: unknown }) =>
      trace2SkillIssue('TT2S1005', typeof error.instancePath === 'string' && error.instancePath !== '' ? error.instancePath : '/files',
        typeof error.message === 'string' ? error.message : 'the drafted directory does not validate'));
    return trace2SkillRefusal<DraftedSkill>(issues.length ? issues
      : [trace2SkillIssue('TT2S1005', '/files', 'the draft produced no directory')]);
  }

  const authored = (generated.value as { files: Array<{ path: string, content: string }> }).files;
  const encoder = new TextEncoder();
  const imported = await importBundle(
    authored.map(file => ({ path: file.path, bytes: encoder.encode(file.content) })),
    { scopeKey: scope.scopeKey, mode: 'creation', origin: 'parametric-draft', parentId: null, profile },
  );
  if (!imported.valid) return trace2SkillRefusal<DraftedSkill>(imported.issues);
  return { valid: true, value: { snapshot: imported.value, requestText, requestDigest, attempts: generated.attempts, raw: generated.raw } };
}
