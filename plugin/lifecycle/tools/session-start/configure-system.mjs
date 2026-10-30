import { verifyToolFiles } from './integrity.mjs';
import {join} from 'node:path';
const quote=x=>"'"+x.replaceAll("'","'\"'\"'")+"'";
export default async function run(ctx) {
  if (ctx.mode === 'check') {
    await ctx.checkState();
    if (!(await ctx.inspectState()).configured) return { status: 'skipped', verification: 'not-configured' };
    await verifyToolFiles(ctx);
    return { status: 'completed', verification: 'passed' };
  }

  await verifyToolFiles(ctx);
 const command=quote(process.execPath)+' '+quote(join(ctx.root,'plugin/payload/session-start/hook.mjs'));
 await ctx.configure({hooks:{SessionStart:[{hooks:[{type:'command',command}]}]}});
}
