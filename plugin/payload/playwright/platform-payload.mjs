import { readFile, open, mkdir, rm, mkdtemp, realpath, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safeRelative = value => typeof value === 'string' && !isAbsolute(value) && !value.includes('\\') && !value.split('/').some(part => !part || part === '.' || part === '..');
export async function installPlatform(ctx) {
  const payload = join(ctx.root, 'plugin/payload/playwright');
  const included = JSON.parse(await readFile(join(payload, 'release-platforms.json'), 'utf8')).platforms;
  if (!Array.isArray(included)) throw Error('Invalid Playwright release platform index');
  const platform = `${process.platform}-${process.arch}`;
  if (ctx.settings.executable) {
    const executable = await realpath(ctx.settings.executable);
    await access(executable, constants.X_OK);
    await ctx.ownDirectory(ctx.dataDirectory, join(payload, 'cache-template'));
    return;
  }
  if (!included.includes(platform)) throw Error(`Playwright browser payload ${platform} is absent from this release; select an external executable in settings or use a release containing this platform`);
  await ctx.obtainPlatform();
  const catalog = JSON.parse(await readFile(join(payload, 'platforms.json'), 'utf8'));
  const descriptor = catalog.platforms[platform];
  const source = ctx.platformPayloadDirectory;
  if (!source) throw Error('The installer did not provide the Playwright platform payload');
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  if (manifest.schema !== 'bro.playwright-platform/v1' || manifest.platform !== platform || manifest.revision !== catalog.revision || manifest.executable !== descriptor.executable ||
      manifest.archive?.sha256 !== descriptor.sha256 || manifest.archive?.size !== descriptor.size || !safeRelative(manifest.executable) ||
      !Array.isArray(manifest.chunks) || !manifest.chunks.length || new Set(manifest.chunks.map(chunk => chunk.name)).size !== manifest.chunks.length) throw Error('Playwright platform manifest differs from the pinned source');
  await ctx.ownDirectory(ctx.dataDirectory, join(payload, 'cache-template'));
  const temporary = await mkdtemp(join(ctx.dataDirectory, '.extract-'));
  try {
    const archive = join(temporary, 'browser.zip');
    const output = await open(archive, 'wx', 0o600), archiveHash = createHash('sha256');
    let total = 0;
    try {
      for (const chunk of manifest.chunks) {
        if (!/^browser-[0-9]{3}\.part$/.test(chunk.name) || !Number.isInteger(chunk.size) || chunk.size <= 0 || chunk.size > 50 * 1024 * 1024) throw Error('Invalid browser archive chunk');
        const bytes = await readFile(join(source, chunk.name));
        if (bytes.length !== chunk.size || hash(bytes) !== chunk.sha256) throw Error('Browser archive chunk digest mismatch');
        archiveHash.update(bytes); total += bytes.length;
        await output.writeFile(bytes);
      }
    } finally { await output.close(); }
    if (total !== descriptor.size || archiveHash.digest('hex') !== descriptor.sha256) throw Error('Reassembled browser archive differs from the pinned source');
    const require = createRequire(import.meta.url);
    const { extract } = require('./vendor/node_modules/playwright-core/lib/zipBundle.js');
    const extracted = join(temporary, 'extracted');
    await mkdir(extracted);
    await extract(archive, { dir: extracted, onEntry(entry) {
      // Browser archives contain only regular files/directories. Reject links before extraction.
      if (!safeRelative(entry.fileName.replace(/\/$/, '')) || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw Error('Unsafe path in browser archive');
    } });
    const executable = join(extracted, descriptor.executable);
    if (await realpath(executable) !== executable) throw Error('Browser executable must not be a symbolic link');
    await access(executable, constants.X_OK);
    await ctx.ownDirectory(join(ctx.dataDirectory, 'browsers'), extracted);
    await ctx.ownFile(join(ctx.dataDirectory, 'browser-installation.json'), JSON.stringify({ platform, revision: catalog.revision, archiveSha256: descriptor.sha256, executable: descriptor.executable }) + '\n');
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export async function installedExecutable(dataDirectory) {
  const installed = JSON.parse(await readFile(join(dataDirectory, 'browser-installation.json'), 'utf8'));
  if (!safeRelative(installed.executable)) throw Error('Invalid installed browser path');
  const executable = join(dataDirectory, 'browsers', installed.executable);
  if (await realpath(executable) !== executable) throw Error('Installed browser path changed');
  await access(executable, constants.X_OK);
  return executable;
}
