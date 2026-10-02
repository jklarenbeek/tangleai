/** A trading domain over the native structured debate; MAS owns every round and attempt. */
import { cloneJson, equalsJson } from '@jarenjs/core/object';
import { createMasRegistrySnapshot, type MasNodeAttempt, type TraceView } from '@tangleai/mas';
import { GMPL_STAGES, gmplArtifacts, gmplSchemaOf, gmplCatalogDocument, createGmplCatalog, createGmplDomainBinding, createGmplRecipe,
  materializeGmplTemplate, instantiateGmplPattern, createGmplHostBindings, validateGmplShape, validateGmplEvidence,
  type GmplCatalog, type GmplHostSnapshot, type GmplRoundState, type GmplPatternResult } from '@tangleai/gmpl';
import { immutableTradingJson } from './identity.ts';
import { createTradingRecord, validateTradingRecord } from './records.ts';
import { tradingRefuse, type TradingOutcome } from './errors.ts';
import { checkTradingArtifactScope, researchInput } from './evidence.ts';
import { validateTradingShape } from './schema.ts';
import type { TradingAnalystProvenance } from './analysts.ts';
import type { AnalystReport, DebateTurn, ResearchVerdict, MarketSnapshot, MarketSession, TradingRunManifest, TradingSpend } from './contracts.gen.ts';

export const TRADING_RESEARCH_STAGES = Object.freeze({ 'debate-position': 'trading-research-position',
  'debate-rebuttal': 'trading-research-rebuttal', 'debate-judge': 'trading-research-judge', 'analysis-merge': 'trading-research-verdict' });

export async function tradingResearchDomain(catalog: GmplCatalog) {
  const position = catalog.prompt(TRADING_RESEARCH_STAGES['debate-position']);
  if (!position) return tradingRefuse('TTRD1002', '/catalog', 'Research position prompt is absent');
  const payload = cloneJson(gmplSchemaOf('gmplInput')) as { properties: Record<string, unknown> };
  payload.properties.caseId = { type: 'string', pattern: '^[a-z][a-z0-9-]*/[^/]+/[a-z][a-z0-9-]*$' };
  return createGmplDomainBinding({ id: 'trading-research', title: 'Evidence-bound investment research', payloadSchema: payload,
    projection: { id: 'text-answer', version: '1', kind: 'text', scale: null }, rolePrompts: TRADING_RESEARCH_STAGES,
    requiredCapabilities: [{ id: `gmpl-${position.id}`, version: position.revision }] });
}

async function researchContent(catalog: GmplCatalog, maxRounds: number) {
  const validated = await createGmplCatalog(catalog.document); if (!validated.valid) return validated;
  const domain = await tradingResearchDomain(validated.value); if (!domain.valid) return domain;
  const recipe = await createGmplRecipe({ id: 'structured-debate', scope: 'pattern', parameters: { pattern: 'structured-debate',
    participants: 2, maxRounds }, stages: [...GMPL_STAGES['structured-debate']] });
  if (!recipe.valid) return recipe;
  const content = await createGmplCatalog(await gmplCatalogDocument({ id: 'trading-research',
    prompts: [...gmplArtifacts.prompts, ...validated.value.document.prompts], domains: [domain.value], recipes: [recipe.value] }));
  if (!content.valid) return content;
  const policy = { parameters: recipe.value.parameters, domain: domain.value, catalogRevision: content.value.document.revision, recipeRevision: recipe.value.revision };
  return { valid: true as const, value: { catalog: content.value, domain: domain.value, recipe: recipe.value, policy } };
}

