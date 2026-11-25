/**
 * Jobs' "What will happen" on the Pages desktop: the host's registered jobs and
 * schedules rebuilt into a registry, simulated in a worker of its own (started
 * for one answer, then ended), never on the host's or the browser twin's store.
 */
import { registryFromHost } from '@tangleai/ops/simulate';
import type { JobsSimulation } from '@tangleai/os';

export function pagesSimulate(workerUrl: URL, options: { zone?: string, timeoutMs?: number } = {}) {
  return async (input: { registry: any[], schedules: any[], days: number, failRate: number }): Promise<JobsSimulation> => {
    const { registry, left } = registryFromHost(input.registry, input.schedules, options.zone);
    const worker = new Worker(workerUrl, { type: 'module' });
    try {
      const answer: any = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('the simulation took too long')), options.timeoutMs ?? 180_000);
        worker.onmessage = (event) => { clearTimeout(timer); resolve(event.data); };
        worker.onerror = (event) => { clearTimeout(timer); reject(new Error(event.message || 'the simulation worker failed')); };
        worker.postMessage({ registry, days: input.days, failRate: input.failRate, seed: 1, from: Date.now() });
      });
      if (!answer?.ok) throw new Error(answer?.message ?? 'the simulation failed');
      return { ...answer.simulation, left };
    } finally { worker.terminate(); }
  };
}
