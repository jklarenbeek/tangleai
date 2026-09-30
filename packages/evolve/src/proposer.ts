/** One budgeted structured proposal, validated by the host's immutable surface. */
import { createStructuredOutput } from '@tangleai/models/structured';
import { EVOLVE_PROPOSAL_SCHEMA, loadProposal, type EvolveProposalInput } from './proposal.ts';
import { refuseOne, type EvolveOutcome } from './errors.ts';

type Client = Parameters<typeof createStructuredOutput>[0]['client'];
export interface ProposalBudget {
  reserve(): void;
  settle(usage: unknown, text?: string): void;
  stop(): string | null;
  remaining(): Record<string, number | null>;
}
export interface ModelProposerOptions {
  client: Client;
  budget: ProposalBudget;
  /** The keyless host injects a recorded reply; a live host must authorize. */
  tier: 'scripted' | 'live';
  prepare: (proposal: EvolveProposalInput) => EvolveOutcome<unknown>;
}

export function createModelProposer(options: ModelProposerOptions) {
  let inFlight = false;
  const complete = options.client.complete.bind(options.client);
  const structured = createStructuredOutput({
    schema: EVOLVE_PROPOSAL_SCHEMA, name: 'repository_proposal', maxRepairs: 0,
    client: {
      endpoint: { ...options.client.endpoint },
      complete: async request => {
        const response = await complete(request);
        options.budget.settle(response.usage, response.message?.content ?? '');
        return response;
      },
    },
  });
  return {
    async propose(input: {
      messages: Array<{ role: string, content: string }>;
      proposalId: string;
      strategyId: string;
      authorize?: boolean;
    }): Promise<EvolveOutcome<EvolveProposalInput>> {
      if (options.tier === 'live' && input.authorize !== true) {
        return refuseOne('TEVO1010', '/authorize', 'Live proposal generation requires explicit authorization.');
      }
      if (inFlight) return refuseOne('TEVO1010', '/client', 'A proposer permits only one outstanding call.');
      const stop = options.budget.stop();
      if (stop !== null) return refuseOne('TEVO1005', '/budget', stop);
      options.budget.reserve();
      inFlight = true;
      let generated: Awaited<ReturnType<typeof structured.generate>>;
      try { generated = await structured.generate(input.messages); }
      catch (error) {
        return refuseOne('TEVO1006', '/client', 'Proposal generation failed: ' + (error instanceof Error ? error.message : String(error)));
      }
      finally { inFlight = false; }
      if (generated.value === undefined) return refuseOne('TEVO1001', '/reply', 'The model reply is not a valid proposal; repair is disabled.');
      const proposal = loadProposal(generated.value);
      if (!proposal.ok) return proposal;
      if (proposal.value.proposalId !== input.proposalId || proposal.value.strategyId !== input.strategyId || proposal.value.origin !== 'model') {
        return refuseOne('TEVO1002', '/reply', 'A model cannot change the registered proposal or strategy identity.');
      }
      // Tokens are charged from the actual reply. An exhausted account cannot
      // admit a patch, even if its shape and surface would otherwise pass.
      const remaining = options.budget.remaining();
      if (remaining.tokens === 0 || remaining.ms === 0) return refuseOne('TEVO1005', '/budget', 'The reply exhausted its token or time ceiling.');
      const prepared = options.prepare(proposal.value);
      if (!prepared.ok) return prepared as EvolveOutcome<EvolveProposalInput>;
      return proposal;
    },
  };
}
