import { createExperientialMemoryPersistence, createExperientialStoreAdapter } from '@tangleai/experiential';
import { EXPERIENTIAL_FIXTURE_TIME, type ExperientialProbeHost } from './store-fixtures.ts';

export async function createExperientialMemoryProbe(): Promise<ExperientialProbeHost> {
  let host: ExperientialProbeHost;
  const applyProbe = (step: string) => { if (host?.failAt === step && --host.failOccurrence === 0) throw new Error('Injected transaction failure.'); };
  let persistence = createExperientialMemoryPersistence({ applyProbe });
  const options = { now: () => EXPERIENTIAL_FIXTURE_TIME };
  host = {
    store: createExperientialStoreAdapter(persistence, options), peer: createExperientialStoreAdapter(persistence, options),
    persistence, failAt: null, failOccurrence: 1,
    state: async () => persistence.exportState(),
    async reopen() {
      const state = persistence.exportState(); await persistence.close();
      persistence = createExperientialMemoryPersistence({ state, applyProbe }); host.persistence = persistence;
      host.store = createExperientialStoreAdapter(persistence, options); host.peer = createExperientialStoreAdapter(persistence, options);
    },
    close: () => persistence.close(),
  };
  return host;
}
