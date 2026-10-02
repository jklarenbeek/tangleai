/** Keyless trading measurement with read-only drift checks. */
import { runTradingCli } from './lib/trading-cli.ts';

await runTradingCli(process.argv.slice(2));
