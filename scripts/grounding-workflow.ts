/** A reproducible inspection document; the host specializes its immutable session binding. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createGroundingWorkflow, loadGroundingProfile } from '@tangleai/grounding';
import profileDocument from '../packages/grounding/profiles/priha-hk.json' with { type: 'json' };
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--check') || args.length > 1) throw Error('usage: grounding-workflow.ts [--check]');
const profile = await loadGroundingProfile(profileDocument); if (!profile.valid) throw Error(JSON.stringify(profile.issues));
const value = await createGroundingWorkflow({ profile: profile.value, caseId: 'grounding-template', factVocabulary: [],
    currentOptimization: async () => { throw Error('The inspection document has no running session.'); } });
const path = 'workflows/grounding-session.json', bytes = JSON.stringify(value.workflow, null, 2) + '\n';
if (args.includes('--check')) { if (await readFile(path, 'utf8') !== bytes) throw Error('Grounding workflow drift.'); }
else { await mkdir('workflows', { recursive: true }); await writeFile(path, bytes); }
console.log(`Grounding workflow ${value.workflow.versionId}; ${value.workflow.nodes.length} root nodes, ${value.snapshot.subgraphs.size} child graphs.`);
