import { installToolFiles,verifyToolFiles } from './integrity.mjs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compatible} from './mcp.mjs';
export default async function run(ctx) {
 if(ctx.mode==='check') { await verifyToolFiles(ctx);await ctx.checkState(); return {status:'completed',verification:'passed'}; }
 await installToolFiles(ctx);
 const inventory=await ctx.mcpInventory();
 const replacing=inventory.some(c=>c.name==='bro-playwright'&&c.scope==='system'&&!c.owned);
 if(!replacing&&inventory.some(compatible)) return;
 const {installPlatform}=await import(pathToFileURL(join(ctx.root,'plugin/payload/playwright/platform-payload.mjs')));
 await installPlatform(ctx);
}
