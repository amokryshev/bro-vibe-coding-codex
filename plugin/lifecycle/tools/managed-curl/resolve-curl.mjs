import { access, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
// ELF and Mach-O (including universal binaries), for the supported Linux/macOS hosts.
const nativeHeaders = new Set(['7f454c46', 'feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);

export async function resolveCurl(explicitPath, payload) {
  if (explicitPath !== undefined && (typeof explicitPath !== 'string' || !isAbsolute(explicitPath))) {
    throw Error('managed-curl.curl must be an absolute executable path');
  }
  const { fileIdentity } = await import(pathToFileURL(join(payload, 'identity.mjs')));
  const failures = [];
  // PATH can contain a Managed Curl Shim from any project. Never probe it as curl.
  for (const candidate of explicitPath === undefined ? ['/usr/bin/curl', '/bin/curl'] : [explicitPath]) {
    try {
      const curl = await realpath(candidate);
      await access(curl, constants.X_OK);
      const identity = await fileIdentity(curl);
      if ((parseInt(identity.mode, 8) & 0o022) || !['0', String(process.getuid())].includes(identity.owner_uid)) {
        throw Error('curl must be owned by this user or root and not writable by other users');
      }
      if (!nativeHeaders.has((await readFile(curl)).subarray(0, 4).toString('hex'))) {
        throw Error('expected a native curl binary; scripts and project wrappers are not supported');
      }
      const { stdout } = await run(curl, ['--version'], { timeout: 10_000, maxBuffer: 65536, env: { LANG: 'C' } });
      if (!/^curl\s/m.test(stdout)) throw Error('the selected executable did not identify itself as curl');
      return identity;
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  throw Error(`No usable curl binary: ${failures.join('; ')}. Supply managed-curl.curl with an absolute path to a real curl binary.`);
}
