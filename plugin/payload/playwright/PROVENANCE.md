# Playwright MCP sources

Vendored from npm @playwright/mcp 0.0.50, with pinned Playwright 1.58.0-alpha-2025-11-30 dependencies. Exact integrity hashes and resolved package URLs are in vendor/package-lock.json. Apache-2.0 LICENSE and NOTICE files remain in each package. Upstream package contents are unchanged.

BRO entrypoint isolates browser profiles, temporary data and output under this installation. One MCP server handles local and external targets. Shared system libraries remain external prerequisites; their installation is never silently performed.

## Browser platform payloads

The Publisher build packages Chromium Headless Shell revision 1202 (143.0.7499.25), matching the vendored Playwright registry and the MCP entrypoint's headless mode. `platforms.json` records the official download URLs, exact SHA256 hashes, sizes and executable paths for macOS/Linux x64/arm64. The URLs and paths come from the unchanged `playwright-core/lib/server/registry/index.js` and `browsers.json`; the observed archive hashes were pinned on 2026-10-27. The registry is also published in the [official Playwright source](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/registry/index.ts).

Build downloads missing archives into a Publisher cache and verifies each against its pin. The release preserves every archive byte, including its upstream license files, as chunks no larger than 50 MiB under `platform_specific/<platform>/playwright`. A manifest hashes every chunk and the complete original archive. An explicit empty platform selection creates an external-browser-only release.

Client install receives only its selected platform from the release repository, verifies the manifest and chunks against the bundled source pin, and extracts into owned installation data. Client configuration uses that installed executable or an explicitly selected external browser; it never downloads browser binaries from a CDN. OS/architecture select files; no OS, Node or agent version admission rules are added. A missing platform or unusable executable is an operation error.
