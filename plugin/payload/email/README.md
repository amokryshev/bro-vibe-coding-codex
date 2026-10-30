# Email

The project's Email lifecycle owns preparation, prompts and verification. The
existing BRO setup master invokes it; system installation does not create a
project `.env`. `setup/build.mjs` ships the lifecycle and its payload together.

Choose project configuration in `setup-bro`. Email creates `.env` (mode 600) or
appends only missing required keys as `KEY=""`, preserving user values and comments.
All added values are empty, including ports and TLS flags. Fill it
locally, then choose the connection check. The script verifies MCP startup and
IMAP/SMTP TLS/authentication without sending mail. After success choose Finish.
At every stage, including an active check, choose **Пропустить настройку** to
skip Email and continue other tools. Abort closes the probe's sockets/process.

Example of filled settings (the script creates empty values):

```dotenv
MCP_EMAIL_ADDRESS=user@your-domain.test
MCP_EMAIL_PASSWORD=your-application-password
MCP_EMAIL_IMAP_HOST=imap.your-domain.test
MCP_EMAIL_IMAP_PORT=993
MCP_EMAIL_IMAP_TLS=true
MCP_EMAIL_SMTP_HOST=smtp.your-domain.test
MCP_EMAIL_SMTP_PORT=465
MCP_EMAIL_SMTP_TLS=true
MCP_EMAIL_SMTP_STARTTLS=false
MCP_EMAIL_SMTP_VERIFY_SSL=true
```

SMTP 587 requires `MCP_EMAIL_SMTP_TLS=false` and
`MCP_EMAIL_SMTP_STARTTLS=true`. Certificate verification is mandatory. Optional:
`MCP_EMAIL_SMTP_POOL_ENABLED`, `MCP_EMAIL_SMTP_POOL_MAX_CONNECTIONS`,
`MCP_EMAIL_SMTP_POOL_MAX_MESSAGES`, `MCP_EMAIL_RATE_LIMIT`.
Private destinations require `BRO_EMAIL_PRIVATE_ENDPOINTS`, a comma-separated
list such as `mail.internal:993,mail.internal:465` (IPv6: `[fd00::1]:993`).
Loopback, link-local, multicast and unspecified addresses remain forbidden.

Configuration comes only from the process environment and the target project's
`.env`, with process variables taking precedence. Explicit empty overrides are
invalid rather than falling back to the file. Unrelated project variables are
not passed to the child. Dotenv is data, never shell code; quoted values and
comments are supported. Duplicate Email keys and malformed syntax need fixing.
A complete process environment avoids a fill prompt; the installer still creates
a missing template without copying secrets. With environment-only configuration,
provide the same variables to the host/MCP launcher on subsequent starts.

Without a TTY, complete settings are checked automatically; missing or invalid
settings fail without waiting for input. Set `BRO_EMAIL_SETUP=skip` in the
installer environment to explicitly skip. This variable only controls setup.

Each new MCP launch rereads current settings, checks its canonical project and
requires its private runtime directory. JSON/TOML account files are never a
fallback. `email.accountFile` and the old launcher `--config` are unsupported:
configure the project again from env/`.env`. Only after native publication
succeeds is BRO's owned old `account.json` removed. Foreign or edited copies are
not deleted automatically. The user's original account file is preserved.

A failed or skipped repeat preserves the previous registration, but not an old
credential snapshot: user edits to `.env` remain effective on the next launch.
The `.env` is user-owned and is not archived/deleted by BRO cleanup. Do not commit
secrets or put them in chat/command arguments. Native MCP declarations and setup
reports contain no credentials. Runtime data is isolated per project and removed
by its lifecycle. Host project trust and tool approvals continue to apply.

The bundled third-party runtime is `@codefuturist/email-mcp@0.2.3` with
`nodemailer@9.0.6`. The unchanged upstream production tree, lock, provenance and
package licenses are in `vendor/`; its LGPL license is
`vendor/node_modules/@codefuturist/email-mcp/LICENSE`. The matching TypeScript
source and build scripts are supplied in `email-mcp-0.2.3-source.tar.gz` at the
exact npm `gitHead` recorded in `SOURCE.json` and the registry metadata. The
archive SHA-256 identifies the supplied source bytes. These files can be
replaced by a compatible version; BRO has no license-key or anti-replacement gate.

`server.mjs` composes its existing mail tools/services without the upstream CLI's
automatic scheduler, watcher, sampling hooks, local calendar, notifications or
template storage. Every registered operation is an explicit MCP call. This is a
first-party composition; upstream files are unchanged. `network-policy.mjs` and
`connection-probe.mjs` retain the prior BRO destination and TLS/auth rules;
release-binding, recovery and Node-version allowlists are removed.
The upstream package's engine declaration remains provenance, not a BRO version
gate. Failure to start on a particular Node runtime is reported as an operation
failure. No claim of successful mail authentication follows from MCP discovery.