export async function materializeResearch(input: { host: GmplHostSnapshot; manifest: TradingRunManifest; catalog: GmplCatalog }) {
  try { input = { ...input, manifest: immutableTradingJson(input.manifest), host: { ...input.host } }; }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Research materialization requires finite manifest data', cause); }
  const manifest = await validateTradingRecord(input.manifest); if (!manifest.valid) return manifest;
  const catalog = await createGmplCatalog(input.catalog.document);
  if (!catalog.valid || input.manifest.promptCatalogRevision !== input.catalog.document.revision)
    return tradingRefuse('TTRD1002', '/catalog', 'Research must use the manifest prompt catalog');
  for (const role of Object.values(TRADING_RESEARCH_STAGES)) {
    if (!catalog.value.prompt(role)) return tradingRefuse('TTRD1002', '/catalog', 'Research prompt is missing');
    if ((input.manifest.rolesByProfile[role] ?? input.manifest.rolesByProfile.research) !== input.host.profile)
      return tradingRefuse('TTRD1002', '/rolesByProfile', 'The native research pattern requires its declared host profile for every research role');
  }
  const content = await researchContent(catalog.value, input.manifest.rounds.research); if (!content.valid) return content;
  const { domain, recipe, catalog: researchCatalog } = content.value;
  const adapters = [...input.host.registry.document.messageAdapters];
  for (const required of domain.requiredCapabilities) {
    const existing = adapters.find(a => a.id === required.id);
    if (existing && existing.version !== required.version) return tradingRefuse('TTRD1002', '/host', 'Research adapter revision collides with the host');
    if (!existing) adapters.push(required);
  }
  const registry = await createMasRegistrySnapshot({ ...input.host.registry.document, messageAdapters: adapters }); if (!registry.valid) return registry;
  const host = { ...input.host, registry: registry.value };
  // The native materializer intersects these declared host caps with its own ceilings.
  const materialized = await materializeGmplTemplate(recipe, domain, host, researchCatalog); if (!materialized.valid) return materialized;
  const ceilings = materialized.value.template.fragment.limits as Record<string, number>;
  const caps = Object.fromEntries(Object.entries(input.manifest.limits).map(([key, limit]) => [key, Math.min(limit, ceilings[key] ?? limit)]));
  const instance = await instantiateGmplPattern(materialized.value, { caps }, host, researchCatalog); if (!instance.valid) return instance;
  const bindings = createGmplHostBindings(materialized.value, researchCatalog); if (!bindings.valid) return bindings;
  return { valid: true as const, value: { ...instance.value, bindings: bindings.value, contentCatalog: researchCatalog, host } };
}

export async function checkMaterializedResearch(materialized: Extract<Awaited<ReturnType<typeof materializeResearch>>, { valid: true }>['value'], catalog: GmplCatalog,
  manifest?: TradingRunManifest) {
  if (materialized.materialized.parameters.pattern !== 'structured-debate')
    return tradingRefuse('TTRD1002', '/materialized', 'Research requires the native structured debate');
  const rounds = materialized.materialized.parameters.maxRounds;
  if (rounds === undefined || manifest && (manifest.promptCatalogRevision !== catalog.document.revision || manifest.rounds.research !== rounds
    || Object.values(TRADING_RESEARCH_STAGES).some(role => (manifest.rolesByProfile[role] ?? manifest.rolesByProfile.research) !== materialized.host.profile)
    || Object.entries(manifest.limits).some(([key, limit]) => materialized.validated.workflow.limits[key as keyof typeof manifest.limits] > limit)))
    return tradingRefuse('TTRD1002', '/materialized', 'Research child differs from the manifest rounds, profiles, catalog or limits');
  const content = await researchContent(catalog, rounds);
  if (!content.valid) return tradingRefuse('TTRD1002', '/catalog', 'Research composition requires valid compiled content', content.issues[0]);
  const { policy } = content.value;
  if (materialized.contentCatalog.document.revision !== policy.catalogRevision || materialized.materialized.catalogRevision !== policy.catalogRevision
    || !equalsJson(materialized.materialized.domain, policy.domain) || !equalsJson(materialized.materialized.recipe, content.value.recipe)
    || !equalsJson(materialized.validated.workflow.state?.init, { policy }))
    return tradingRefuse('TTRD1002', '/catalog', 'Research child must bind the same compiled trading catalog and native policy');
  return { valid: true as const, value: true as const };
}

export interface TradingResearchContext {
  manifest: TradingRunManifest; snapshot: MarketSnapshot; session: MarketSession; reports: readonly AnalystReport[]; catalog: GmplCatalog;
}
export type TradingAttemptProvenance = (attempt: MasNodeAttempt) => TradingOutcome<TradingAnalystProvenance> | Promise<TradingOutcome<TradingAnalystProvenance>>;
export async function checkedTradingAttempt(attempt: MasNodeAttempt, profile: string, provenance: TradingAttemptProvenance): Promise<TradingOutcome<TradingAnalystProvenance>> {
  const observed = await provenance(attempt); if (!observed.valid) return observed;
  const spend = validateTradingShape<TradingSpend>('tradingSpend', observed.value.spend); if (!spend.valid) return spend;
  if (observed.value.model.profile !== profile || spend.value.calls !== attempt.usage.calls || spend.value.toolCalls !== attempt.usage.toolCalls
    || spend.value.tokens !== attempt.usage.promptTokens + attempt.usage.completionTokens + (attempt.usage.estimatedTokens ?? 0)
    || spend.value.ms !== attempt.spend.ms)
    return tradingRefuse('TTRD1002', '/provenance', 'Observed role identity or spend differs from its durable attempt');
  return { valid: true, value: immutableTradingJson(observed.value) };
}

