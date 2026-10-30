import { verifyToolFiles } from './integrity.mjs';
import { configureCommandPermissions } from './command-permissions.mjs';
export default async function run(ctx) {
  if (ctx.mode === 'check') {
    await ctx.checkState();
    if (!(await ctx.inspectState()).configured) return { status: 'skipped', verification: 'not-configured' };
    await verifyToolFiles(ctx);
    return { status: 'completed', verification: 'passed' };
  }

  await verifyToolFiles(ctx);
  await configureCommandPermissions(ctx);
}
