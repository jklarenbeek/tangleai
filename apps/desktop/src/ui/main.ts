/**
 * Browser boot — compile the SAME contract constant the server serves,
 * open the fetch client against the same origin, agree on a version,
 * mount the app.
 *
 * The version check is not ceremony here: this bundle can be cached, so
 * it is the one half that can arrive older than the server it talks to.
 * `negotiateBoot` decides whether mounting is honest and, when it is
 * not, leaves a sentence in the mount point instead of an app whose
 * every operation would fail separately.
 */

import { compileContract } from '@jarenjs/contract';
import { openHttpClient } from '@jarenjs/contract/client';

import { DESKTOP_CONTRACT } from '../contract.ts';
import { createTangleUi } from './app.ts';
import { negotiateBoot } from './negotiate.ts';

const contract = compileContract(DESKTOP_CONTRACT);
const client = openHttpClient(contract, { baseUrl: '' });
const node = document.getElementById('app');

const verdict = await negotiateBoot(client as any, DESKTOP_CONTRACT.version);
if (verdict.message) console.warn(`[tangle-desktop] ${verdict.reason}: ${verdict.message}`);
if (verdict.mount) createTangleUi({ client, node });
else if (node) {
  node.textContent = verdict.message;
  node.setAttribute('role', 'alert');
}
