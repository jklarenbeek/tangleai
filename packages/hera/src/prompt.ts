/** Evolving blocks remain outside the compiled role and its immutable tool envelope. */
import type { GmplPromptArtifact } from '@tangleai/gmpl';
import { heraRefuse, type HeraOutcome } from './errors.ts';
import { heraRevisionOf, heraContentIdOf } from './identity.ts';
import type { HeraPromptVersion } from './contracts.gen.ts';
export function heraRoleTools(role: string): string[] { return role === 'retriever' ? ['hera-evidence'] : []; }
export function heraEnvelopeRevision(artifact: GmplPromptArtifact): Promise<string> {
  return heraRevisionOf({ artifactRevision: artifact.revision, tools: heraRoleTools(artifact.role.id) });
}
export async function compileEffectivePrompt(artifact: GmplPromptArtifact, version: Pick<HeraPromptVersion, 'agentId' | 'envelopeRevision' | 'operationalRules' | 'behavioralPrinciples'>): Promise<HeraOutcome<string>> {
  if (version.agentId !== artifact.role.id || version.envelopeRevision !== await heraEnvelopeRevision(artifact))
    return heraRefuse('THERA1002', '/envelopeRevision', 'The prompt blocks belong to another role envelope.');
  const section = (title: string, rules: HeraPromptVersion['operationalRules']) => rules.length ? '\n\n' + title + '\n' + rules.map(r => '- ' + r.text).join('\n') : '';
  return { valid: true, value: artifact.role.instructions + section('Operational rules', version.operationalRules) + section('Behavioral principles', version.behavioralPrinciples) };
}
export async function createHeraPromptVersion(artifact: GmplPromptArtifact, options: {
  scope: string; at: string; parentId?: string | null; operationalRules?: HeraPromptVersion['operationalRules'];
  behavioralPrinciples?: HeraPromptVersion['behavioralPrinciples']; sourceTrialIds?: string[];proposalOperationId?:string;
}): Promise<HeraOutcome<HeraPromptVersion>> {
  const blocks = { agentId: artifact.role.id, envelopeRevision: await heraEnvelopeRevision(artifact),
    operationalRules: options.operationalRules ?? [], behavioralPrinciples: options.behavioralPrinciples ?? [] };
  const compiled = await compileEffectivePrompt(artifact, blocks); if (!compiled.valid) return compiled;
  const content = { ...blocks, scope: options.scope, parentId: options.parentId ?? null, effectivePrompt: compiled.value,
    sourceTrialIds: options.sourceTrialIds ?? [],...(options.proposalOperationId?{proposalOperationId:options.proposalOperationId}:{}), status: 'candidate' as const,
    size: { rules: blocks.operationalRules.length + blocks.behavioralPrinciples.length, bytes: new TextEncoder().encode(compiled.value).byteLength }, at: options.at };
  return { valid: true, value: { ...content, id: await heraContentIdOf(content) } };
}
