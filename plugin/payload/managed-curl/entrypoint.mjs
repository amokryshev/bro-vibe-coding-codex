import { readFile, realpath, lstat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { executeManagedCurl } from './managed-curl.mjs';
import { hash, fileIdentity, directoryIdentity, noSymlinks } from './identity.mjs';

async function authorize(configPath, executablePath) {
  await noSymlinks(configPath);
  const facts = await lstat(configPath);
  if (!facts.isFile() || (facts.mode & 0o777) !== 0o600 || facts.uid !== process.getuid()) throw Error('Unprotected curl configuration');
  const bytes = await readFile(configPath);
  const config = JSON.parse(bytes);
  if (config.schema !== 'bro.project-curl/v1' || !['codex', 'claude'].includes(config.agent)) throw Error('Invalid curl configuration');
  await noSymlinks(join(config.root, 'ownership.json'));
  const receipt = JSON.parse(await readFile(join(config.root, 'ownership.json'), 'utf8'));
  const own = receipt.resources.find(r => r.path === configPath && r.kind === 'file' && r.owner === 'managed-curl' && r.scope === config.project.path);
  if (receipt.root !== config.root || receipt.agent !== config.agent || receipt.agentHome !== config.agentHome || !receipt.tools.includes('managed-curl') || !receipt.projects.includes(config.project.path) || own?.hash !== hash(bytes)) throw Error('Project curl configuration is not owned by this installation');
  const profile = process.env[config.agent === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'];
  if (profile && await realpath(profile) !== config.agentHome) throw Error('Wrong agent profile');
  if (JSON.stringify(await directoryIdentity(config.project.path)) !== JSON.stringify(config.project)) throw Error('Project identity changed');
  const cwd = await realpath(process.cwd());
  const fromProject = relative(config.project.path, cwd);
  if (fromProject === '..' || fromProject.startsWith('../') || isAbsolute(fromProject)) throw Error('Current directory is outside configured project');
  if (executablePath !== config.authorization.canonical_shim_path) throw Error('Use the configured absolute command');
  for (const expected of config.runtime) if (JSON.stringify(await fileIdentity(expected.path)) !== JSON.stringify(expected)) throw Error('Managed curl runtime changed');
  return config.authorization;
}

try {
  const executablePath = process.env.BRO_MANAGED_CURL_EXECUTABLE;
  const authorization = await authorize(process.argv[2], executablePath);
  const result = await executeManagedCurl(process.argv.slice(3), { authorization, executablePath });
  if (!result.delegated) process.stderr.write(`managed-curl: rejected (${result.reason_code}); use the real curl through ordinary agent approval for a broader request.\n`);
  process.exitCode = result.exit_code;
} catch {
  process.stderr.write('managed-curl: rejected (authorization-rejected); configure this project before using its absolute command.\n');
  process.exitCode = 65;
}
