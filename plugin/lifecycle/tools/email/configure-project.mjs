import { verifyToolFiles } from './integrity.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {select,verify,checkCandidate} from './mcp.mjs';

export default async function run(ctx) {
  if(ctx.mode==='check')return verify(ctx);
  await verifyToolFiles(ctx);
  if(process.env.BRO_EMAIL_SETUP==='skip')return {status:'skipped'};
  const existing=await select(ctx);
  if(existing) {
    await checkCandidate(ctx,existing);
    const owned=existing.owned&&existing.scope===ctx.project;
    await ctx.setMcpBinding({name:existing.name,mode:owned?'owned':'borrowed',fingerprint:existing.fingerprint});
    await ctx.configure(owned?{mcp:{'bro-email':existing.definition}}:{});
    return {status:'configured'};
  }
  const payload = join(ctx.root, 'plugin/payload/email');
  const { configureEmail } = await import(pathToFileURL(join(payload, 'configure.mjs')));
  return configureEmail({...ctx,configure:async fragment=>{
    const definition=fragment.mcp?.['bro-email'];
    if(definition)await ctx.setMcpBinding({name:'bro-email',mode:'owned',fingerprint:ctx.mcpFingerprint(definition)});
    return ctx.configure(fragment);
  }});
}
