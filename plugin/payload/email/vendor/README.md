# Vendored Email runtime

This directory is the offline production dependency tree for
`@codefuturist/email-mcp@0.2.3`. `package-lock.json` pins every transitive
package and registry integrity. `PROVENANCE.json` pins the selected package,
entry point, upstream license, lockfile, and Node compatibility boundary.

The runtime is never resolved with `npm`, `npx`, global installation, or
ambient `PATH` during Setup or Main. Release assembly copies these bytes into
the product-owned runtime location. Setup binds them into the canonical
Artifact Set and generates a launcher containing the already validated
absolute Node 24 path.

Package-local license and notice files remain beside their corresponding
vendored packages. The root runtime is LGPL-3.0-or-later; its unchanged license
is at `node_modules/@codefuturist/email-mcp/LICENSE`.

The upstream dependency range resolves to vulnerable Nodemailer 8.x.
`package.json` therefore pins the API-compatible `nodemailer@9.0.6` override;
its bytes and the motivating `GHSA-p6gq-j5cr-w38f` advisory are recorded in
`PROVENANCE.json`. The committed production lock reports zero known
vulnerabilities at vendoring time.
