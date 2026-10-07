import { join } from 'node:path';
import { runExperientialExample } from '../../examples/experiential.ts';
const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw Error('A parent-owned database directory is required.');
console.log(JSON.stringify(await runExperientialExample({ tick: true, database: join(directory, 'ticks.sqlite') })));
