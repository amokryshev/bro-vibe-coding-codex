import { join } from 'node:path';
import { native } from './native.mjs';
export default async function run(ctx) {
  if (ctx.mode === 'check') { await ctx.checkState(); return { status: 'completed', verification: 'passed' }; }
  const binding=ctx.mcpBinding();
  if(binding?.mode==='owned' && !ctx.mcpReferenced(binding) && await ctx.exists(join(ctx.dataDirectory,'authorization.json'))) await native(ctx,'logout');
  await ctx.configure({}); await ctx.setMcpBinding(null); await ctx.removeOwned();
}
