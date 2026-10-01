import { createMemoryGroundingStore } from '@tangleai/grounding';
import { groundingStoreTests } from '../fixtures/grounding/store-probes.ts';
groundingStoreTests('memory grounding store', async applyProbe => ({ store: createMemoryGroundingStore({ applyProbe }), async close() {} }));
