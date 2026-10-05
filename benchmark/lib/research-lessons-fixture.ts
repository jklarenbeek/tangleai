/** Authored lesson inputs share the research fixture's one byte inventory. */
import { canonicalSha256, canonicalizeJson } from '@jarenjs/json/canonical';
import { importBundle, draftsOf, sealSkillBundle, validateTrace2SkillShape, type SkillSnapshot } from '@tangleai/trace2skill';
import { validateClaimEvidence } from '@tangleai/context';
import { researchSchema, researchSchemaReferences, validateResearchShape, type ResearchLessonV2, type ResearchLessonScope } from '@tangleai/research';
import { runIdentitySchema } from '@tangleai/config';
import { createReportValidator } from './validate.ts';
import { RESEARCH_LESSONS_SCHEMA, RESEARCH_LESSON_NEGATIVES } from './research-lessons-schema.ts';
import { researchBytesSha256, type LoadedResearchFixture } from './research-fixture.ts';
import type { LessonRegistration } from './research-lessons.types.ts';

export const LESSON_FIXTURE_MANIFEST = 'lessons/manifest.json';
export interface LessonNegativeBundle {
  id: typeof RESEARCH_LESSON_NEGATIVES[number];
  expected: { code: string; cause: string | null };
  lesson: ResearchLessonV2;
  admittedOrigin: boolean;
  activeBundleHash: string;
  candidateUtilities: number[];
  baselineUtilities: number[];
  asyncValidator: boolean;
}
export interface LoadedLessonFixture {
  registration: LessonRegistration;
  revision: string;
  procedure: SkillSnapshot;
  beneficial: ResearchLessonV2;
  originBytes: Uint8Array;
  negative: LessonNegativeBundle[];
}
const scope: ResearchLessonScope = { domainProfileId: 'computational', taskFamily: 'registered-experiment' };
const expected = {
  poisoned: ['TRSH2007', 'OUTC1011'], volatile: ['TRSH2007', 'OUTC1011'],
  'cross-domain': ['TRSH2003', null], unsupported: ['TRSH2002', 'EVIDENCE_UNADMITTED'],
  'regression-inducing': ['TRSH2007', 'OUTC1011'], 'web-uncorroborated': ['TRSH2006', null],
  'leaked-origin': ['TRSH2005', null], 'active-edit-attempt': ['TRSH2007', null],
  'async-validator': ['TRSH2004', 'GUARDED'],
} as const;
const text = (value: unknown) => new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n');
const validator = (name: string) => createReportValidator({ $ref: RESEARCH_LESSONS_SCHEMA.$id + '#/$defs/' + name },
  [RESEARCH_LESSONS_SCHEMA, researchSchema, ...researchSchemaReferences, runIdentitySchema]);
const registrationValidator = validator('LessonRegistration'), manifestValidator = validator('LessonFixtureManifest'),
  negativeValidator = validator('LessonNegativeBundle');

