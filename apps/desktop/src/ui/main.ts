/**
 * Browser boot — compile the SAME contract constant the server serves,
 * open the fetch client against the same origin, mount the app.
 */

import { compileContract } from '@jarenjs/contract';
import { openHttpClient } from '@jarenjs/contract/client';

import { DESKTOP_CONTRACT } from '../contract.ts';
import { createTangleUi } from './app.ts';

const contract = compileContract(DESKTOP_CONTRACT);
const client = openHttpClient(contract, { baseUrl: '' });

createTangleUi({ client, node: document.getElementById('app') });
