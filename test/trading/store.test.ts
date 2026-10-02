import { createMemoryTradingStore } from '@tangleai/trading';
import { qualifyTradingStore } from './store-harness.ts';
qualifyTradingStore('the atomic in-memory trading store', async options => ({ store: createMemoryTradingStore(options), close: async () => {} }));
