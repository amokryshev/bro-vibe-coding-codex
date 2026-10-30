import { verifyToolFiles } from './integrity.mjs';
export default async function run(ctx) {
  if(ctx.mode==='check')return {status:'skipped',verification:'not-applicable'};
  await verifyToolFiles(ctx);}
