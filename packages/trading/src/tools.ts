/** Read tools can only narrow a role's retained evidence, asset and decision cutoff. */
import { toEpoch } from '@jarenjs/core/series';
import type { MasToolBinding } from '@tangleai/mas';
import { immutableTradingJson } from './identity.ts';
import { validateTradingShape } from './schema.ts';
import { validateTradingRecord } from './records.ts';
import { tradingIssue } from './errors.ts';
import { TRADING_ANALYST_ROLES, TRADING_ANALYST_TOOLS } from './analysts.ts';
import type { TradingAnalystContext } from './analysts.ts';
import type { TradingProviders, TradingProviderOutcome } from './providers.ts';
import type { Observation, TradingIssue, TradingReadToolInput, TradingAnalystRole } from './contracts.gen.ts';

export const TRADING_READ_TOOLS = Object.freeze(['bars-window', 'fundamentals-facts', 'news-items', 'social-items', 'insider-events'] as const);
export interface TradingToolAudit { calls: number; returned: number; refusals: TradingIssue[]; }
export function createTradingReadTools(input: { context: TradingAnalystContext; providers: TradingProviders;
  /** Trusted host declaration for combined roles; model arguments cannot grant a scope. */
  rolesByInvocation?: Readonly<Record<string, readonly TradingAnalystRole[]>>;
}): { toolBindings: Record<string, MasToolBinding>; audit: TradingToolAudit } {
  const context = immutableTradingJson(input.context), providers = input.providers;
  const scopes = immutableTradingJson(input.rolesByInvocation ?? {});
  for (const [node, roles] of Object.entries(scopes)) if (!/^[a-z][a-z0-9-]*$/.test(node) || !roles.length
    || new Set(roles).size !== roles.length || roles.some(role => !TRADING_ANALYST_ROLES.includes(role)))
    throw new TypeError('Read tool scopes require a native invocation and distinct declared analyst roles');
  const audit: TradingToolAudit = { calls: 0, returned: 0, refusals: [] };
  const refuse = (issue: TradingIssue) => { audit.refusals.push(immutableTradingJson(issue)); return { error: issue }; };
  const toolBindings: Record<string, MasToolBinding> = {};
  for (const tool of TRADING_READ_TOOLS) toolBindings[tool] = { async handler(raw, invocation) {
    audit.calls++;
    if (invocation.signal.aborted) return refuse(tradingIssue('TTRD1008', '', 'Read was cancelled'));
    const shape = validateTradingShape<TradingReadToolInput>('tradingReadToolInput', raw); if (!shape.valid) return refuse(shape.issues[0]);
    const args = shape.value, node = invocation.invocation?.node ?? '';
    const declared = Object.hasOwn(scopes, node) ? scopes[node] : TRADING_ANALYST_ROLES.filter(r => node === `analyst-${r}`);
    const roles = declared.filter(role => TRADING_ANALYST_TOOLS[role].includes(tool));
    if (!roles.length) return refuse(tradingIssue('TTRD1003', '/role', 'Tool is outside the invoking role allowlist'));
    const snapshot = context.snapshot, cutoffAt = args.cutoffAt ?? snapshot.cutoffAt, since = args.since ?? context.from;
    try {
      if (args.asset !== undefined && args.asset !== snapshot.asset || toEpoch(cutoffAt) > toEpoch(snapshot.cutoffAt) || toEpoch(since) < toEpoch(context.from) || toEpoch(since) > toEpoch(cutoffAt))
        return refuse(tradingIssue('TTRD1003', '/scope', 'Read arguments may only narrow the retained asset, cutoff and range'));
    } catch (cause) { return refuse(tradingIssue('TTRD1001', '/scope', 'Invalid read instant', cause)); }
    const range = { from: since, to: cutoffAt };
    let response: TradingProviderOutcome<Observation[]>;
    try {
      response = tool === 'bars-window' ? await providers.market.bars(snapshot.asset, range, cutoffAt)
        : tool === 'fundamentals-facts' ? await providers.fundamentals.facts(snapshot.asset, cutoffAt)
        : tool === 'news-items' ? await providers.news.items(snapshot.asset, range, cutoffAt)
        : tool === 'social-items' ? await providers.social.items(snapshot.asset, range, cutoffAt)
        : await providers.insiders.events(snapshot.asset, cutoffAt);
    } catch (cause) { return refuse(tradingIssue('TTRD1007', '/provider', 'Injected read provider failed', cause)); }
    const shaped = validateTradingShape<TradingProviderOutcome<Observation[]>>('tradingObservationProviderResult', response);
    if (!shaped.valid) return refuse(tradingIssue('TTRD1007', '/provider', 'Provider returned invalid content', shaped.issues[0]));
    response = shaped.value;
    if (response.outcome !== 'ok') return refuse(tradingIssue('TTRD1007', '/provider', response.reason, response.cause));
    // Providers may report ordinary future observations as withheld; retain those refusals.
    for (const withheld of response.refused) audit.refusals.push(immutableTradingJson(withheld.issue));
    const visible = roles.flatMap(role => context.projections[role].evidence), result: Observation[] = [];
    for (const observation of response.value) {
      const valid = await validateTradingRecord(observation); if (!valid.valid) return refuse(valid.issues[0]);
      const evidence = visible.find(e => e.id === observation.id && e.digest === observation.revision);
      if (!evidence || observation.asset !== snapshot.asset || observation.manifestId !== snapshot.manifestId || toEpoch(observation.availableAt) > toEpoch(cutoffAt) || toEpoch(observation.eventAt) > toEpoch(cutoffAt))
        return refuse(tradingIssue('TTRD1003', '/provider/value', 'Provider attempted to expand the retained role evidence'));
      if (toEpoch(observation.eventAt) >= toEpoch(since)) result.push(observation);
    }
    if (new Set(result.map(o => o.id)).size !== result.length) return refuse(tradingIssue('TTRD1004', '/provider/value', 'Provider repeated an evidence identity'));
    result.sort((a, b) => toEpoch(a.eventAt) - toEpoch(b.eventAt) || toEpoch(a.availableAt) - toEpoch(b.availableAt) || a.id.localeCompare(b.id));
    const narrowed = args.limit === undefined ? result : result.slice(-args.limit);
    audit.returned += narrowed.length;
    return immutableTradingJson({ asset: snapshot.asset, cutoffAt, observations: narrowed.map(observation => ({ id: observation.id, digest: observation.revision, observation })) });
  } };
  return { toolBindings, audit };
}
