# Managed Curl

`managed-curl.mjs` is the unchanged first-party No-file GET implementation from the previous Bro Vibe Coding `src/managed-curl/managed-curl.mjs`. The other files implement the BRO-89 project configuration and replace its old Setup State dependency. The release's first-party license applies.

Project authorization checks the canonical project directory and its filesystem identity, this installation's owned configuration, the exact launcher, the packaged runtime and the accepted curl file identity. The tool does not grant automatic host permission. Native agent approval remains applicable independently of the optional permissions tool.
