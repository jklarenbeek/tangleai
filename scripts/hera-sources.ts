/** Explicit build-only inventory; debugging prose is deliberately outside the catalog. */
export const HERA_ROLE_SOURCES = ['query-decomposer','retriever','answer-generator','query-rewriter','evidence-selector','context-validator','reflect-agent','conclude-agent'] as const;
export const HERA_CONTROL_SOURCES = ['plan-generation','reflection','consolidation','rope-evolution','topology-mutation'] as const;
export function heraPromptFiles(): string[] {
  return [...HERA_ROLE_SOURCES.map(id => `prompts/hera/roles/${id}.toml`), ...HERA_CONTROL_SOURCES.map(id => `prompts/hera/control/${id}.toml`)];
}
export function heraOutputName(id: string): string {
  const controls: Record<string,string> = { 'plan-generation':'heraPlanOutput', reflection:'heraReflectionOutput', consolidation:'heraConsolidationOutput', 'rope-evolution':'heraRopeOutput', 'topology-mutation':'heraMutationOutput' };
  return controls[id] ?? 'hera' + id.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('') + 'Output';
}
