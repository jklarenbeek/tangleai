/** Roles and tool capabilities are host declarations, never model-issued grants. */
import { createMasConfigCatalog, masRevisionOf, type MasRegistry } from '@tangleai/mas';
import type { GmplCatalog } from '@tangleai/gmpl';
import { heraRefuse, type HeraOutcome } from './errors.ts';
import { createHeraPromptVersion, heraRoleTools } from './prompt.ts';
import type { HeraAgentDefinition, HeraPromptVersion } from './contracts.gen.ts';
export const HERA_ROLE_IDS = ['query-decomposer','retriever','answer-generator','query-rewriter','evidence-selector','context-validator','reflect-agent','conclude-agent'] as const;
export const HERA_EVIDENCE_INPUT = Object.freeze({ type: 'object', properties: { query: {type:'string',minLength:1}, k: {type:'integer',minimum:1,maximum:20} }, required:['query','k'], additionalProperties:false });
export async function createHeraAgents(catalog: GmplCatalog, options: { scope: string; profile: string; at: string }): Promise<HeraOutcome<{agents: HeraAgentDefinition[]; prompts: HeraPromptVersion[]}>> {
  const agents: HeraAgentDefinition[] = [], prompts: HeraPromptVersion[] = [];
  for (const role of HERA_ROLE_IDS) {
    const artifact = catalog.prompt('hera-' + role);
    if (!artifact || artifact.role.id !== role) return heraRefuse('THERA1002', '/catalog', 'A registered role artifact is missing.');
    const prompt = await createHeraPromptVersion(artifact, options); if (!prompt.valid) return prompt;
    prompts.push(prompt.value);
    agents.push({ id: role, scope: options.scope, title: role.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' '),
      artifactId: artifact.id, envelopeRevision: prompt.value.envelopeRevision, tools: heraRoleTools(role),
      contextAdapters: ['documents','memory'], profile: options.profile, activePromptVersionId: prompt.value.id, status: 'active' });
  }
  return { valid: true, value: { agents, prompts } };
}
export async function heraRegistryDocument(catalog: GmplCatalog, options: { registryId?: string; agents?: readonly HeraAgentDefinition[] } = {}): Promise<HeraOutcome<MasRegistry>> {
  const roles: MasRegistry['roles'] = [];
  for (const id of HERA_ROLE_IDS) {
    const artifact = catalog.prompt('hera-' + id);
    if (!artifact || artifact.role.id !== id) return heraRefuse('THERA1002', '/catalog', 'A registered role artifact is missing.');
    roles.push({ id, title: id, instructions: artifact.role.instructions, instructionsRevision: await masRevisionOf(artifact.role.instructions), capabilities: [] });
  }
  for (const agent of options.agents ?? []) {
    if (!HERA_ROLE_IDS.includes(agent.id as typeof HERA_ROLE_IDS[number])) return heraRefuse('THERA1003', '/id', 'The role is not registered.');
    for (const [index, tool] of agent.tools.entries()) if (!heraRoleTools(agent.id).includes(tool))
      return heraRefuse('THERA1003', '/tools/' + index, 'The tool is not in the immutable role allowlist.');
  }
  return { valid: true, value: { $masRegistry: '0.1', registryId: options.registryId ?? 'hera', roles,
    tools: [{ id:'hera-evidence', title:'Pinned evidence', effect:'read', input:HERA_EVIDENCE_INPUT, inputRevision:await masRevisionOf(HERA_EVIDENCE_INPUT) }],
    handlers: [{ id:'hera-validate-answer', title:'Validate cited answer', effect:'pure', idempotency:'not-required' }],
    messageAdapters: [{id:'json-schema',version:'0.1'}, ...catalog.document.prompts.map(p => ({id:'hera-' + p.id,version:p.revision}))],
    contextAdapters: ['documents','memory'].map(id => ({id,title:id,capabilities:[]})), templates:[],subgraphs:[] } };
}
export function heraConfigCatalog(profile: string, limits: Record<string, number>) {
  return createMasConfigCatalog({ profiles:[profile], tools:['hera-evidence'], contexts:['documents','memory'], limits });
}
