/** Fixed trusted collector runs only after every measured process has been removed. */
export const RESEARCH_OUTPUT_COLLECTOR = String.raw`
const fs = require('node:fs');
const root = '/capture';
const byteLimit = Number(process.argv[1]), fileLimit = Number(process.argv[2]);
const files = []; let total = 0, visited = 0;
function walk(relative) {
  for (const entry of fs.readdirSync(root + (relative ? '/' + relative : ''), { withFileTypes: true })) {
    if (++visited > fileLimit * 2) throw new Error('Output inventory exceeds its entry cap.');
    if (!/^[A-Za-z0-9_.-]+$/.test(entry.name) || entry.name === '.' || entry.name === '..') throw new Error('Invalid output filename.');
    const path = relative ? relative + '/' + entry.name : entry.name;
    if (path.length > 249) throw new Error('Output path exceeds its bound.');
    const stat = fs.lstatSync(root + '/' + path);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error('Output contains a link or non-regular file.');
    if (stat.isDirectory()) { walk(path); continue; }
    if (files.length >= fileLimit || total + stat.size > byteLimit) throw new Error('Output exceeds its file or byte cap.');
    const bytes = fs.readFileSync(root + '/' + path); total += bytes.length;
    if (bytes.length !== stat.size) throw new Error('Output changed after measured-process removal.');
    files.push({path:'output/' + path, bytes:[...bytes]});
  }
}
let complete = true, reason = null;
try { walk(''); } catch (cause) { complete = false; reason = cause.message; }
const stat = fs.statfsSync(root);
process.stdout.write(JSON.stringify({files,complete,reason,full:stat.bfree === 0 || stat.ffree === 0,allocatedBytes:(stat.blocks-stat.bfree)*stat.bsize}));
`;
