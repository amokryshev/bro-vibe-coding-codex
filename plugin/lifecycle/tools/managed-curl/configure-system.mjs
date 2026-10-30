import { verifyToolFiles } from './integrity.mjs';
// Curl selection and authorization belong to individual projects.
export default async function run(ctx) {
  if (ctx.mode === 'check') return { status: 'skipped', verification: 'not-applicable' };

  await verifyToolFiles(ctx);
}
