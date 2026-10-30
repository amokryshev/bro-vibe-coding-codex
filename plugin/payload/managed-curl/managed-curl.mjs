import { createHash } from "node:crypto";
import { fstatSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { constants as osConstants } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const INTEGER = /^[0-9]+$/u;

export const MANAGED_CURL_REASON_CODES = Object.freeze([
  "authorization-rejected",
  "identity-rejected",
  "argv-invalid",
  "argv-extra-operand",
  "argv-option-forbidden",
  "argv-option-duplicate",
  "argv-option-conflict",
  "argv-option-value",
  "argv-url-forbidden",
  "argv-url-missing",
  "stdout-regular-file",
  "delegate-result-invalid",
  "delegate-completed",
  "internal-failure",
]);

export const MANAGED_CURL_PROCESS_CONTRACT = Object.freeze({
  schema: "bro.managed-curl-process-contract/v1",
  exits: Object.freeze({
    internal: 70,
    invalid_invocation: 64,
    regular_stdout: 66,
    trust_rejected: 65,
  }),
  reason_codes: MANAGED_CURL_REASON_CODES,
});

const OPTION_SPECS = Object.freeze({
  "-s": Object.freeze({ canonical: "--silent", semantic: "silent" }),
  "--silent": Object.freeze({ canonical: "--silent", semantic: "silent" }),
  "-S": Object.freeze({ canonical: "--show-error", semantic: "show-error" }),
  "--show-error": Object.freeze({ canonical: "--show-error", semantic: "show-error" }),
  "-f": Object.freeze({ canonical: "--fail", conflicts: ["fail-with-body"], semantic: "fail" }),
  "--fail": Object.freeze({ canonical: "--fail", conflicts: ["fail-with-body"], semantic: "fail" }),
  "--fail-with-body": Object.freeze({
    canonical: "--fail-with-body",
    conflicts: ["fail"],
    semantic: "fail-with-body",
  }),
  "-i": Object.freeze({ canonical: "--include", semantic: "include" }),
  "--include": Object.freeze({ canonical: "--include", semantic: "include" }),
  "-4": Object.freeze({ canonical: "--ipv4", conflicts: ["ipv6"], semantic: "ipv4" }),
  "--ipv4": Object.freeze({ canonical: "--ipv4", conflicts: ["ipv6"], semantic: "ipv4" }),
  "-6": Object.freeze({ canonical: "--ipv6", conflicts: ["ipv4"], semantic: "ipv6" }),
  "--ipv6": Object.freeze({ canonical: "--ipv6", conflicts: ["ipv4"], semantic: "ipv6" }),
  "-L": Object.freeze({ canonical: "--location", semantic: "location" }),
  "--location": Object.freeze({ canonical: "--location", semantic: "location" }),
  "--connect-timeout": Object.freeze({ maximum: 60, semantic: "connect-timeout", value: true }),
  "--max-time": Object.freeze({ maximum: 600, semantic: "max-time", value: true }),
});

const PROXY_ENVIRONMENT = Object.freeze([
  "http_proxy",
  "HTTP_PROXY",
  "https_proxy",
  "HTTPS_PROXY",
  "all_proxy",
  "ALL_PROXY",
  "no_proxy",
  "NO_PROXY",
]);
const LOCALE_ENVIRONMENT = Object.freeze(["LANG", "LC_ALL", "LC_CTYPE"]);

function byteDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function modeOf(facts) {
  return (Number(facts.mode) & 0o777).toString(8).padStart(4, "0");
}

async function executableIdentity(pathname) {
  const facts = await lstat(pathname, { bigint: true });
  if (!facts.isFile() || facts.isSymbolicLink()) {
    throw new TypeError("executable is not a regular file");
  }
  return {
    content_digest: byteDigest(await readFile(pathname)),
    filesystem: {
      device: String(facts.dev),
      inode: String(facts.ino),
    },
    mode: modeOf(facts),
    owner_uid: String(facts.uid),
    path: pathname,
  };
}

function sameIdentity(expected, actual) {
  return expected?.path === actual.path &&
    expected.content_digest === actual.content_digest &&
    expected.mode === actual.mode &&
    expected.owner_uid === actual.owner_uid &&
    expected.filesystem?.device === actual.filesystem.device &&
    expected.filesystem?.inode === actual.filesystem.inode;
}

function validCanonicalPath(value) {
  return typeof value === "string" &&
    path.isAbsolute(value) &&
    path.resolve(value) === value &&
    !value.includes("\0");
}

async function validateAuthorization(authorization, executablePath) {
  if (
    authorization?.schema !== "bro.managed-curl-authorization/v1" ||
    !validCanonicalPath(authorization.real_curl?.path) ||
    !DIGEST.test(authorization.real_curl?.content_digest ?? "")
  ) {
    return { authorized: false };
  }
  let realCurl;
  try {
    realCurl = await executableIdentity(authorization.real_curl.path);
  } catch {
    return { authorized: false };
  }
  if (!sameIdentity(authorization.real_curl, realCurl)) {
    return { authorized: false };
  }
  const fallbackPath = authorization.real_curl.path;
  if (
    !validCanonicalPath(authorization.canonical_shim_path) ||
    executablePath !== authorization.canonical_shim_path ||
    authorization.shim?.path !== authorization.canonical_shim_path ||
    authorization.shim?.mode !== "0700" ||
    !DIGEST.test(authorization.shim?.content_digest ?? "")
  ) {
    return { authorized: false, fallbackPath };
  }
  if (
    typeof process.getuid === "function" &&
    authorization.shim.owner_uid !== String(process.getuid())
  ) {
    return { authorized: false, fallbackPath };
  }
  try {
    const shim = await executableIdentity(executablePath);
    return {
      authorized: sameIdentity(authorization.shim, shim),
      fallbackPath,
    };
  } catch {
    return { authorized: false, fallbackPath };
  }
}

function rejection(reasonCode, exitCode, fallbackPath) {
  return Object.freeze({
    delegated: false,
    exit_code: exitCode,
    ...(fallbackPath === undefined ? {} : { fallback_path: fallbackPath }),
    reason_code: reasonCode,
  });
}

function parseInteger(value, maximum) {
  if (!INTEGER.test(value ?? "") || value.length > 3 || /^0/u.test(value)) return undefined;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? String(parsed) : undefined;
}

function parseUrl(value) {
  if (!/^https?:\/\//iu.test(value) || /[{}]/u.test(value)) return undefined;
  const withoutIpv6Authority = value.replace(
    /^(https?:\/\/)\[[0-9a-f:.]+\](?=[:/?#]|$)/iu,
    "$1ipv6.invalid",
  );
  if (/[\[\]]/u.test(withoutIpv6Authority)) return undefined;
  try {
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol.toLowerCase()) ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function parseInvocation(argv) {
  if (!Array.isArray(argv)) return { rejection: "argv-invalid" };
  const seen = new Set();
  const options = [];
  let connectTimeout = "10";
  let totalTimeout = "120";
  let url;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (typeof argument !== "string" || argument.includes("\0")) {
      return { rejection: "argv-invalid" };
    }
    if (url !== undefined) return { rejection: "argv-extra-operand" };
    if (argument.startsWith("-")) {
      const spec = OPTION_SPECS[argument];
      if (spec === undefined) return { rejection: "argv-option-forbidden" };
      if (seen.has(spec.semantic)) return { rejection: "argv-option-duplicate" };
      if (spec.conflicts?.some((semantic) => seen.has(semantic))) {
        return { rejection: "argv-option-conflict" };
      }
      seen.add(spec.semantic);
      if (spec.value) {
        const value = parseInteger(argv[index + 1], spec.maximum);
        if (value === undefined) return { rejection: "argv-option-value" };
        index += 1;
        if (spec.semantic === "connect-timeout") connectTimeout = value;
        else totalTimeout = value;
      } else {
        options.push(spec.canonical);
      }
      continue;
    }
    url = parseUrl(argument);
    if (url === undefined) return { rejection: "argv-url-forbidden" };
  }
  if (url === undefined) return { rejection: "argv-url-missing" };
  return { connectTimeout, options, totalTimeout, url };
}

function delegatedArguments(parsed) {
  return [
    "--disable",
    "--globoff",
    "--request",
    "GET",
    "--proto",
    "=http,https",
    "--proto-redir",
    "=http,https",
    "--connect-timeout",
    parsed.connectTimeout,
    "--max-time",
    parsed.totalTimeout,
    "--max-redirs",
    "10",
    "--retry",
    "0",
    ...parsed.options,
    parsed.url,
  ];
}

export function projectDelegateEnvironment(environment) {
  const projected = {};
  for (const name of [...PROXY_ENVIRONMENT, ...LOCALE_ENVIRONMENT]) {
    if (typeof environment?.[name] === "string") projected[name] = environment[name];
  }
  return projected;
}

async function spawnDelegate({ argv, environment, executable }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, argv, {
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      if (exitCode !== null) {
        resolve({ exitCode });
        return;
      }
      const signalNumber = osConstants.signals[signal] ?? 0;
      resolve({ exitCode: 128 + signalNumber });
    });
  });
}

export async function executeManagedCurl(argv, options) {
  const exit = MANAGED_CURL_PROCESS_CONTRACT.exits;
  let fallbackPath;
  try {
    const trust = await validateAuthorization(options?.authorization, options?.executablePath);
    fallbackPath = trust.fallbackPath;
    if (!trust.authorized) {
      return rejection("identity-rejected", exit.trust_rejected, fallbackPath);
    }
    const parsed = parseInvocation(argv);
    if (parsed.rejection !== undefined) {
      return rejection(parsed.rejection, exit.invalid_invocation, fallbackPath);
    }
    if (fstatSync(options.stdoutFd ?? 1).isFile()) {
      return rejection("stdout-regular-file", exit.regular_stdout, fallbackPath);
    }
    const delegate = options.delegate ?? spawnDelegate;
    const completed = await delegate({
      argv: delegatedArguments(parsed),
      environment: projectDelegateEnvironment(options.environment ?? process.env),
      executable: options.authorization.real_curl.path,
    });
    if (!Number.isInteger(completed?.exitCode) || completed.exitCode < 0 || completed.exitCode > 255) {
      return rejection("delegate-result-invalid", exit.internal, fallbackPath);
    }
    return Object.freeze({
      delegated: true,
      exit_code: completed.exitCode,
      reason_code: "delegate-completed",
    });
  } catch {
    return rejection("internal-failure", exit.internal, fallbackPath);
  }
}
