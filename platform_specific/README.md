# Platform payloads

Tool setup writes release artifacts here as `<os>-<arch>/<tool>/`.
The Playwright setup emits pinned Chromium Headless Shell archives in chunks,
with a manifest and integrity hashes, for each platform selected by the publisher.
The client obtains only the current platform for selected tools from this release;
it does not download browser binaries from the upstream CDN.

Portable JavaScript and text are under plugin/payload. An explicit publisher
`--platforms none` build uses an existing browser executable selected by the client.
