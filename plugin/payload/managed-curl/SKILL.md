---
name: managed-curl
description: Fetch one HTTP or HTTPS URL to stdout using this project's constrained GET command. Use for command-line web retrieval without credentials or response files.
---

Run the configured absolute command from this project or a child directory:

```sh
{{COMMAND}} --silent --show-error 'https://example.com/'
```

The command accepts one explicit HTTP(S) URL. Available flags are `--silent`, `--show-error`, `--fail` or `--fail-with-body`, `--include`, `--ipv4` or `--ipv6`, and `--location`. Short equivalents must be separate arguments. Redirects require `--location` and stop after 10 hops. Optional integer timeouts are `--connect-timeout` (1–60 seconds) and `--max-time` (1–600 seconds).

Response bytes go to stdout; redirecting stdout to a regular file is rejected. Credentials, custom headers, request bodies, output files and retries require ordinary curl with the agent's normal approval. A GET can still have server-side effects; obtain the user's authorization for the requested action. A rejected request is not retried or weakened automatically.
