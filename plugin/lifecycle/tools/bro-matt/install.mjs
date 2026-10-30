import { join } from 'node:path';
import { installToolFiles, verifyToolFiles } from './integrity.mjs';
export default async function run(ctx) {
  if (ctx.mode === 'check') {
    await verifyToolFiles(ctx, join(ctx.root, 'plugin'));
    await ctx.checkState();
    return { status: 'completed', verification: 'passed' };
  }
  await installToolFiles(ctx);
}
