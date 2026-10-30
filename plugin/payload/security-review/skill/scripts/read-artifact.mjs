import { readFile, lstat, realpath } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';

// Display helper, not a secret detector or a product scanner. Redaction is
// deliberately conservative; absence of a match never proves absence of secrets.
const sensitiveName = /(?:secret|credential|password|passwd|api[_-]?key|token|authorization|private[_-]?key)/i;
function redact(line, state) {
  if (state.omitRemaining || line.length > 4000) {
    state.omitRemaining = true;
    return '[DISPLAY OMITTED AFTER LONG LINE; use bounded metadata inspection]';
  }
  if (state.yamlBlockIndent !== undefined) {
    if (!line.trim() || line.match(/^\s*/)[0].length > state.yamlBlockIndent) return '[REDACTED YAML CREDENTIAL]';
    delete state.yamlBlockIndent;
  }
  if (state.stringDelimiter) {
    const escaped = line.replace(/\\./g, '');
    if (escaped.includes(state.stringDelimiter)) state.stringDelimiter = null;
    return '[REDACTED MULTILINE CREDENTIAL]';
  }
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/.test(line)) state.privateKey = true;
  if (state.privateKey) {
    if (/-----END (?:[A-Z ]*PRIVATE KEY|PGP PRIVATE KEY BLOCK)-----/.test(line)) state.privateKey = false;
    return '[REDACTED PRIVATE KEY MATERIAL]';
  }
  let output = line;
  const yamlBlock = line.match(/^(\s*)([\w.-]+)\s*:\s*[|>][-+]?\s*(?:#.*)?$/);
  if (yamlBlock && sensitiveName.test(yamlBlock[2])) {
    state.yamlBlockIndent = yamlBlock[1].length;
    return yamlBlock[1] + yamlBlock[2] + ': [REDACTED YAML CREDENTIAL]';
  }
  for (const match of line.matchAll(/([\w$.-]+|["'][^"'\r\n]+["'])\s*([=:])\s*(["'`])/g)) {
    if (!sensitiveName.test(match[1])) continue;
    const remainder = line.slice(match.index + match[0].length).replace(/\\./g, '');
    if (!remainder.includes(match[3])) {
      state.stringDelimiter = match[3];
      const prefix = redact(line.slice(0, match.index), { privateKey: false });
      return prefix + match[1] + match[2] + "'[REDACTED MULTILINE CREDENTIAL]'";
    }
  }
  // Preserve nonliteral code/policy (e.g. passwordPolicy = { minLength: 15 }).
  // Mask quoted literals assigned to names/keys which can contain credentials.
  output = output.replace(/([\w$.-]+|["'][^"'\r\n]+["'])\s*([=:])\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g,
    (match, name, operator) => sensitiveName.test(name) ? `${name}${operator}'[REDACTED]'` : match);
  // Environment/YAML/header values without quoting. Do not exempt value
  // prefixes: e.g. a numeric token or a password starting with "true" is secret.
  // Structured objects remain reviewable; sensitive nested keys are redacted.
  output = output.replace(/^(\s*(?:export\s+)?[\w.-]+\s*[:=]\s*)([^\s"'`{\[][^\r\n]*)$/,
    (match, prefix) => sensitiveName.test(prefix)
      ? prefix + '[REDACTED]' : match);
  output = output.replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, match => match.split(/\s/)[0] + ' [REDACTED]');
  output = output.replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED TOKEN]');
  output = output.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
  return output;
}

try {
  const [rootArg, pathArg, firstArg = '1', lastArg = '160'] = process.argv.slice(2);
  if (!rootArg || !pathArg) throw new Error('usage: node scripts/read-artifact.mjs REVIEW_ROOT FILE [FIRST_LINE LAST_LINE]');
  const root = await realpath(rootArg), path = resolve(root, pathArg);
  const meta = await lstat(path);
  if (!meta.isFile() || meta.isSymbolicLink() || meta.size > 2_000_000) throw new Error('input must be a regular file of at most 2 MB');
  const actual = await realpath(path);
  if (!actual.startsWith(root + sep)) throw new Error('input is outside the review root');
  const first = Number(firstArg), last = Number(lastArg);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last - first >= 200) throw new Error('line window must contain 1 to 200 lines');
  const bytes = await readFile(path), text = bytes.toString('utf8');
  if (text.includes('\0')) throw new Error('binary input is not displayed');
  const state = { privateKey: false };
  const lines = text.split(/\r?\n/).map((line, i) => ({ line: i + 1, text: redact(line, state) }));
  const window = lines.slice(first - 1, last).map(row => ({ ...row, text: row.text.length > 4000 ? '[LONG LINE OMITTED; use a bounded metadata inspection]' : row.text }));
  process.stdout.write(JSON.stringify({ artifact: relative(root, actual), sha256: createHash('sha256').update(bytes).digest('hex'),
    lines: window, nextLine: last < lines.length ? last + 1 : null,
    limitation: 'Heuristic redaction; not proof of secret absence. Do not print original values to resolve a redaction.' }, null, 2) + '\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ valid: false, error: error.code ? 'input unavailable' : error.message }) + '\n');
  process.exitCode = 1;
}
