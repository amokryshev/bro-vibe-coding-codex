import { verifyToolFiles } from './integrity.mjs';
import {join} from 'node:path';
import {realpath,access,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {select,verify,checkCandidate} from './mcp.mjs';
export default async function run(ctx) {
  if(ctx.mode==='check') return verify(ctx);
  await verifyToolFiles(ctx);
 const existing=await select(ctx);
 if(existing) {
  if(existing.scope!=='system') return {status:'skipped',reason:'existing-project-mcp'};
  await checkCandidate(ctx,existing);
  await ctx.setMcpBinding({name:existing.name,mode:existing.owned?'owned':'borrowed',fingerprint:existing.fingerprint});
  await ctx.configure(existing.owned?{mcp:{'bro-playwright':existing.definition}}:{});
  return {status:'configured'};
 }
 const payload=join(ctx.root,'plugin/payload/playwright');
 if(!ctx.project) await ctx.ownDirectory(ctx.dataDirectory,join(payload,'cache-template'));
 let executable=ctx.settings.executable;
 // Project registrations use the browser already prepared by system setup.
 if(!executable && ctx.project) {
   try { executable=JSON.parse(await readFile(join(ctx.root,'data/playwright/system/browser.json'),'utf8')).executable; }
   catch(error) { if(error.code!=='ENOENT') throw error; }
 }
 if(executable) { executable=await realpath(executable); await access(executable,constants.X_OK); }
 else {
  const {installedExecutable}=await import(pathToFileURL(join(payload,'platform-payload.mjs')));
  try { executable=await installedExecutable(ctx.project ? join(ctx.root,'data/playwright/system') : ctx.dataDirectory); }
  catch(error) { throw Error('Playwright has no usable installed browser; select an external executable or install a release containing the platform payload',{cause:error}); }
 }
 const config=join(ctx.dataDirectory,'browser.json');
 await ctx.ownFile(config,JSON.stringify({executable})+'\n');
 const definition={command:process.execPath,args:[join(payload,'entrypoint.mjs'),config]};
 await ctx.setMcpBinding({name:'bro-playwright',mode:'owned',fingerprint:ctx.mcpFingerprint(definition)});
 await ctx.configure({mcp:{'bro-playwright':definition}});
}
