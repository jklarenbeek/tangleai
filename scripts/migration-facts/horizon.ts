import { readFileSync } from 'node:fs';
const data = (name: any) => JSON.parse(readFileSync(new URL((name === 'long-horizon' ? '../../benchmark/jaren-long-horizon.json' : '../../benchmark/historical/' + name + '.json'), import.meta.url), 'utf8'));
/**
 * One row of the long-horizon suite. The suite is a grid — task ×
 * compaction variant × payload shape × history budget — so every quoted
 * number has to name all four coordinates or it is quoting whichever row
 * happened to sort first.
 */
function horizonRow(at: {
  variant: string;
  shape: string;
  budget: number;
  task?: string;
}) {
  const row = data('long-horizon').rows.find((r: any) => r.variant === at.variant
    && r.shape === at.shape && r.budget === at.budget && r.task === (at.task ?? 'needle'));
  if (row === undefined) {
    throw new Error(`long-horizon.json has no ${at.variant}/${at.shape} row at budget ${at.budget}`
      + ' — regenerate it before quoting one');
  }
  return row;
}

/** Every row that actually compacted something, for one variant/task. */
const horizonCompacting = (variant: any, task = 'needle') => data('long-horizon').rows
  .filter((r: any) => r.variant === variant && r.task === task && r.compacted);

