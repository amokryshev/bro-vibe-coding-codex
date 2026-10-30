import { verifyToolFiles } from './integrity.mjs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
export default async function run(ctx) {
  if (ctx.mode === 'check') {
    await ctx.checkState();
    if (!(await ctx.inspectState()).configured) return { status: 'skipped', verification: 'not-configured' };
    await verifyToolFiles(ctx);
    return { status: 'completed', verification: 'passed' };
  }
  await verifyToolFiles(ctx); await ctx.configure({permissions:JSON.parse(await readFile(join(ctx.root,'plugin/payload/permissions/policy.json'),'utf8'))}); }
