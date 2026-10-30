import { verifyToolFiles } from './integrity.mjs';
import {join} from 'node:path';
export default async function run(ctx) {
  if (ctx.mode === 'check') {
    await ctx.checkState();
    if (!(await ctx.inspectState()).configured) return { status: 'skipped', verification: 'not-configured' };
    await verifyToolFiles(ctx);
    return { status: 'completed', verification: 'passed' };
  }

  await verifyToolFiles(ctx); await ctx.ownDirectory(join(ctx.skillsDirectory,'security-review'),join(ctx.root,'plugin/payload/security-review/skill')); }