export const horizonFacts = {
  name: 'historical horizon and retrieval measurements', docs: () => ['benchmark/MIGRATED-JAREN.md', 'docs/AI-MECHANISM-ROADMAP.md', 'packages/models/README.md', 'packages/context/README.md', 'packages/agents/README.md', 'packages/jaren/README.md', 'packages/jaren/docs/AUTHORING.md'], facts: () => ({
    'horizon.measured': () => {
      const meta = data('long-horizon').meta;
      return `${String(meta.date).slice(0, 10)}, Node ${meta.node}, ${meta.n} tool rounds`;
    },
    'horizon.synopsisGap': () => {
      const row = horizonRow({ variant: 'synopsis', shape: 'late', budget: 6000 });
      return `${row.idPresent} of ${row.n} record ids and ${row.valuePresent} of their ${row.n} values`;
    },
    'horizon.ledgerRecovered': () => {
      const row = horizonRow({ variant: 'ledger', shape: 'late', budget: 6000 });
      return `${row.valueRecoverable} of ${row.n}`;
    },
    'horizon.synopsisBand': () => {
      const kept = horizonCompacting('synopsis')
        .filter((r: any) => r.shape === 'late')
        .map((r: any) => r.valuePresent);
      return `${Math.min(...kept)} to ${Math.max(...kept)}`;
    },
    'horizon.pairwise': () => {
      const rows = data('long-horizon').rows.filter((r: any) => r.task === 'pairwise' && r.compacted);
      const determined = rows.filter((r: any) => r.ceiling > 0);
      return determined.length === 0
        ? '0% at every budget that compacts anything, with a ledger or without'
        : `0% at every budget that compacts anything except ${determined
          .map((r: any) => `${r.variant}/${r.shape} at ${r.budget}`).join(', ')}`;
    },
    'horizon.program': () => {
      const row = data('long-horizon').rows
        .find((r: any) => r.variant === 'program' && r.task === 'pairwise' && r.shape === 'late');
      if (row === undefined) throw new Error('long-horizon.json has no program/pairwise/late row');
      return `${(row.ceiling * 100).toFixed(0)}%, with ${row.valuePresent} of ${row.n} records`
        + ` reaching the reduce over ${row.subcalls} sub-calls, while the root request carried`
        + ` ${row.charsSent} characters against a corpus of ${row.charsFull}`;
    },
    'horizon.programFanout': () => {
      const s = data('long-horizon').meta.scheduling;
      if (s === undefined || s === null) throw new Error('long-horizon.json has no scheduling block');
      return `${(s.sequential.ms / s.parallel.ms).toFixed(1)}x (${s.sequential.ms}ms sequential vs`
        + ` ${s.parallel.ms}ms at concurrency ${s.parallel.concurrency}, ${s.parallel.subcalls}`
        + ` sub-calls of ${s.delayMs}ms each)`;
    },
    'horizon.programLive': () => {
      const a = data('long-horizon').meta.authoring;
      if (a === null || a === undefined) return 'no live model ran on the machine that generated this file';
      // a timed-out attempt is NOT a rejected program, and reporting the
      // two together would read as "the tier cannot author" when what the
      // run measured was the transport giving up. The distinction is the
      // whole point of publishing this number, so the count is split.
      const timedOut = a.errors.filter((e: any) => /timeout/i.test(e)).length;
      const returned = a.trials - timedOut;
      const authored = `${a.compiled} of ${a.trials} authored programs compiled`
        + (timedOut === 0
          ? ` (${a.generations} generation(s) including repairs)`
          : ` — but ${timedOut} of those attempts never came back at all (the 300 s deadline),`
          + ` so of the ${returned} that answered, ${a.compiled} compiled`);
      return a.valuesReached === null
        ? `${authored}; the piece work was not run within the spend guard`
        : `${authored}. Answering ${a.subcalls} sub-calls itself it reached ${a.valuesReached}`
        + ` of 40 records (${a.subcallsFailed} sub-call(s) failed) and named the`
        + ` ${a.scored ? 'CORRECT' : 'wrong'} pair`;
    },
    'horizon.campaign': () => {
      const rows = data('long-horizon').rows;
      const at = (variant: any, task: any, budget: any) => rows.find((r: any) => r.variant === variant
        && r.task === task && r.shape === 'late' && r.budget === budget);
      const pct = (x: any) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)}%`);
      const budget = 6000;

      const lossy = at('synopsis', 'needle', budget);
      const ledger = at('ledger', 'needle', budget);
      const program = at('program', 'pairwise', null);
      const programNeedle = at('program', 'needle', null);
      if (lossy === undefined || ledger === undefined || program === undefined) {
        throw new Error('long-horizon.json is missing a configuration the campaign table names');
      }

      return ['',
        '| configuration | needle | pairwise | what it cost the request |',
        '| --- | --- | --- | --- |',
        `| compaction alone (budget ${budget}) | ${pct(lossy.ceiling)} | ${pct(lossy.ceiling === null ? null : 0)}`
        + ` | ${lossy.charsSent} chars |`,
        `| + a ledger (same budget) | ${pct(ledger.ceilingRecall)} via recall | ${pct(0)}`
        + ` | ${ledger.charsSent} chars |`,
        `| + the environment and a program | ${pct(programNeedle?.ceiling)} | ${pct(program.ceiling)}`
        + ` | ${program.charsSent} chars, against a ${program.charsFull}-char corpus |`,
        ''].join('\n');
    },
    'horizon.depthLive': () => {
      const depths = data('long-horizon').meta.authoring?.depths;
      if (depths === null || depths === undefined) {
        return 'no live model ran on the machine that generated this file';
      }
      const tasks = depths.reduce((n: any, row: any) => n + row.tasks, 0);
      const correct = depths.reduce((n: any, row: any) => n + row.correct, 0);
      const calls = depths.reduce((n: any, row: any) => n + row.calls, 0);
      const authored = depths.reduce((n: any, row: any) => n + row.authored.total, 0);
      const compiled = depths.reduce((n: any, row: any) => n + row.authored.compiled, 0);
      const timeouts = depths.reduce((n: any, row: any) =>
        n + row.errors.filter((e: any) => /timeout/i.test(e)).length, 0);
      const levels = depths.map((row: any) => row.depth).join(' and ');

      if (calls === 0 && timeouts > 0) {
        return `${correct} of ${tasks} tasks at depths ${levels} — every one of them died on the`
          + ' 300-second deadline during its first authoring call, so what this measured is that'
          + ' the recursive path does not currently RUN on this tier, not that it runs badly';
      }
      return `${correct} of ${tasks} tasks answered at depths ${levels}, ${compiled} of ${authored}`
        + ` authored programs compiled, over ${calls} model call(s)`
        + (timeouts === 0 ? '' : ` (${timeouts} attempt(s) lost to the 300-second deadline)`);
    },
    'horizon.liveNeedle': () => {
      const rows = data('long-horizon').rows
        .filter((r: any) => r.task === 'needle' && r.shape === 'late' && r.compacted);
      const budgets = [...new Set(rows.map((r: any) => r.budget))].sort((a: any, b: any) => b - a);
      const cell = (row: any) => (row === undefined || row.actual === null
        ? '—'
        : `${(row.actual * 100).toFixed(1)}%`);
      const body = budgets.map((budget: any) => {
        const lossy = rows.find((r: any) => r.budget === budget && r.variant === 'synopsis');
        const ledger = rows.find((r: any) => r.budget === budget && r.variant === 'ledger');
        return `| ${budget} | ${cell(lossy)} | ${cell(ledger)} | ${ledger?.recalls ?? 0} |`;
      });
      return ['', '| history budget | without a ledger | with a ledger | recall calls |',
        '| --- | --- | --- | --- |', ...body, ''].join('\n');
    },
    'horizon.live': () => {
      const meta = data('long-horizon').meta;
      return meta.model === null
        ? 'no live model ran on the machine that generated this file'
        : `${meta.model}, ${meta.trials} trial(s) per row, ${meta.calls} model calls`;
    },
    'retrieval.corpus': () => {
      const meta = data('retrieval').meta;
      return `${meta.facts} facts over ${meta.topics} topic vocabularies, ${meta.questions} questions`;
    },
    'retrieval.incumbent': () => {
      const { meta, rows } = data('retrieval');
      const large = meta.sizes[meta.sizes.length - 1];
      const small = meta.sizes[0];
      const at = (size: any, policy: any) => {
        const row = rows.find((r: any) => r.size === size && r.policy === policy);
        if (row === undefined) throw new Error(`retrieval.json has no ${policy} row at ${size} memories — regenerate it before quoting one`);
        return row;
      };
      const pct = (x: any) => `${(100 * x).toFixed(1)}%`;
      const memories = (n: any) => n.toLocaleString('en-US');
      return `${memories(large)} memories today's recall puts a gold memory in the top 10 for`
        + ` ${pct(at(large, 'tag+recency').recallAt10)} of questions (recency alone`
        + ` ${pct(at(large, 'recency').recallAt10)}, a random draw ${pct(at(large, 'random').recallAt10)});`
        + ` at ${memories(small)} memories the same policy reaches ${pct(at(small, 'tag+recency').recallAt10)}`;
    },
    'retrieval.ranked': () => {
      // the ranked row beside the default, whichever way it fell — the
      // comparison word is derived, never typed
      const { meta, rows } = data('retrieval');
      const large = meta.sizes[meta.sizes.length - 1];
      const small = meta.sizes[0];
      const at = (size: any, policy: any) => {
        const row = rows.find((r: any) => r.size === size && r.policy === policy);
        if (row === undefined) throw new Error(`retrieval.json has no ${policy} row at ${size} memories — regenerate it before quoting one`);
        return row;
      };
      const pct = (x: any) => `${(100 * x).toFixed(1)}%`;
      const memories = (n: any) => n.toLocaleString('en-US');
      const near = at(large, 'near');
      const incumbent = at(large, 'tag+recency');
      const word = near.recallAt10 > incumbent.recallAt10 ? 'ahead of'
        : near.recallAt10 < incumbent.recallAt10 ? 'behind' : 'level with';
      return `${pct(near.recallAt10)} of questions at ${memories(large)} memories through the`
        + ` ${meta.ranked.model} reference embedder (${pct(at(small, 'near').recallAt10)} at ${memories(small)}),`
        + ` ${word} tag match and recency's ${pct(incumbent.recallAt10)}`;
    }
  })
};
