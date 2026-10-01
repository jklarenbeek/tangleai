import { it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHashEmbedder } from '@tangleai/models/embed';
import { loadGroundingFixture } from '../../benchmark/lib/grounding.ts';
import { buildFixtureCorpus } from '../../benchmark/lib/grounding-run.ts';

it('a fixture read failure closes the database before returning the original error', async () => {
    const loaded = await loadGroundingFixture(), directory = await mkdtemp(join(tmpdir(), 'tangle-grounding-missing-'));
    const prepare = DatabaseSync.prototype.prepare, close = DatabaseSync.prototype.close;
    const open = new Set<DatabaseSync>(); let closed = 0;
    DatabaseSync.prototype.prepare = function (sql: string) { open.add(this); return prepare.call(this, sql); };
    DatabaseSync.prototype.close = function () { open.delete(this); closed++; return close.call(this); };
    try {
        await assert.rejects(() => buildFixtureCorpus(loaded.fixture, createHashEmbedder(), directory), { code: 'ENOENT' });
        assert.equal(closed, 1); assert.equal(open.size, 0);
    } finally {
        DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.close = close;
        for (const db of open) close.call(db);
        await rm(directory, { recursive: true, force: true });
    }
});