/** Fixed bytes are generated before any lesson proposer is available. */
export async function researchLessonFixtureFiles(loaded: LoadedResearchFixture): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  const put = (path: string, value: unknown) => files.set('lessons/' + path, text(value));
  const root = '# Research procedure\n\n## Evidence\n\nRetain the complete experiment registry and every negative result.\n';
  const imported = await importBundle([{ path: 'SKILL.md', bytes: new TextEncoder().encode(root) }],
    { scopeKey: 'research-lessons/computational', mode: 'deepening', origin: 'human-import', status: 'staged' });
  if (!imported.valid) throw Error('Lesson procedure refused: ' + JSON.stringify(imported.issues));
  put('procedure.json', imported.value);
  const origin = { document: 'research-lesson-checked-failure', runId: 'lesson-origin-run', projectId: 'lesson-origin-project',
    topicId: 'lesson-training-unit-check', status: 'refused', code: 'TRSH1006',
    detail: 'A proposed metric had the wrong unit; the independent registry refused it.',
    expectedUnit: 'squared-distance', suppliedUnit: 'percent', authority: 'authored-verification-control' };
  put('origin.json', origin);
  const bytes = files.get('lessons/origin.json')!, digest = researchBytesSha256(bytes);
  const artifact = { id: 'art-' + digest, kind: 'verification', locator: 'research-artifact:' + digest, digest };
  const body: Omit<ResearchLessonV2, 'id' | 'revision'> = { schemaVersion: 2, parentId: null, projectId: origin.projectId,
    scope, origin: { kind: 'verification', runId: origin.runId, topicIds: [origin.topicId],
      topicContentHashes: [await canonicalSha256({ topic: origin.topicId, expectedUnit: origin.expectedUnit })],
      artifactIds: [artifact.id], hashes: [digest], envelope: { version: 1, artifacts: [artifact],
        evidence: [{ id: 'checked-unit-failure', artifact: artifact.id, selector: '/code', quote: origin.code }],
        claims: [{ id: 'unit-mismatch', text: origin.detail, critical: true, status: 'supported', evidence: ['checked-unit-failure'] }],
        visibleEvidence: ['checked-unit-failure'] } }, corroboration: null,
    proposal: { baseHash: imported.value.bundle.id, edit: { reasoning: 'Validate a metric against the registered unit before accepting its observation.',
      operations: [{ op: 'insert_after', path: 'SKILL.md', anchor: '## Evidence',
        content: '\nCheck the registered metric name, unit and direction before admitting any result.\n', group: 'metric-integrity' }] } },
    severity: 'high', validation: { state: 'proposed', validationRunIds: [], issues: [] },
    decay: { hypothesisId: 'none', observedAtRun: origin.runId, relevanceRows: [] }, promotion: null,
    recordedAt: '2026-01-01T00:00:00.000Z' };
  const seal = async (value: Omit<ResearchLessonV2, 'id' | 'revision'>): Promise<ResearchLessonV2> => {
    const revision = await canonicalSha256(value);
    const checked = validateResearchShape<ResearchLessonV2>('ResearchLessonV2', { ...value, id: revision, revision });
    if (!checked.valid) throw Error('Authored lesson shape refused: ' + JSON.stringify(checked.issues));
    return checked.value;
  };
  const beneficial = await seal(body); put('beneficial.json', beneficial);
  const registrationBody: Omit<LessonRegistration, 'revision'> = { id: 'research-lessons-v1',
    topics: loaded.topics.map(topic => ({ id: topic.id, sha256: researchBytesSha256(loaded.files.get('topics/' + topic.id + '.json')!) })),
    scope, seed: 17753, resamples: 2000, primary: 'claimSupport*registryAccuracy*preregistrationIntegrity',
    maxCalls: 128, maxTokens: 131072, maxPhysical: 128,
    decay: ['none', 'age-linear', 'severity-weighted-age'].map(id => ({ id: id as 'none' | 'age-linear' | 'severity-weighted-age', horizon: 4 })),
    negatives: RESEARCH_LESSON_NEGATIVES.map(id => ({ id, code: expected[id][0], cause: expected[id][1] })) };
  const registration: LessonRegistration = { ...registrationBody, revision: await canonicalSha256(registrationBody) };
  put('registration.json', registration);
  for (const id of RESEARCH_LESSON_NEGATIVES) {
    const altered = structuredClone(body);
    if (id === 'cross-domain') altered.scope = { ...scope, domainProfileId: 'foreign-profile' };
    if (id === 'web-uncorroborated') altered.origin.kind = 'retrieved-web';
    if (id === 'leaked-origin') { altered.origin.topicIds = [registration.topics[0].id]; altered.origin.topicContentHashes = [registration.topics[0].sha256]; }
    const bundle: LessonNegativeBundle = { id, expected: { code: expected[id][0], cause: expected[id][1] },
      lesson: await seal(altered), admittedOrigin: id !== 'unsupported',
      activeBundleHash: id === 'active-edit-attempt' ? await canonicalSha256('different-reviewed-procedure') : beneficial.proposal.baseHash,
      candidateUtilities: id === 'poisoned' ? [0, 0, 0] : id === 'regression-inducing' ? [0.5, 0, 0.5]
        : id === 'volatile' ? [1, 1, 0] : [1, 1, 1],
      baselineUtilities: [0.5, 0.5, 0.5], asyncValidator: id === 'async-validator' };
    put('negative/' + id + '.json', bundle);
  }
  const manifest = { document: 'research-lessons-fixture', license: 'MIT', authorship: 'Tangle-authored synthetic',
    census: { topics: registration.topics.length, lessons: 1, negatives: RESEARCH_LESSON_NEGATIVES.length, files: files.size },
    files: [...files].map(([path, bytes]) => ({ path: path.slice('lessons/'.length), sha256: researchBytesSha256(bytes) })).sort((a, b) => a.path.localeCompare(b.path)) };
  put('manifest.json', manifest);
  return files;
}

