import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { verifyResult } from './verification.mjs';
export * from './verification.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(resolve(process.argv[1]))).href) {
  try { const {values} = parseArgs({options:{'result-file':{type:'string'}}}); await verifyResult(JSON.parse(await readFile(values['result-file'],'utf8'))); }
  catch(e) { console.error(e.message); process.exitCode=1; }
}
