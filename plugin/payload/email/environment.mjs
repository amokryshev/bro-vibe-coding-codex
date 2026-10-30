import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { REQUIRED_KEYS, OPTIONAL_KEYS, validateConfiguration } from './account.mjs';
import { normalizeEmailDestinationPolicy } from './connection-probe.mjs';

const PRIVATE_ENDPOINTS = 'BRO_EMAIL_PRIVATE_ENDPOINTS';
const keys = [...REQUIRED_KEYS, ...OPTIONAL_KEYS, PRIVATE_ENDPOINTS];

// Parse dotenv data, never shell code. Track duplicate email keys before parseEnv
// can silently choose one; unrelated settings remain in the user's file.
function parse(text) {
  const result = {};
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(?:#.*)?$/.test(lines[i])) continue;
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(lines[i]);
    if (!match) throw Error('Email: некорректный синтаксис .env; исправьте файл.');
    const [, key] = match;
    let value = match[2];
    if (['"', "'", '`'].includes(value[0])) {
      const quote = value[0];
      while (value.indexOf(quote, 1) === -1 && i + 1 < lines.length) value += '\n' + lines[++i];
      const end = value.indexOf(quote, 1);
      if (end === -1 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw Error('Email: некорректные кавычки в .env.');
    }
    if (!keys.includes(key)) continue;
    if (Object.hasOwn(result, key)) throw Error(`Email: повтор переменной ${key} в .env.`);
    result[key] = parseEnv(`${key}=${value}`)[key];
  }
  return result;
}

async function filePath(project) {
  if (await realpath(project) !== resolve(project)) throw Error('Email: требуется канонический путь проекта.');
  return join(project, '.env');
}

async function openEnvironment(path, flags) {
  const handle = await open(path, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const info = await handle.stat();
    const named = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || named.isSymbolicLink() || info.ino !== named.ino || info.dev !== named.dev ||
        (process.getuid && info.uid !== process.getuid())) throw Error('unsafe');
    return handle;
  } catch { await handle.close(); throw Error('Email: .env должен быть обычным файлом текущего пользователя без ссылок.'); }
}

export async function prepareEmailEnvironmentFile(project) {
  const path = await filePath(project);
  let handle;
  try {
    let writable = true;
    try { handle = await openEnvironment(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; handle = await openEnvironment(path, constants.O_RDONLY); writable = false; }
    const before = await handle.stat();
    const text = await handle.readFile('utf8');
    const existing = parse(text);
    const missing = REQUIRED_KEYS.filter(key => !Object.hasOwn(existing, key));
    if (missing.length) {
      if (!writable) {
        await handle.close(); handle = undefined;
        handle = await openEnvironment(path, constants.O_RDWR);
        if (await handle.readFile('utf8') !== text) throw Error('Email: .env изменён параллельно; повторите настройку.');
      }
      const after = await handle.stat();
      const named = await lstat(path);
      if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || named.ino !== before.ino || named.dev !== before.dev) throw Error('Email: .env изменён параллельно; повторите настройку.');
      const newline = text.includes('\r\n') ? '\r\n' : '\n';
      const addition = (text && !text.endsWith('\n') ? newline : '') + '# BRO Email — заполните недостающие значения' + newline +
        missing.map(key => `${key}=""`).join(newline) + newline;
      await handle.writeFile(addition);
    }
    return path;
  } catch (error) {
    if (error.message.startsWith('Email:')) throw error;
    throw Error('Email: не удалось подготовить .env; проверьте права и отсутствие ссылок.');
  } finally { await handle?.close(); }
}

export async function loadEmailEnvironment(project, processEnvironment = process.env) {
  const path = await filePath(project);
  let fromFile = {}, handle;
  try {
    handle = await openEnvironment(path, constants.O_RDONLY);
    fromFile = parse(await handle.readFile('utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      if (error.message.startsWith('Email:')) throw error;
      throw Error('Email: не удалось прочитать .env; проверьте файл и права.');
    }
  } finally { await handle?.close(); }
  const chosen = Object.fromEntries(keys.filter(key => Object.hasOwn(processEnvironment, key) || Object.hasOwn(fromFile, key))
    .map(key => [key, Object.hasOwn(processEnvironment, key) ? processEnvironment[key] : fromFile[key]]));
  const missing = REQUIRED_KEYS.filter(key => typeof chosen[key] !== 'string' || chosen[key].trim() === '');
  if (missing.length) throw Error(`Email: заполните ${missing.join(', ')} в окружении или ${path}.`);
  const environment = Object.fromEntries([...REQUIRED_KEYS, ...OPTIONAL_KEYS].filter(key => Object.hasOwn(chosen, key)).map(key => [key, chosen[key]]));
  validateConfiguration(environment);
  const privateEndpoints = (chosen[PRIVATE_ENDPOINTS] ?? '').split(',').map(x => x.trim()).filter(Boolean);
  const policy = normalizeEmailDestinationPolicy({ private_endpoints: privateEndpoints });
  return { environment, privateEndpoints: [...policy.private_endpoints] };
}
