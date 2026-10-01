import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { evaluateProfileRules, loadGroundingProfile, profileRevisionOf } from '@tangleai/grounding';
import document from '@tangleai/grounding/profiles/priha-hk' with { type: 'json' };
import minimalDocument from '../fixtures/grounding/profile-minimal.json' with { type: 'json' };
import { contractProfile } from '../../benchmark/lib/priha-contracts.ts';

describe('grounding profiles as data', () => {
    it('pins canonical revisions and refuses drift or overlapping rule identities', async () => {
        const profile = await contractProfile();
        assert.equal(profile.revision, await profileRevisionOf(profile));
        const registered = JSON.parse(await readFile('benchmark/fixtures/priha/manifest.json', 'utf8'));
        assert.equal(profile.revision, registered.profileRevision);
        assert.ok(Object.isFrozen(profile.authority.hosts));
        const drift = { ...document, jurisdiction: document.jurisdiction + ' edited' };
        assert.notEqual(await profileRevisionOf(drift), profile.revision);
        const bad = await loadGroundingProfile(drift); assert.equal(bad.valid, false); assert.equal(bad.issues[0].code, 'TGRD1002');
        const duplicate = structuredClone(profile); duplicate.expansions.push(duplicate.expansions[0]); duplicate.revision = await profileRevisionOf(duplicate);
        assert.equal((await loadGroundingProfile(duplicate)).valid, false);
        const blank = structuredClone(profile); blank.emergency.patterns = ['　']; blank.revision = await profileRevisionOf(blank);
        assert.equal((await loadGroundingProfile(blank)).valid, false);
    });
    it('evaluates fixture rules with NFKC and Unicode word boundaries', async () => {
        const profile = await contractProfile();
        assert.equal(evaluateProfileRules(profile, { text: 'This is the fictional emergency test phrase RED FLAG.' }).emergency, 'emergency-route');
        assert.equal(evaluateProfileRules(profile, { text: 'ＲＥＤ ＦＬＡＧ' }).emergency, 'emergency-route');
        assert.equal(evaluateProfileRules(profile, { text: 'red flagging and pred flag' }).emergency, null);
        assert.equal(evaluateProfileRules(profile, { text: 'Tell me a medication dosage.' }).outOfScope, 'out-of-scope-dosage');
        assert.equal(evaluateProfileRules(profile, { text: 'dosageadjustment' }).outOfScope, null);
        const expansion = evaluateProfileRules(profile, { text: 'Local information first', intents: ['care-navigation'] }).expansions;
        assert.equal(expansion[0].ruleId, 'community-first');
        assert.match(expansion[0].queries.join(' '), /community health centre/); assert.match(expansion[0].queries.join(' '), /district health centre/);
    });
    it('resolves exact hosts and path boundaries with unknown authority as null', async () => {
        const authority = evaluateProfileRules(await contractProfile(), { text: '' }).authorityOf;
        assert.equal(authority('https://official.harbour.example/directory')!.tier, 'official');
        for (const url of ['https://unknown.example', 'https://official.harbour.example.evil.example', 'https://evil.official.harbour.example', 'https://secret@official.harbour.example', 'file:///directory', 'https://search.harbour.example/searching', 'https://official.harbour.example:444/directory']) assert.equal(authority(url), null, url);
        assert.equal(authority('https://search.harbour.example/search?q=directory')!.tier, 'unverified');
    });
    it('executes a second jurisdiction with no profile literals in generic source', async () => {
        const minimal = await loadGroundingProfile(minimalDocument); assert.ok(minimal.valid);
        assert.equal(evaluateProfileRules(minimal.value, { text: 'urgent fixture signal' }).emergency, 'emergency-route');
        assert.equal(evaluateProfileRules(minimal.value, { text: 'restricted action' }).outOfScope, 'restricted-action');
        assert.equal(evaluateProfileRules(minimal.value, { text: '', intents: ['information'] }).expansions[0].ruleId, 'local-first');
        for (const name of await readdir('packages/grounding/src')) if (name.endsWith('.ts')) assert.doesNotMatch(await readFile('packages/grounding/src/' + name, 'utf8'), /Hong Kong|priha-hk/, name);
    });
});
