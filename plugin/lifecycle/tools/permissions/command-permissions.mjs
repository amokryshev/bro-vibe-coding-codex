import { realpath } from 'node:fs/promises';
import { join } from 'node:path';

const scripts = ['install', 'configure-system', 'configure-project', 'uninstall-project', 'uninstall-system', 'verify'];
function shellWords(value) {
  // Claude matches the script argument's quoting literally. Cover the ordinary
  // quoted forms without introducing a wildcard into the executable or path.
  return [...(/^[\w./:-]+$/.test(value) ? [value] : []),
    `'${value.replaceAll("'", "'\\''")}'`, `"${value.replace(/[\\"$`]/g, '\\$&')}"`];
}

export async function configureCommandPermissions(ctx) {
  const directories = [...new Set(await ctx.pluginDirectories())];
  const executables = [...new Set(['node', process.execPath, await realpath(process.execPath)])];
  const commands = directories.flatMap(directory => scripts.map(script => [executables, join(directory, 'lifecycle/plugin', `${script}.mjs`)]));
  if (ctx.agent === 'codex') {
    const rules = commands.map(pattern => `prefix_rule(pattern=${JSON.stringify(pattern)}, decision="allow")`).join('\n') + '\n';
    await ctx.ownFile(join(ctx.agentHome, 'rules/bro-vibe-coding-lifecycle.rules'), rules);
  } else {
    // Bash rules treat '*' as a wildcard even inside a quoted path.
    if ([...directories, ...executables].some(path => /[*\r\n]/.test(path))) throw Error('Lifecycle command paths cannot contain wildcards or newlines');
    const commandPermissions = commands.flatMap(([nodes, script]) => nodes.flatMap(node =>
      shellWords(node).flatMap(executable => shellWords(script).map(path => `${executable} ${path}`))));
    await ctx.configure({ commandPermissions });
  }
}
