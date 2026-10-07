import { join } from 'node:path';
import { runExperientialExample } from '../../examples/experiential.ts';

const directory = process.env.TANGLE_FIXTURE_DIRECTORY;
if (!directory) throw new Error('The parent must own the example database directory.');
console.log(JSON.stringify(await runExperientialExample({ storage: 'sqlite', database: join(directory, 'example.sqlite') })));
