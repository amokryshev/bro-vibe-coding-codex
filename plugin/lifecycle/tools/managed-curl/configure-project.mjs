import { verifyToolFiles } from './integrity.mjs';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveCurl } from './resolve-curl.mjs';

const quote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;
export default async function run(ctx) {
  if (ctx.mode === 'check') {
    await ctx.checkState();
    if (!(await ctx.inspectState()).configured) return { status: 'skipped', verification: 'not-configured' };
    await verifyToolFiles(ctx);
    return { status: 'completed', verification: 'passed' };
  }

  await verifyToolFiles(ctx);
  const payload = join(ctx.root, 'plugin/payload/managed-curl');
  const { fileIdentity, directoryIdentity } = await import(pathToFileURL(join(payload, 'identity.mjs')));
  const realCurl = await resolveCurl(ctx.settings.curl, payload);
  const projectIdentity = await directoryIdentity(ctx.project);
  const configPath = join(ctx.dataDirectory, 'authorization.json');
  const launcher = join(ctx.projectDirectory, 'managed-curl');
  const node = await realpath(process.execPath);
  const entrypoint = join(payload, 'entrypoint.mjs');
  await ctx.ownFile(launcher, `#!/bin/sh\nBRO_MANAGED_CURL_EXECUTABLE="$0"\nexport BRO_MANAGED_CURL_EXECUTABLE\nexec ${quote(node)} ${quote(entrypoint)} ${quote(configPath)} "$@"\n`, { mode: 0o700 });
  const skill = (await readFile(join(payload, 'SKILL.md'), 'utf8')).replaceAll('{{COMMAND}}', quote(launcher));
  await ctx.ownFile(join(ctx.skillsDirectory, 'managed-curl/SKILL.md'), skill);
  const runtime = await Promise.all(['entrypoint.mjs', 'identity.mjs', 'managed-curl.mjs'].map(name => fileIdentity(join(payload, name))));
  // Authorization is written last: a partial configuration never admits network access.
  await ctx.ownFile(configPath, JSON.stringify({ schema: 'bro.project-curl/v1', root: ctx.root, agent: ctx.agent,
    agentHome: ctx.agentHome, project: projectIdentity, runtime,
    authorization: { schema: 'bro.managed-curl-authorization/v1', canonical_shim_path: launcher,
      shim: await fileIdentity(launcher), real_curl: realCurl } }, null, 2) + '\n');
}
