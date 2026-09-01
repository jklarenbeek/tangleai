/**
 * @tangleai/mas — the durable typed multi-agent runtime core.
 *
 * A zero-I/O package over JarenJS: the closed `MasWorkflowVersion` IR
 * and its generated contracts, canonical identities, the pure layered
 * validator, immutable registry snapshots, the region partitioner and
 * the LINQ-pen lowering to `jaren-dag`/`jaren-fsm` documents proven by
 * the suite compilers. Host configuration, databases, network, model
 * clients and domain adapters are injected by hosts and cannot enter
 * this package through a hidden import.
 *
 * What this package does NOT claim: no natural-language workflow
 * authoring ("Vibe Graphing"), no paper benchmark parity, no GMPL
 * collaboration templates, no HERA learning. It validates, plans and
 * (through the host bindings of the runtime modules) executes manually
 * authored workflows.
 */

export {
  MAS_VALIDATION_CODES,
  MAS_RUNTIME_CODES,
  masIssue,
  sortMasIssues,
} from './errors.ts';
export type { MasCode, MasValidationCode, MasRuntimeCode, MasIssue, MasValidated } from './errors.ts';

export {
  masRevisionOf,
  masWorkflowVersionIdOf,
  masRegistryRevisionOf,
  masTemplateVersionIdOf,
  masConfigCatalogRevisionOf,
} from './identity.ts';

export {
  masWorkflowSchema,
  masRegistrySchema,
  masTemplateSchema,
  masRuntimeSchema,
  validateWorkflowShape,
  validateRegistryShape,
  validateTemplateShape,
  validateRuntimeRecord,
} from './schema.ts';

export { createMasRegistrySnapshot, createMasConfigCatalog } from './registry.ts';
export type { MasRegistrySnapshot, MasConfigCatalog } from './registry.ts';

export { schemaAccepts } from './compatibility.ts';

export { validateMasWorkflow } from './validate.ts';
export type { ValidatedMasWorkflow, ValidateOptions } from './validate.ts';

export { partitionMasWorkflow } from './partition.ts';
export type { Region, RegionMember } from './partition.ts';

export { planMasWorkflow } from './lower.ts';
export type { MasWorkflowPlan, MasRegionDescriptor } from './lower.ts';

export {
  semanticKeyOf,
  invocationPathOf,
  checkpointNamespaceOf,
  attemptIdOf,
  messageIdOf,
  stateRevisionIdOf,
  artifactIdOf,
  interactionIdOf,
  segmentJobIdOf,
  masJobKindOf,
  planRunTransition,
  planAttemptTransition,
  planInteractionTransition,
} from './runtime-state.ts';
export type { NodeAddress, RunCommand, RunTransition, AttemptStatusValue, InteractionStatusValue } from './runtime-state.ts';

export { planNodeCompletion } from './store.ts';
export type {
  MasStore,
  StoreOutcome,
  ActivationOutcome,
  BeginOutcome,
  CreateRunPlan,
  BeginAttemptPlan,
  CommitCompletionPlan,
  CompletionMessagePlan,
  FailAttemptPlan,
  TraceView,
  PlannedCompletion,
} from './store.ts';

export {
  plainAdapter,
  markdownSectionsAdapter,
  jsonSchemaAdapter,
  BUILTIN_MESSAGE_ADAPTERS,
} from './messages.ts';
export type { MasMessageAdapter, MasRenderableInput, MasInboundUnit } from './messages.ts';

export {
  createMemoryContextProvider,
  createDocumentsContextProvider,
  createWebContextProvider,
  createToolboxContextProvider,
  createMcpContextProvider,
} from './context.ts';
export type { MasContextProvider, MasContextOutcome, MasContextUnit, MasContextReadOptions } from './context.ts';

export { createSharedBudgetClient, MasBudgetStop } from './budget.ts';
export type { MasBudgetAccount, MasChatClient, MasChatCompletion } from './budget.ts';

export { buildEffectiveToolbox, validateToolBindings, classifyToolSteps, MasUncertainEffect } from './tools.ts';
export type { MasToolBinding, EffectiveToolbox } from './tools.ts';

export { runAgentNode } from './agent-executor.ts';
export type { AgentRunResult, AgentRunOutcome } from './agent-executor.ts';

export { createNodeLifecycle, MasNodeFailure } from './node-lifecycle.ts';
export type { MasTaskHandlerBinding, MasTaskInput, MasRuntimeObserver } from './node-lifecycle.ts';

export { executeDagRegion } from './dag-runtime.ts';
export type { DagRegionOutcome } from './dag-runtime.ts';

export { compileMasRuntime, MasInfrastructureCrash } from './runtime.ts';
export type { MasHostBindings, MasSegmentHost, MasRuntime } from './runtime.ts';

export { createMasAgentContext } from './agent-context.ts';
export type { MasAgentContext, MasAgentContextOptions, MasLedgerStorage } from './agent-context.ts';

export { walkRegions } from './control-runtime.ts';
export type { RunContext, RegionFrame, RegionsOutcome } from './control-runtime.ts';

export { instantiateMasTemplate } from './templates.ts';
export type { InstantiatedTemplate } from './templates.ts';

export { projectMasPlan } from './mermaid.ts';
export type { MasPlanProjection, MasRegionDiagram } from './mermaid.ts';

export { nodeFeeds } from './lower.ts';
export type { Feed } from './lower.ts';

export {
  defineMasWorkflow,
  agentInvocation,
  taskInvocation,
  graphInvocation,
  loopInvocation,
  switchInvocation,
  interactionInvocation,
  masMessage,
} from './builder.ts';
export type { MasWorkflowSpec } from './builder.ts';

export type {
  MasWorkflow,
  MasRegistry,
  MasTemplate,
  MasRun,
  MasNodeAttempt,
  MasMessage,
  MasStateRevision,
  MasInteraction,
  MasTraceArtifact,
  Invocation,
  AgentNode,
  TaskNode,
  GraphNode,
  LoopNode,
  SwitchNode,
  InteractionNode,
  MessageEdge,
  WorkflowLimits,
  NodeLimits,
  RunStatus,
  AttemptStatus,
  BoundedView,
  ToolStep,
  ContextRead,
  UsageCounts,
  BudgetSpend,
  RuntimeError,
  JsonSchema,
} from './contracts.gen.ts';