export async function researchVerdict(input: TradingResearchContext & { result: unknown; trace: Pick<TraceView, 'attempts'>; scope?: string; provenance: TradingAttemptProvenance }): Promise<TradingOutcome<{ verdict: ResearchVerdict; turns: DebateTurn[] }>> {
  try { input = { ...input, ...immutableTradingJson({ manifest: input.manifest, snapshot: input.snapshot, session: input.session,
    reports: input.reports, result: input.result, trace: input.trace }) }; }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Research reconstruction requires finite JSON', cause); }
  if (input.manifest.promptCatalogRevision !== input.catalog.document.revision || input.reports.some(r => input.catalog.prompt(r.role)?.revision !== r.promptRevision))
    return tradingRefuse('TTRD1002', '/catalog', 'Research reports and manifest must bind their compiled prompts');
  const scoped = await checkTradingArtifactScope(input.reports, input.snapshot); if (!scoped.valid) return scoped;
  const prepared = await researchInput({ manifest: input.manifest, asset: input.snapshot.asset, session: input.session, reports: input.reports }); if (!prepared.valid) return prepared;
  const scope = input.scope ?? '', prefix = scope ? scope + '/' : '';
  const attempts = immutableTradingJson(input.trace.attempts.filter(a => !scope || a.path.startsWith(prefix)));
  const last = (id: string) => attempts.filter(a => a.invocationId === id && a.status === 'completed').sort((a, b) => b.seq - a.seq)[0];
  const loop = last('rounds'), final = last('finalize');
  const state = validateGmplShape<GmplRoundState>('gmplRoundState', (loop?.output as { next?: unknown } | undefined)?.next);
  const content = await researchContent(input.catalog, input.manifest.rounds.research);
  if (!content.valid) return tradingRefuse('TTRD1002', '/catalog', 'Research reconstruction requires valid compiled content', content.issues[0]);
  if (state.valid && !equalsJson(state.value.policy, content.value.policy))
    return tradingRefuse('TTRD1002', '/trace/policy', 'Terminal research policy differs from its compiled catalog, recipe or domain');
  if (!state.valid || !state.value.done || !equalsJson(state.value.input, prepared.value) || state.value.policy.domain.id !== 'trading-research'
    || state.value.policy.parameters.pattern !== 'structured-debate' || state.value.policy.parameters.participants !== 2
    || state.value.policy.parameters.maxRounds !== input.manifest.rounds.research || state.value.history.length !== state.value.round
    || state.value.round > input.manifest.rounds.research || !equalsJson((final?.output as { result?: unknown } | undefined)?.result, input.result))
    return tradingRefuse('TTRD1004', '/trace', 'A verdict requires the terminal native debate carry and its exact final result');
  const result = validateGmplEvidence(input.result, prepared.value.evidence, state.value.findings);
  if (!result.valid || result.value.disposition !== state.value.disposition || !['completed', 'no-consensus', 'rejected'].includes(result.value.disposition))
    return tradingRefuse('TTRD1004', '/result', 'Research result does not preserve terminal evidence and disposition');
  const artifactIds = (value: GmplPatternResult) => [...new Set([...value.claims, ...value.findings].flatMap(c => c.citations.map(citation => citation.id.split(':f')[0])))];
  const claims = (value: GmplPatternResult) => value.claims.map(c => ({ text: c.text, citations: [...new Set(c.citations.map(citation => citation.id.split(':f')[0]))] }));
  const turnInputs: Array<{ attempt: MasNodeAttempt; round: number; participant: NonNullable<DebateTurn['participant']>; phase: 'position' | 'rebuttal' }> = [];
  for (const attempt of attempts.filter(a => a.kind === 'agent' && /^(position|rebuttal)-[12]$/.test(a.invocationId))) {
    if (attempt.status === 'running') return tradingRefuse('TTRD1004', '/trace', 'An unfinished debate attempt cannot become a verdict');
    const preparePath = attempt.path.slice(0, -attempt.invocationId.length) + 'prepare-' + attempt.invocationId;
    const prepare = attempts.filter(a => a.path === preparePath && a.status === 'completed' && a.seq < attempt.seq).sort((a, b) => b.seq - a.seq)[0];
    const round = (prepare?.output as { variables?: { context?: { round?: number } } } | undefined)?.variables?.context?.round;
    if (!Number.isInteger(round) || !round || round > state.value.round) return tradingRefuse('TTRD1004', '/trace', 'Turn has no matching native preparation');
    turnInputs.push({ attempt, round, participant: attempt.invocationId as NonNullable<DebateTurn['participant']>, phase: attempt.invocationId.startsWith('position') ? 'position' : 'rebuttal' });
  }
  turnInputs.sort((a, b) => a.round - b.round || a.phase.localeCompare(b.phase) || a.participant.localeCompare(b.participant) || a.attempt.attempt - b.attempt.attempt);
  const turns: DebateTurn[] = [], observed = new Map<string, TradingAnalystProvenance>();
  for (const attempt of attempts.filter(a => a.kind === 'agent' && /^(position-[12]|rebuttal-[12]|judge|synthesis)$/.test(a.invocationId))) {
    const stage = attempt.invocationId.startsWith('position') ? 'debate-position' : attempt.invocationId.startsWith('rebuttal') ? 'debate-rebuttal' : attempt.invocationId === 'judge' ? 'debate-judge' : 'analysis-merge';
    const prompt = input.catalog.prompt(TRADING_RESEARCH_STAGES[stage]);
    if (!prompt) return tradingRefuse('TTRD1002', '/catalog', 'Research prompt is absent');
    const profile = input.manifest.rolesByProfile[prompt.role.id] ?? input.manifest.rolesByProfile.research;
    if (!profile) return tradingRefuse('TTRD1002', '/rolesByProfile', 'Research profile is absent');
    const value = await checkedTradingAttempt(attempt, profile, input.provenance); if (!value.valid) return value;
    observed.set(attempt.id, value.value);
  }
  for (const { attempt, round, participant, phase } of turnInputs) {
    const prompt = input.catalog.prompt(TRADING_RESEARCH_STAGES[phase === 'position' ? 'debate-position' : 'debate-rebuttal'])!;
    const raw = (attempt.output as { out?: { result?: unknown } } | null)?.out?.result;
    const checked = attempt.status === 'completed' ? validateGmplEvidence(raw, prepared.value.evidence) : null;
    if (checked && !checked.valid) return tradingRefuse('TTRD1004', '/trace', 'A completed turn contains invalid research evidence');
    const value = checked?.valid ? checked.value : null, provenance = observed.get(attempt.id)!;
    const prior = turns.filter(t => t.round < round || phase === 'rebuttal' && t.round === round && t.phase === 'position').map(t => t.id);
    const turn = await createTradingRecord('debate-turn', { manifestId: input.manifest.id, snapshotId: input.snapshot.id, role: prompt.role.id,
      key: { manifestId: input.manifest.id, asset: input.snapshot.asset, sessionId: input.snapshot.sessionId, stage: `research-${round}-${participant}-attempt-${attempt.attempt}` },
      model: provenance.model, spend: provenance.spend, promptRevision: prompt.revision, claims: value ? claims(value) : [], citations: value ? artifactIds(value) : [],
      round, persona: participant.endsWith('-1') ? 'bull' : 'bear', participant, phase, attemptKey: attempt.idempotencyKey, attemptNumber: attempt.attempt,
      attemptStatus: attempt.status as NonNullable<DebateTurn['attemptStatus']>, result: value,
      position: value?.answer || `Research attempt ${attempt.status}`, previousTurnIds: prior });
    if (!turn.valid) return turn; turns.push(turn.value);
  }
  for (let round = 1; round <= state.value.round; round++) for (const participant of ['position-1', 'position-2', 'rebuttal-1', 'rebuttal-2'])
    if (turns.filter(t => t.round === round && t.participant === participant && t.attemptStatus === 'completed').length !== 1)
      return tradingRefuse('TTRD1004', '/trace', 'Every completed round requires exactly one completed turn per participant and phase');
  const synthesis = last('synthesis'), provenance = synthesis && observed.get(synthesis.id);
  if (!provenance) return tradingRefuse('TTRD1004', '/trace', 'Research synthesis provenance is absent');
  const spend = Object.fromEntries(Object.keys(provenance.spend).map(key => [key, [...observed.values()].reduce((sum, value) => sum + value.spend[key as keyof TradingSpend], 0)])) as unknown as TradingSpend;
  const judgments = state.value.history.map(h => ({ round: h.round, action: h.action, judgment: h.judgment }));
  const verdict = await createTradingRecord('research-verdict', { manifestId: input.manifest.id, snapshotId: input.snapshot.id, role: 'trading-research-verdict',
    key: { manifestId: input.manifest.id, asset: input.snapshot.asset, sessionId: input.snapshot.sessionId, stage: 'research-verdict' },
    model: provenance.model, spend, promptRevision: input.catalog.prompt('trading-research-verdict')!.revision,
    claims: claims(result.value), citations: artifactIds(result.value), disposition: result.value.disposition as 'completed' | 'no-consensus' | 'rejected',
    summary: result.value.answer || 'No evidenced investment thesis', prevailingThesis: result.value.answer || 'No evidenced investment thesis',
    recommendation: result.value.claims.map(c => c.text), rounds: state.value.round, historyIds: turns.map(t => t.id), result: result.value,
    judgments: judgments as NonNullable<ResearchVerdict['judgments']>, unresolvedFindings: result.value.findings.filter(f => f.disposition === 'unresolved' || f.disposition === 'contested' || f.contradictory && f.disposition !== 'rejected-with-reason') });
  return verdict.valid ? { valid: true, value: { verdict: verdict.value, turns } } : verdict;
}
