import { realpath, lstat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEmailEnvironment } from './environment.mjs';
import { startRuntime } from './runtime.mjs';

try {
  const { values } = parseArgs({ options: { project: { type: 'string' }, 'runtime-home': { type: 'string' } } });
  if (!values.project || !values['runtime-home']) throw Error();
  const project = await realpath(values.project);
  if (project !== values.project) throw Error();
  const inside = relative(project, await realpath(process.cwd()));
  if (inside === '..' || inside.startsWith('../') || inside.startsWith('/')) throw Error();
  const runtimeHome = resolve(values['runtime-home']);
  for (const path of [dirname(runtimeHome), runtimeHome]) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
        (process.getuid && stat.uid !== process.getuid()) || await realpath(path) !== path) throw Error();
  }
  const account = await loadEmailEnvironment(project);
  const child = startRuntime({ project, runtimeHome, ...account }, ['inherit', 'inherit', 'ignore']);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  child.once('error', () => { process.stderr.write('Email runtime could not start.\n'); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = signal ? 1 : code ?? 1; });
} catch {
  process.stderr.write('Email is unavailable: configure this project using environment variables or .env.\n');
  process.exitCode = 1;
}
