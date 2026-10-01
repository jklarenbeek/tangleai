/** The capability census pins content owners and their compiled prompt revisions. */
import { createMasRegistrySnapshot, masRevisionOf, type MasRegistry, type MasRegistrySnapshot } from '@tangleai/mas';
import { groundingArtifacts } from './optimizer-artifacts.ts';
import { GROUNDING_WEB_TOOLS } from './web.ts';
import { groundingReject } from './errors.ts';
export const GROUNDING_AGENT_STAGES = ['triage', 'plan', 'web-agent', 'reconcile', 'generate'] as const;
export type GroundingAgentStage = typeof GROUNDING_AGENT_STAGES[number];
export const GROUNDING_HANDLERS = ['rules', 'ready', 'refuse', 'clarify-input', 'clarify-project', 'expand', 'query', 'local', 'join', 'reconcile', 'validate', 'answer'] as const;
export async function createGroundingRegistry(base?: MasRegistrySnapshot, subgraphs: MasRegistry['subgraphs'] = []) {
    const roles = await Promise.all(GROUNDING_AGENT_STAGES.map(async stage => {
        const artifact = groundingArtifacts.prompts.find(row => row.id === 'grounding-' + stage)!;
        const instructions = `Execute the governed ${stage} component with compiled prompt ${artifact.id}/${artifact.revision}.`;
        return { id: artifact.id, title: artifact.id, instructions, instructionsRevision: await masRevisionOf(instructions), capabilities: [] };
    }));
    const agentExecutors = await Promise.all(GROUNDING_AGENT_STAGES.map(async stage => ({ id: 'grounding-' + stage,
        version: await masRevisionOf({ owner: 'governed-grounding-component/1', stage, catalog: groundingArtifacts.revision }) })));
    const adapters = GROUNDING_AGENT_STAGES.map(stage => { const artifact = groundingArtifacts.prompts.find(row => row.id === 'grounding-' + stage)!;
        return { id: artifact.id, version: artifact.revision }; });
    const tools = await Promise.all(GROUNDING_WEB_TOOLS.map(async tool => ({ id: tool.name, title: tool.description, effect: 'read' as const,
        input: tool.inputSchema, inputRevision: await masRevisionOf(tool.inputSchema) })));
    const prior = base?.document;
    const outcome = await createMasRegistrySnapshot({ $masRegistry: '0.1', registryId: 'grounding-registry',
        roles: [...(prior?.roles ?? []), ...roles], agentExecutors,
        handlers: [...(prior?.handlers ?? []), ...GROUNDING_HANDLERS.map(id => ({ id: 'grounding-' + id, title: id, effect: 'effectful', idempotency: 'honored' }))],
        tools: [...(prior?.tools ?? []), ...tools], contextAdapters: prior?.contextAdapters ?? [],
        messageAdapters: [...(prior?.messageAdapters ?? [{ id: 'json-schema', version: '0.1' }]), ...adapters],
        templates: [], subgraphs });
    if (!outcome.valid) groundingReject('TGRD1009', '/registry', 'Grounding capabilities did not validate.', outcome.issues[0]);
    return outcome.value;
}
