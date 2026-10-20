/**
 * The crew's seat, Tangle edition: a language model plays the crew
 * through `@tangleai/models`, building through the OS contract with the
 * contract toolbox of `@tangleai/jaren`.
 *
 * A crew turn follows the scripted crew's plan — which member takes which
 * open idea, and the kind of block the idea asks for — and the model
 * writes every block: seated as that member, offered `crew.build` and
 * `crew.say` and nothing else, its seat pinned so it builds for that
 * member and no one else, it is asked to build the idea as one block of
 * the planned kind. The tools are sized to the model by its tool budget
 * (the OS setting: auto reads it from the model's name): a small model
 * is offered a catalog of three short tools in place of every schema, an
 * input larger than its budget is built as a draft a few members a call,
 * and a member that needed more than a call to build and a call to speak
 * says afterwards how many it took. An idea the model leaves unbuilt — it failed,
 * refused or ran out of rounds — is built by the scripted crew instead,
 * so a turn always ends with every planned idea built.
 *
 * With no model in the Tangle assistant's settings the seat sits the turn
 * out (`turn` answers false) and the OS's scripted crew plays it.
 */

import { createChatClient } from '@tangleai/models';
import { createAgent } from '@tangleai/agents/agent';
import { createToolbox } from '@tangleai/agents/toolbox';
import { createContractToolbox } from '@tangleai/jaren/contract-tools';
import type { CompiledContract } from '@tangleai/jaren/contract-tools';
import type { ToolTier } from '@tangleai/models/profile';
import { CREW, scriptedCrew } from './crew.ts';
import type { Idea, Project } from './crew.ts';
import { BLOCK_CATALOG } from './blocks.ts';
import { isLive } from './oracle.ts';
import type { ModelSettings } from './oracle.ts';

/** One planned move: a member, the idea it builds, the block the scripted crew would build. */
type Move = ReturnType<typeof scriptedCrew>[number];

/** A contract client as the OS opens it. */
export type CrewClient = { invoke(op: string, input?: unknown): Promise<any> };

export type CrewSeatOptions = {
  contract: CompiledContract,
  client: CrewClient,
  settings?: ModelSettings | null,
  fetch?: typeof fetch,
  /** The OS's tool-budget setting: 'auto' or a tier. */
  budget?: () => string,
  /** The model id whose profile an 'auto' budget reads (the OS's own setting), when it is not the chat model's. */
  profile?: () => string,
  /** A model call that failed; the scripted crew then builds that idea. */
  onError?: (error: unknown) => void,
};

export type CrewSeat = {
  readonly live: boolean,
  readonly label: string,
  configure: (settings: ModelSettings | null | undefined) => void,
  /** Play the crew's turn; false when no model is seated. */
  turn: (project: Project) => Promise<boolean>,
};

const TIERS: readonly string[] = ['tiny', 'small', 'medium', 'large', 'unlimited'];

/** What every member is told, whoever it is. */
export function crewSystem(name: string): string {
  return [
    `You are ${name}, one of the four builders in the crew of Radiant OS.`,
    'The employers — the people at the screen — add ideas for an app; the crew builds each idea as one block of that app, and the employers approve or veto every block.',
    'Build exactly the one block you are asked for with the crew_build tool (or, when it is offered as a draft, by opening, filling and committing the draft), using the idea id you are given.',
    'Write short labels in the language of the idea. Then say one short sentence about what you built with crew_say. Do not ask questions.',
    `The blocks: ${BLOCK_CATALOG.map((b) => `${b.kind} — ${b.use}, ${b.shape}`).join('; ')}.`,
  ].join(' ');
}

/** The one task of one move, as the member reads it. */
export function crewTask(project: Project, idea: Idea, move: Move): string {
  const kind = BLOCK_CATALOG.find((b) => b.kind === move.block.kind);
  return [
    `Project: “${project.title}”. Idea ${idea.id}: “${idea.text}”.`,
    `Build it as one ${move.block.kind} block${kind ? ` (${kind.shape})` : ''}, with idea "${idea.id}".`,
    `For example: ${JSON.stringify(move.block)}`,
  ].join('\n');
}

/** The tool budget the setting names, for this model. */
const budgetOf = (setting: string): 'auto' | ToolTier => (TIERS.includes(setting) ? setting as ToolTier : 'auto');

/** Whether the project now holds a build of the idea this round. */
async function built(client: CrewClient, idea: string): Promise<boolean> {
  // an operation that declares no input refuses even an empty object
  const read = await client.invoke('crew.read');
  const p = read?.ok ? read.value?.project : null;
  return Boolean(p) && p.tasks.some((t: any) => t.idea === idea && t.round === p.round);
}

/**
 * Seat the crew: a live model when the assistant's settings name one,
 * none otherwise.
 */
export function createCrewSeat(options: CrewSeatOptions): CrewSeat {
  let settings: ModelSettings | null = null;
  let chat: ReturnType<typeof createChatClient> | null = null;
  const configure = (next: ModelSettings | null | undefined) => {
    settings = isLive(next) ? { ...next } : null;
    chat = settings === null ? null : createChatClient({
      provider: settings.provider, baseUrl: settings.baseUrl || undefined, apiKey: settings.apiKey || undefined,
      model: settings.model, fetch: options.fetch, maxTokens: 900,
    });
  };
  configure(options.settings);

  /** One move by the model; true when the idea got built. */
  async function play(project: Project, move: Move): Promise<boolean> {
    const idea = project.ideas.find((i) => i.id === move.idea);
    const member = CREW.find((c) => c.id === move.by);
    if (!idea || !member || chat === null || settings === null) return false;
    const tools = createContractToolbox(options.contract, options.client as any, {
      model: options.profile?.().trim() || settings.model, budget: budgetOf(options.budget?.() ?? 'auto'), ops: ['crew.build', 'crew.say'], pin: { by: move.by },
    });
    const toolbox = createToolbox();
    for (const tool of tools.tools) toolbox.add(tool);
    const agent = createAgent({
      client: chat, toolbox, system: crewSystem(member.name),
      // a draft takes a call to open, a few to fill and one to commit; a catalog a call to list and one to describe
      maxToolRounds: tools.staged.length > 0 ? 16 : tools.budget.catalog ? 8 : 4,
    });
    let calls = 0;
    await agent.send([{ role: 'user', content: crewTask(project, idea, move) }], { onToolCall: () => { calls += 1; } });
    const ok = await built(options.client, idea.id);
    if (ok && calls > 2) {
      await options.client.invoke('crew.say', { by: move.by, idea: idea.id, text: `That took ${calls} tool calls under the ${tools.budget.tier} tool budget.` });
    }
    return ok;
  }

  return {
    get live() { return settings !== null; },
    get label() { return settings === null ? 'scripted' : settings.model; },
    configure,
    async turn(project) {
      if (chat === null) return false;
      for (const move of scriptedCrew(project)) {
        let ok = false;
        try {
          ok = await play(project, move);
        }
        catch (error) {
          options.onError?.(error);
        }
        if (!ok) {
          await options.client.invoke('crew.say', { by: move.by, idea: move.idea, text: move.say });
          await options.client.invoke('crew.build', { by: move.by, idea: move.idea, block: move.block });
        }
      }
      return true;
    },
  };
}
