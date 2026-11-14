/**
 * A neutral application on its own origin that joins a Tangle OS desktop:
 * it serves a `records` contract (describe, search, get) and mails the person.
 * It keeps its own data and code; the desktop sees only its contract.
 */
import { connectToOs } from '@tangleai/os/module';
import { RECORDS } from './contract.ts';

const ROWS = [
  { id: 'r1', name: 'Oak table', stock: 4 },
  { id: 'r2', name: 'Pine chair', stock: 12 },
  { id: 'r3', name: 'Walnut shelf', stock: 0 },
];
// the desktop allowed to frame this page is fixed when the page is built,
// never read from the URL: whoever frames the page must not choose it
declare const DESKTOP_ORIGIN: string;
const list = document.getElementById('rows')!;
const status = document.getElementById('status')!;
list.innerHTML = ROWS.map(r => `<tr><td>${r.name}</td><td>${r.stock}</td></tr>`).join('');

const connection = await connectToOs({
  origins: [DESKTOP_ORIGIN],
  serve: [{ contract: RECORDS, handlers: {
    'records.describe': () => ({ title: 'Catalogue', fields: ['id', 'name', 'stock'], count: ROWS.length }),
    'records.search': ({ query = '' }: any) => ROWS.filter(r => r.name.toLowerCase().includes(String(query).toLowerCase())),
    'records.get': ({ id }: any) => ROWS.find(r => r.id === id) ?? {},
  } }],
  context: () => ({ showing: 'catalogue', rows: ROWS.length }),
  onTheme: () => { document.body.dataset.themed = 'yes'; },
});
status.textContent = `Joined the desktop as ${connection.module}.`;
document.getElementById('mail')!.addEventListener('click', async () => {
  const outOfStock = ROWS.filter(r => r.stock === 0).map(r => r.name);
  await connection.sendMail({ subject: `${outOfStock.length} out of stock`, body: outOfStock.join(', ') });
  status.textContent = 'Mail sent.';
});
(window as any).fixtureConnection = connection;
