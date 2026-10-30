import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { platform, arch, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function git(args) {
  const result = spawnSync('git', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('Cannot obtain the selected platform payload from the release repository');
}

export async function preparePlatform(ctx, sourcePlugin, releaseSource) {
  const key = `${platform()}-${arch()}`;
  const subpath = join('platform_specific', key, ctx.tool);
  let source = join(resolve(sourcePlugin, '..'), subpath), temporary;
  try {
    if (releaseSource?.repository || !await ctx.exists(source)) {
      if (releaseSource?.repository) {
        temporary = await mkdtemp(join(tmpdir(), 'bro-platform-'));
        const checkout = join(temporary, 'release');
        // Start empty: a clone would fetch history before the pinned shallow fetch.
        git(['init', '--quiet', checkout]);
        git(['-C', checkout, 'remote', 'add', 'origin', releaseSource.repository]);
        // Cone mode also includes ancestor files outside the selected Tool payload.
        git(['-C', checkout, 'sparse-checkout', 'set', '--no-cone', `/${subpath}/`]);
        git(['-C', checkout, 'fetch', '--depth=1', '--filter=blob:none', '--no-tags', 'origin', releaseSource.commit]);
        git(['-C', checkout, 'checkout', '--detach', 'FETCH_HEAD']);
        source = join(checkout, subpath);
      } else source = join(releaseSource?.directory ?? resolve(sourcePlugin, '..'), subpath);
    }
    if (!await ctx.exists(source)) throw Error(`Published platform payload is unavailable: ${key}/${ctx.tool}`);
    await ctx.ownDirectory(ctx.platformPayloadDirectory, source);
  } finally {
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
