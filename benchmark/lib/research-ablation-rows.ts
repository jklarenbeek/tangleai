/** Project measured scopes without manufacturing missing validity denominators. */
import { canonicalSha256 } from '@jarenjs/json/canonical';
import type { ResearchCost } from '@tangleai/research';
import type { LoadedResearchFixture } from './research-fixture.ts';
import type { ResearchReport } from './research.types.ts';
import type { ResearchAblationRow, ResearchAblationTopic } from './research-ablation.types.ts';

export type ResearchAblationInput = Pick<ResearchReport, 'registration' | 'identity' | 'rows' | 'lessons' | 'domains'>;
const zero = (): ResearchCost => ({ calls: 0, tokens: 0, ms: 0, physical: 0 });
const cost = (value: ResearchCost): ResearchCost => ({ calls: value.calls, tokens: value.tokens, ms: value.ms, physical: value.physical });
const unknownBudget = () => ({ calls: null, tokens: null, ms: null, physical: null });
const unique = (values: number[]) => [...new Set(values)].sort((a, b) => a - b);

/** These are retained manifest fields, never the current prompt catalog substituted for a past run. */
function promptRevisions(value: unknown): string[] {
  const values = new Set<string>();
  const visit = (item: unknown): void => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    for (const [key, member] of Object.entries(item)) {
      if (key === 'promptRevision' && typeof member === 'string' && /^[a-f0-9]{64}$/.test(member)) values.add(member);
      else visit(member);
    }
  };
  visit(value);
  return [...values].sort();
}
function topic(id: string, hash: string, seeds: number[], source: string, claimSupport: number | null,
  registryAccuracy: number | null, preregistrationIntegrity: number | null, completion: boolean | null): ResearchAblationTopic {
  return { id, hash, seeds, source, claimSupport, registryAccuracy, preregistrationIntegrity, completion,
    primary: claimSupport === null || registryAccuracy === null || preregistrationIntegrity === null ? null
      : claimSupport * (registryAccuracy * preregistrationIntegrity) };
}
function empty(id: string, family: ResearchAblationRow['family'], source: string): ResearchAblationRow {
  return { id, family, state: 'not-run', scope: 'unmeasured', topics: [], identityStatus: 'not-run', identityId: null,
    comparisonIdentity: null, promptRevisions: [], budget: unknownBudget(), spend: zero(), safetyRefusals: 0,
    outcomeEligible: false, refusals: [], provenance: [source], limitations: [] };
}