/** Root admission already refused symlinks and unregistered bytes; this checks the nested census. */
export async function loadResearchLessonFixture(loaded: LoadedResearchFixture): Promise<LoadedLessonFixture> {
  const parse = <T>(path: string): T => {
    const bytes = loaded.files.get('lessons/' + path);
    if (!bytes) throw Error('Unregistered lesson fixture: ' + path);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as T;
  };
  const manifest = parse<{ document: string; license: string; authorship: string; census: { topics: number; lessons: number; negatives: number; files: number };
    files: Array<{ path: string; sha256: string }> }>('manifest.json');
  if (!manifestValidator(manifest).valid || manifest.document !== 'research-lessons-fixture' || manifest.license !== 'MIT' || manifest.authorship !== 'Tangle-authored synthetic'
    || manifest.census.files !== manifest.files.length || manifest.census.topics !== 3 || manifest.census.lessons !== 1 || manifest.census.negatives !== 9)
    throw Error('Lesson licence or census drift.');
  const actual = [...loaded.files.keys()].filter(path => path.startsWith('lessons/') && path !== LESSON_FIXTURE_MANIFEST).sort();
  if (canonicalizeJson(actual) !== canonicalizeJson(manifest.files.map(file => 'lessons/' + file.path).sort())) throw Error('Lesson inventory drift.');
  for (const file of manifest.files) if (researchBytesSha256(loaded.files.get('lessons/' + file.path)!) !== file.sha256) throw Error('Lesson member drift: ' + file.path);
  const registration = parse<LessonRegistration>('registration.json');
  if (!registrationValidator(registration).valid) throw Error('Lesson registration shape refused.');
  const { revision, ...body } = registration;
  if (revision !== await canonicalSha256(body)) throw Error('Lesson registration revision drift.');
  if (canonicalizeJson(registration.topics.map(topic => topic.id)) !== canonicalizeJson(loaded.topics.map(topic => topic.id))) throw Error('Lesson topic census drift.');
  for (const topic of registration.topics) if (researchBytesSha256(loaded.files.get('topics/' + topic.id + '.json')!) !== topic.sha256) throw Error('Lesson held-out topic drift.');
  const procedure = parse<SkillSnapshot>('procedure.json');
  if (!procedure || !validateTrace2SkillShape('skillBundle', procedure.bundle).valid || !Array.isArray(procedure.files)
    || !procedure.files.every(file => validateTrace2SkillShape('skillFile', file).valid)) throw Error('Lesson procedure shape drift.');
  const sealed = await sealSkillBundle(draftsOf(procedure.files), { ...procedure.bundle });
  if (!sealed.valid || canonicalizeJson(sealed.value) !== canonicalizeJson(procedure)) throw Error('Lesson procedure content drift.');
  const beneficial = parse<ResearchLessonV2>('beneficial.json');
  const negative = RESEARCH_LESSON_NEGATIVES.map(id => parse<LessonNegativeBundle>('negative/' + id + '.json'));
  for (const lesson of [beneficial, ...negative.map(bundle => bundle.lesson)]) {
    if (!validateResearchShape('ResearchLessonV2', lesson).valid) throw Error('Lesson record shape drift.');
    const { id, revision, ...body } = lesson;
    if (id !== revision || revision !== await canonicalSha256(body) || lesson.proposal.baseHash !== procedure.bundle.id)
      throw Error('Lesson record content drift.');
  }
  for (const [index, bundle] of negative.entries()) {
    const registered = registration.negatives[index];
    if (!negativeValidator(bundle).valid || bundle.id !== RESEARCH_LESSON_NEGATIVES[index] || registered.id !== bundle.id
      || registered.code !== bundle.expected.code || registered.cause !== bundle.expected.cause) throw Error('Lesson negative census or expectation drift.');
  }
  const originBytes = loaded.files.get('lessons/origin.json')!, digest = researchBytesSha256(originBytes);
  const admitted = [{ id: 'art-' + digest, kind: 'verification', locator: 'research-artifact:' + digest, digest }];
  for (const lesson of [beneficial, ...negative.map(bundle => bundle.lesson)]) {
    if (!validateClaimEvidence(lesson.origin.envelope, { artifacts: admitted }).valid
      || canonicalizeJson(lesson.origin.artifactIds) !== canonicalizeJson(admitted.map(artifact => artifact.id))
      || canonicalizeJson(lesson.origin.hashes) !== canonicalizeJson([digest])) throw Error('Lesson origin byte binding drift.');
  }
  return { registration, revision: await canonicalSha256(manifest), procedure, beneficial, originBytes, negative };
}
