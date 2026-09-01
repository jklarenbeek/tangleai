/**
 * The imperative pen and the declarative loader meet at one canonical
 * IR: an independent imperative construction of the weekly report has
 * the same semantic canonical bytes and the same versionId as the
 * committed declarative fixture, with source provenance the only
 * (unhashed) difference — and it validates and lowers to the same
 * executable revision.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { canonicalizeJson } from '@jarenjs/json/canonical';
import {
  agentInvocation,
  createMasConfigCatalog,
  createMasRegistrySnapshot,
  defineMasWorkflow,
  masMessage,
  planMasWorkflow,
  validateMasWorkflow,
  type JsonSchema,
} from '@tangleai/mas';

const manifest = JSON.parse(await readFile('benchmark/fixtures/mas/manifest.json', 'utf8')) as {
  registry: { path: string, revision: string },
  configCatalog: { path: string, revision: string },
};
const registryDoc = JSON.parse(await readFile(manifest.registry.path, 'utf8')) as {
  roles: Array<{ id: string, instructionsRevision: string }>,
};
const catalogDoc = JSON.parse(await readFile(manifest.configCatalog.path, 'utf8')) as Record<string, unknown>;
const declarative = (JSON.parse(await readFile('benchmark/fixtures/mas/positive/weekly-report-manual.json', 'utf8')) as {
  workflow: Record<string, unknown>,
}).workflow;

const instructionsOf = new Map(registryDoc.roles.map((role) => [role.id, role.instructionsRevision]));

const STR: JsonSchema = { type: 'string' };
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
  type: 'object',
  required: Object.keys(properties),
  properties,
  additionalProperties: false,
});
const arr = (items: JsonSchema): JsonSchema => ({ type: 'array', items });

describe('declarative and imperative weekly-report sources are one version', () => {
  const findings = obj({ findings: arr(STR) });
  const metrics = obj({ metrics: arr(STR) });
  const risks = obj({ risks: arr(STR) });
  const report = obj({ title: STR, sections: arr(STR) });
  const draftUnion: JsonSchema = { anyOf: [findings, metrics, risks] };

  const buildImperative = () => defineMasWorkflow({
    workflowId: 'wf-weekly-report',
    title: 'Weekly report',
    description: 'Three drafting agents run concurrently over one brief; the writer receives their validated structured results in declared edge order and finalizes the report.',
    author: 'imperative-twin',
    input: obj({ brief: STR }),
    output: obj({ report }),
    entry: [
      { port: 'brief', to: { node: 'researcher', port: 'brief' } },
      { port: 'brief', to: { node: 'data-analyst', port: 'brief' } },
      { port: 'brief', to: { node: 'market-analyst', port: 'brief' } },
    ],
    exit: [{ port: 'report', from: { node: 'writer', port: 'report' } }],
    nodes: [
      agentInvocation({
        id: 'researcher',
        role: 'drafter-research',
        profile: 'scripted',
        instructionsRevision: instructionsOf.get('drafter-research') as string,
        tools: ['fetch-metrics'],
        messageAdapter: 'markdown-sections',
        input: { brief: STR },
        output: { findings },
      }),
      agentInvocation({
        id: 'data-analyst',
        role: 'drafter-data',
        profile: 'scripted',
        instructionsRevision: instructionsOf.get('drafter-data') as string,
        tools: ['fetch-metrics'],
        messageAdapter: 'markdown-sections',
        input: { brief: STR },
        output: { metrics },
      }),
      agentInvocation({
        id: 'market-analyst',
        role: 'drafter-market',
        profile: 'scripted',
        instructionsRevision: instructionsOf.get('drafter-market') as string,
        tools: ['fetch-metrics'],
        messageAdapter: 'markdown-sections',
        input: { brief: STR },
        output: { risks },
      }),
      agentInvocation({
        id: 'writer',
        role: 'report-writer',
        profile: 'scripted',
        instructionsRevision: instructionsOf.get('report-writer') as string,
        context: ['memory'],
        messageAdapter: 'markdown-sections',
        input: { drafts: arr(draftUnion) },
        output: { report },
      }),
    ],
    messages: [
      masMessage(['researcher', 'findings'], ['writer', 'drafts'], { aggregation: 'ordered-list', adapter: 'markdown-sections' }),
      masMessage(['data-analyst', 'metrics'], ['writer', 'drafts'], { aggregation: 'ordered-list', adapter: 'markdown-sections' }),
      masMessage(['market-analyst', 'risks'], ['writer', 'drafts'], { aggregation: 'ordered-list', adapter: 'markdown-sections' }),
    ],
    registryRevision: manifest.registry.revision,
    configRegistryRevision: manifest.configCatalog.revision,
    profile: 'scripted',
  });

  it('hashes to the same semantic version with byte-equal canonical payloads', async () => {
    const imperative = await buildImperative();
    assert.equal(imperative.versionId, declarative.versionId, 'one semantic version');
    const semantic = (workflow: Record<string, unknown>): string => {
      const { versionId: _v, provenance: _p, compile: _c, ...payload } = workflow;
      return canonicalizeJson(payload);
    };
    assert.equal(semantic(imperative as unknown as Record<string, unknown>), semantic(declarative), 'byte-equal canonical semantic payloads');
    assert.equal(imperative.compile.sourceMode, 'imperative');
    assert.equal((declarative.compile as { sourceMode: string }).sourceMode, 'declarative');
    assert.notEqual(imperative.provenance.author, (declarative.provenance as { author: string }).author, 'provenance may differ without moving the version');
  });

  it('validates and lowers to the same executable revision as the declarative source', async () => {
    const snapshot = await createMasRegistrySnapshot(JSON.parse(await readFile(manifest.registry.path, 'utf8')));
    const catalog = await createMasConfigCatalog(catalogDoc);
    assert.ok(snapshot.valid && catalog.valid);
    const imperative = await buildImperative();
    const validatedImperative = await validateMasWorkflow(imperative, snapshot.value, catalog.value);
    const validatedDeclarative = await validateMasWorkflow(declarative, snapshot.value, catalog.value);
    assert.ok(validatedImperative.valid, JSON.stringify(!validatedImperative.valid ? validatedImperative.issues[0] : null));
    assert.ok(validatedDeclarative.valid);
    const planImperative = await planMasWorkflow(validatedImperative.value);
    const planDeclarative = await planMasWorkflow(validatedDeclarative.value);
    assert.ok(planImperative.valid && planDeclarative.valid);
    assert.equal(planImperative.value.executableRevision, planDeclarative.value.executableRevision, 'one executable revision');
  });

  it('is deeply frozen on emit', async () => {
    const imperative = await buildImperative();
    assert.ok(Object.isFrozen(imperative));
    assert.ok(Object.isFrozen(imperative.nodes[0]));
  });
});