export async function researchAblationRows(input: ResearchAblationInput, loaded: LoadedResearchFixture): Promise<ResearchAblationRow[]> {
  const rows: ResearchAblationRow[] = [];
  const original = (id: string) => {
    const registered = loaded.manifest.topics.find(t => t.id === id);
    const definition = loaded.topics.find(t => t.id === id);
    const member = loaded.manifest.members.find(m => m.path === registered?.path);
    if (!definition || !member) throw Error('Unregistered ablation topic: ' + id);
    return { hash: member.sha256, seeds: definition.contract.replicatePolicy.seeds };
  };
  for (const [index, measured] of input.rows.entries()) {
    const source = '/rows/' + index, row = empty(measured.id, 'core', source);
    const identity = input.identity.rows.find(value => value.rowId === measured.id)!;
    row.identityStatus = identity.identityStatus;
    row.identityId = 'identityId' in identity ? identity.identityId : null;
    if (measured.state !== 'measured') { row.state = measured.state; row.refusals = [measured.reason]; rows.push(row); continue; }
    row.state = 'measured'; row.scope = measured.scope; row.spend = cost(measured.cost);
    row.budget = { calls: input.registration.caps.calls * measured.topics.length,
      tokens: input.registration.caps.tokens * measured.topics.length, ms: input.registration.caps.ms * measured.topics.length, physical: null };
    row.promptRevisions = promptRevisions(measured.topics);
    row.comparisonIdentity = await canonicalSha256({ registration: input.registration.revision, scope: measured.scope,
      identityStatus: row.identityStatus, identityId: row.identityId });
    row.safetyRefusals = measured.failures.leakage;
    row.limitations = ['Core caps are per topic; no independent physical-run bound is registered in this report.',
      'Only independently measured claim support, registry accuracy and preregistration integrity contribute to the primary.'];
    row.topics = measured.topics.map((t, i) => {
      const registered = original(t.topicId);
      const contract = 'contract' in t ? t.contract : 'bundle' in t && t.bundle
        ? 'contract' in t.bundle ? t.bundle.contract : t.bundle.source.inputs.contract : null;
      return topic(t.topicId, registered.hash, contract?.replicatePolicy.seeds ?? [], source + '/topics/' + i,
        'claimSupport' in t ? t.claimSupport.value : null, 'registryAccuracy' in t ? t.registryAccuracy.value : null,
        'preregistrationIntegrity' in t ? t.preregistrationIntegrity.value : null,
        'completion' in t ? t.completion.value === 1 : null);
    });
    rows.push(row);
  }
  for (const [index, measured] of input.lessons.rows.entries()) {
    const source = '/lessons/rows/' + index, row = empty(measured.id, 'lessons', source);
    row.state = measured.state; row.scope = measured.scope.domainProfileId + '/' + measured.scope.taskFamily;
    row.identityStatus = measured.identityStatus; row.comparisonIdentity = measured.comparisonIdentity;
    const registeredPrompt = loaded.manifest.members.find(m => m.path === 'prompts/fixture-writer.json');
    row.promptRevisions = registeredPrompt ? [registeredPrompt.sha256] : [];
    row.provenance.push('/lessons/registration', '/lessons/identity');
    row.budget = { calls: input.lessons.registration.maxCalls, tokens: input.lessons.registration.maxTokens,
      physical: input.lessons.registration.maxPhysical, ms: null };
    row.spend = cost(measured.spend); row.outcomeEligible = measured.native?.evaluationId !== null
      && measured.native !== null && measured.eligibilityIssues.length === 0 && measured.native.code === null;
    row.safetyRefusals = measured.counts.leaked;
    row.refusals = measured.refusals.map(value => value.code + (value.cause ? ':' + value.cause : '') + ' (' + value.count + ')');
    if (measured.reason) row.refusals.push(measured.reason);
    row.limitations = ['Pure-program analytic scoring has no provider identity. Scripted proposer spend is retained separately in the source row.',
      'No wall-time bound is registered for this family; a missing bound cannot qualify activation.'];
    row.topics = measured.topics.map((t, i) => topic(t.topicId, t.topicHash, original(t.topicId).seeds,
      source + '/topics/' + i, t.output.claimSupport, t.output.registryAccuracy, t.output.preregistrationIntegrity, t.completion));
    rows.push(row);
  }
  for (const [index, measured] of input.domains.rows.entries()) {
    const source = '/domains/rows/' + index, row = empty(measured.id, 'domain', source);
    const identity = input.domains.identity.rows.find(value => value.rowId === measured.id)!;
    row.state = 'measured'; row.scope = measured.profileId + '/metric-lifecycle'; row.identityStatus = measured.identityStatus;
    row.identityId = 'identityId' in identity ? identity.identityId : null; row.comparisonIdentity = measured.comparisonIdentity;
    row.promptRevisions = promptRevisions(measured.topics); row.budget = { ...measured.budget }; row.spend = cost(measured.spend);
    row.outcomeEligible = measured.lesson !== null && measured.lesson.evaluationId !== null && measured.lesson.code === null
      && measured.eligibilityIssues.length === 0;
    row.refusals = [...measured.eligibilityIssues, ...(measured.lesson?.code ? [measured.lesson.code] : [])];
    row.limitations = [...measured.limitations]; row.provenance.push('/domains/identity', '/domains/profiles');
    row.topics = measured.topics.map((t, i) => topic(t.topicId, t.topicHash, unique(t.lifecycle.runs.map(run => run.seed)),
      source + '/topics/' + i, t.claimSupport, t.registryAccuracy, t.preregistrationIntegrity, t.lifecycle.status === 'completed'));
    rows.push(row);
  }
  const unsupported = empty(input.domains.unsupported.id, 'probe', '/domains/unsupported');
  unsupported.state = 'refused'; unsupported.scope = 'capability-binding'; unsupported.refusals = [input.domains.unsupported.code];
  const parity = empty(input.domains.parity.id, 'probe', '/domains/parity');
  parity.state = 'measured'; parity.scope = 'control-plane-source'; parity.comparisonIdentity = input.domains.parity.sourceHash;
  parity.limitations = ['Source parity does not establish equal scientific outcomes across different topic sets.'];
  const external = empty(input.domains.external.id, 'external', '/domains/external');
  external.refusals = [input.domains.external.reason, ...input.domains.external.issues.map(issue => issue.code)];
  external.limitations = ['No licensed pinned external slice executed; no external comparison or transfer claim exists.'];
  return [...rows, unsupported, parity, external];
}
