import { createGroundingStore, openTangleDb } from '@tangleai/store';
import { groundingStoreTests } from '../fixtures/grounding/store-probes.ts';
groundingStoreTests('SQLite grounding store', async applyProbe => {
    const db = await openTangleDb();
    return { store: createGroundingStore(db, { applyProbe }), close: () => db.close() };
});
