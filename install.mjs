// Standalone bootstrap: obtain a release, then invoke its install action.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
function take(name) { const at = args.indexOf(name); if (at < 0) return; if (!args[at + 1] || args[at + 1].startsWith('--')) throw Error(`${name} requires a value`); return args.splice(at, 2)[1]; }
let repo = take('--repo');
const ref = take('--ref');
if (!repo || repo.startsWith('-')) throw Error('--repo requires the agent release Git repository');
if (!['darwin', 'linux'].includes(platform())) throw Error('Supported systems: macOS and Linux');
if(!/^[a-z][a-z0-9+.-]*:\/\//i.test(repo) && !/^[^/]+@[^:]+:/.test(repo)) repo=resolve(repo);
const temp = await mkdtemp(join(tmpdir(), 'bro-install-'));
function run(bin, argv) { const r = spawnSync(bin, argv, { stdio: 'inherit' }); if (r.error) throw r.error; if (r.status !== 0) throw Error(`${bin} failed (${r.status})`); }
try {
  const checkout = join(temp, 'release');
  run('git', ['clone', '--depth=1', '--filter=blob:none', '--sparse', ...(ref ? ['--branch', ref] : []), '--', repo, checkout]);
  run('git', ['-C', checkout, 'sparse-checkout', 'set', 'plugin']);
  const revision=spawnSync('git',['-C',checkout,'rev-parse','HEAD'],{encoding:'utf8'});
  if(revision.status!==0) throw Error('Cannot resolve release commit');
  run(process.execPath, [join(checkout, 'plugin/lifecycle/plugin/install.mjs'), '--release-repo',repo,'--release-commit',revision.stdout.trim(), ...args]);
} finally { await rm(temp, { recursive: true, force: true }); }
