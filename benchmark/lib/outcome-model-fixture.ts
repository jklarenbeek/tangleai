/** A registered keyless interruption seam; it never enters the injected fetch. */
import fixture from '../fixtures/outcome-proposal-config.json' with { type: 'json' };
import { createStructuredOutcomeProposer, outcomeProposalComponents } from '@tangleai/outcomes/proposer';
import { outcomeRevision } from '@tangleai/outcomes';
import type { ProfileRegistry, HostManifest } from '@tangleai/config';
import type { OutcomeProposer } from '@tangleai/outcomes';
export async function createInterruptedProposer(interrupt: () => never = () => { throw Error('Fixture stops after durable dispatch, before network.'); }): Promise<OutcomeProposer> {
  const base = structuredClone(fixture), registry = base.registry as unknown as ProfileRegistry;
  registry.inference[0].maxTokens = 512;
  for (const p of registry.profiles) if (p.kind === 'root') p.roles.answer.tools = [];
  const revisions = await outcomeProposalComponents();
  registry.prompts[0].revision = revisions.promptRevision; registry.responseSchemas[0].revision = revisions.responseSchemaRevision;
  const original = await createStructuredOutcomeProposer({ configuration: { registry, request: base.request, host: base.host as unknown as HostManifest }, role: 'answer', clock: () => 0, deadline: () => new AbortController().signal, fetch: async () => { throw Error('No wire requests permitted.'); } });
  return { identity: original.identity, async propose(input, hooks) {
    await hooks.onDispatch(await outcomeRevision({ interruptedFixture: input }));
    return interrupt();
  } };
}
