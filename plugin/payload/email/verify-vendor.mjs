import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const PIN = Object.freeze({
  package: "@codefuturist/email-mcp",
  version: "0.2.3",
  resolved: "https://registry.npmjs.org/@codefuturist/email-mcp/-/email-mcp-0.2.3.tgz",
  integrity: "sha512-J9fG/HCZ0Kixy5k326WHDfvPOV9S4RTO+xSU5vvfEHcOfYkHiZfQz4dRx+xBg+QaOK5bqisKW+pCENCfQxpniw==",
  license: "LGPL-3.0-or-later",
  node: ">=24.0.0",
  entrypoint: "node_modules/@codefuturist/email-mcp/dist/main.js",
  entrypointSha256: "ad50822b34750cb877a04fb6bfd162bc790b3dbf17c899d9a3e255df45621bf9",
  licenseSha256: "f6c6811039f740443819ca532d21ee0cc6896a6df73c2b65ee676eb79935cba6",
  lockfileSha256: "c5f7f8c96ed4eaf96a626481a68e44eb0a5a2a959d33872aa0d84e7b9a1535e5",
  nodemailer: Object.freeze({
    version: "9.0.6",
    integrity: "sha512-IQUGFdhdGwI9+AWX+FpUt4DLmvFaOjTMEoneTIWX/RXxuy1TdenPwWrvFMSfLkPKl+HQEXWuSAxEMMbPYXtBmg==",
    reason: "GHSA-p6gq-j5cr-w38f affects nodemailer <=9.0.0",
  }),
});
export const EMAIL_RUNTIME_PIN = PIN;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function plainObject(value) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(value, keys) {
  return plainObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new TypeError(`invalid vendored Email ${label}`);
  }
}

async function canonicalRegularFile(pathname) {
  const facts = await lstat(pathname);
  if (
    !facts.isFile() ||
    facts.isSymbolicLink() ||
    await realpath(pathname) !== path.resolve(pathname)
  ) {
    throw new TypeError("unsafe vendored Email file");
  }
  return readFile(pathname);
}

export async function verifyVendoredEmailRuntime(vendorRoot) {
  const root = path.resolve(vendorRoot);
  const rootFacts = await lstat(root);
  if (
    !rootFacts.isDirectory() ||
    rootFacts.isSymbolicLink() ||
    await realpath(root) !== root
  ) {
    throw new TypeError("unsafe vendored Email root");
  }
  const provenance = parseJson(
    await canonicalRegularFile(path.join(root, "PROVENANCE.json")),
    "provenance",
  );
  const provenanceKeys = [
    "schema",
    "package",
    "version",
    "resolved",
    "integrity",
    "license",
    "entrypoint",
    "entrypointSha256",
    "licenseSha256",
    "lockfile",
    "lockfileSha256",
    "securityOverrides",
    "node",
  ];
  if (
    !exactObject(provenance, provenanceKeys) ||
    provenance.schema !== "bro.email-runtime-vendor/v1" ||
    provenance.package !== PIN.package ||
    provenance.version !== PIN.version ||
    provenance.resolved !== PIN.resolved ||
    provenance.integrity !== PIN.integrity ||
    provenance.license !== PIN.license ||
    provenance.entrypoint !== PIN.entrypoint ||
    provenance.entrypointSha256 !== PIN.entrypointSha256 ||
    provenance.licenseSha256 !== PIN.licenseSha256 ||
    provenance.lockfile !== "package-lock.json" ||
    provenance.lockfileSha256 !== PIN.lockfileSha256 ||
    !exactObject(provenance.securityOverrides, ["nodemailer"]) ||
    !exactObject(provenance.securityOverrides.nodemailer, ["version", "integrity", "reason"]) ||
    provenance.securityOverrides.nodemailer.version !== PIN.nodemailer.version ||
    provenance.securityOverrides.nodemailer.integrity !== PIN.nodemailer.integrity ||
    provenance.securityOverrides.nodemailer.reason !== PIN.nodemailer.reason ||
    provenance.node !== PIN.node
  ) {
    throw new TypeError("vendored Email provenance mismatch");
  }

  const lockBytes = await canonicalRegularFile(path.join(root, provenance.lockfile));
  const entrypointBytes = await canonicalRegularFile(path.join(root, provenance.entrypoint));
  const licenseBytes = await canonicalRegularFile(path.join(
    root,
    "node_modules/@codefuturist/email-mcp/LICENSE",
  ));
  if (
    sha256(lockBytes) !== PIN.lockfileSha256 ||
    sha256(entrypointBytes) !== PIN.entrypointSha256 ||
    sha256(licenseBytes) !== PIN.licenseSha256
  ) {
    throw new TypeError("vendored Email bytes mismatch");
  }

  const lock = parseJson(lockBytes, "lockfile");
  const locked = lock.packages?.["node_modules/@codefuturist/email-mcp"];
  const rootPackage = lock.packages?.[""];
  const runtimePackage = parseJson(
    await canonicalRegularFile(path.join(
      root,
      "node_modules/@codefuturist/email-mcp/package.json",
    )),
    "package",
  );
  const rootDefinition = parseJson(
    await canonicalRegularFile(path.join(root, "package.json")),
    "root package",
  );
  const nodemailer = lock.packages?.["node_modules/nodemailer"];
  if (
    lock.lockfileVersion !== 3 ||
    rootPackage?.dependencies?.[PIN.package] !== PIN.version ||
    rootDefinition?.dependencies?.[PIN.package] !== PIN.version ||
    rootDefinition?.overrides?.nodemailer !== PIN.nodemailer.version ||
    locked?.version !== PIN.version ||
    locked?.resolved !== PIN.resolved ||
    locked?.integrity !== PIN.integrity ||
    locked?.license !== PIN.license ||
    locked?.engines?.node !== PIN.node ||
    runtimePackage.name !== PIN.package ||
    runtimePackage.version !== PIN.version ||
    runtimePackage.license !== PIN.license ||
    runtimePackage.engines?.node !== PIN.node ||
    runtimePackage.bin?.["email-mcp"] !== "./dist/main.js" ||
    nodemailer?.version !== PIN.nodemailer.version ||
    nodemailer?.integrity !== PIN.nodemailer.integrity
  ) {
    throw new TypeError("vendored Email lock mismatch");
  }

  return Object.freeze({
    schema: "bro.email-runtime-vendor-evidence/v2",
    package: PIN.package,
    version: PIN.version,
    integrity: PIN.integrity,
    license: PIN.license,
    upstream_node: PIN.node,
    entrypoint: PIN.entrypoint,
    lockfile_sha256: PIN.lockfileSha256,
    security_overrides: Object.freeze({ nodemailer: PIN.nodemailer.version }),
  });
}
