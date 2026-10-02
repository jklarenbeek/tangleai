/** One projection from immutable analyst artifacts to the evidence visible to research. */
import { gmplTextDigest, type GmplEvidenceUnit, type GmplInput } from '@tangleai/gmpl';
import { immutableTradingJson } from './identity.ts';
import { validateTradingRecord } from './records.ts';
import { tradingRefuse, type TradingOutcome } from './errors.ts';
import { TRADING_ANALYST_ROLES } from './analysts.ts';
import type { AnalystReport, Artifact, MarketSnapshot, MarketSession, TradingRunManifest } from './contracts.gen.ts';

export async function checkTradingArtifactScope(input: readonly Artifact[], snapshot: MarketSnapshot): Promise<TradingOutcome<Artifact[]>> {
  let artifacts: Artifact[];
  try { artifacts = immutableTradingJson([...input]); snapshot = immutableTradingJson(snapshot); }
  catch (cause) { return tradingRefuse('TTRD1001', '/artifacts', 'Artifacts must be finite JSON', cause); }
  const validSnapshot = await validateTradingRecord(snapshot); if (!validSnapshot.valid) return validSnapshot;
  if (validSnapshot.value.kind !== 'snapshot') return tradingRefuse('TTRD1001', '/snapshot', 'Expected a market snapshot');
  if (new Set(artifacts.map(a => a.id)).size !== artifacts.length) return tradingRefuse('TTRD1004', '/artifacts', 'Artifact identities must be unique');
  for (const artifact of artifacts) {
    const valid = await validateTradingRecord(artifact); if (!valid.valid) return valid;
    if (artifact.manifestId !== snapshot.manifestId || artifact.snapshotId !== snapshot.id || artifact.key.manifestId !== snapshot.manifestId
      || artifact.key.asset !== snapshot.asset || artifact.key.sessionId !== snapshot.sessionId)
      return tradingRefuse('TTRD1004', '/artifacts', 'Artifact belongs to another decision snapshot');
    if (artifact.claims.some(c => c.citations.some(id => !artifact.citations.includes(id))))
      return tradingRefuse('TTRD1004', '/claims', 'Artifact claim cites undeclared evidence');
    if (artifact.kind === 'analyst-report' && artifact.citations.some(id => !snapshot.observationIds.includes(id)))
      return tradingRefuse('TTRD1004', '/citations', 'Analyst report cites information outside the admitted snapshot');
  }
  return { valid: true, value: artifacts };
}

export async function reportsToEvidence(input: readonly AnalystReport[]): Promise<TradingOutcome<GmplEvidenceUnit[]>> {
  let reports: AnalystReport[];
  try { reports = immutableTradingJson([...input]); }
  catch (cause) { return tradingRefuse('TTRD1001', '/reports', 'Reports must be finite JSON', cause); }
  const first = reports[0];
  if (reports.length !== TRADING_ANALYST_ROLES.length || new Set(reports.map(r => r.id)).size !== reports.length
    || TRADING_ANALYST_ROLES.some(role => reports.filter(r => r.role === `trading-analyst-${role}`).length !== 1))
    return tradingRefuse('TTRD1004', '/reports', 'Research requires one immutable report from every analyst');
  const units: GmplEvidenceUnit[] = [];
  for (const role of TRADING_ANALYST_ROLES) {
    const report = reports.find(r => r.role === `trading-analyst-${role}`)!;
    const valid = await validateTradingRecord(report); if (!valid.valid) return valid;
    if (report.kind !== 'analyst-report' || report.manifestId !== first.manifestId || report.snapshotId !== first.snapshotId
      || report.key.manifestId !== first.manifestId || report.key.asset !== first.key.asset || report.key.sessionId !== first.key.sessionId)
      return tradingRefuse('TTRD1004', '/reports', 'Research reports must share one asset, session and snapshot');
    for (const [i, finding] of report.claims.entries()) {
      if (finding.citations.some(id => !report.citations.includes(id))) return tradingRefuse('TTRD1004', '/claims', 'Finding cites undeclared report evidence');
      const text = `${finding.text}\nObservation ids: ${finding.citations.join(', ')}`;
      units.push({ id: `${report.id}:f${i + 1}`, text, digest: await gmplTextDigest(text) });
    }
  }
  return { valid: true, value: immutableTradingJson(units) };
}

export async function researchInput(input: { manifest: TradingRunManifest; asset: string; session: MarketSession; reports: readonly AnalystReport[] }): Promise<TradingOutcome<GmplInput>> {
  let content: typeof input;
  try { content = immutableTradingJson(input); }
  catch (cause) { return tradingRefuse('TTRD1001', '', 'Research input must be finite JSON', cause); }
  const { manifest, asset, session, reports } = content;
  for (const record of [manifest, session]) { const valid = await validateTradingRecord(record); if (!valid.valid) return valid; }
  if (!manifest.assets.includes(asset) || session.manifestId !== manifest.id || session.calendar !== manifest.calendar)
    return tradingRefuse('TTRD1003', '/session', 'Research session or asset is outside the manifest');
  const evidence = await reportsToEvidence(reports); if (!evidence.valid) return evidence;
  if (reports.some(r => r.manifestId !== manifest.id || r.key.asset !== asset || r.key.sessionId !== session.key))
    return tradingRefuse('TTRD1004', '/reports', 'Report scope differs from the research request');
  return { valid: true, value: immutableTradingJson({ caseId: `${manifest.id}/${encodeURIComponent(asset)}/${session.key}`,
    query: `Investment thesis for ${asset} as of ${session.closeAt}`, evidence: evidence.value }) };
}
