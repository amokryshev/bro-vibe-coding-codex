# Triggered review gates

Evaluate gate 0 and gates A–J below. Record each as pass, issues, not-applicable,
or not-checked, with evidence or rationale. A gate is pass only when every
triggered check has sufficient evidence; gaps stay not-checked. These gates
measure scoped review controls and do not establish whole-system ASVS compliance.
For risk dispositions use controls.md; acceptance never changes a technical fail.

## Gates

### 0. Output, severity, and secret handling

* Findings first, ordered by severity.
* Each finding has severity, confidence, affected asset, file or artifact,
  evidence, attack path, impact, recommendation, verification, owner, approval
  gate, and residual risk.
* Secret values, tokens, private keys, credentials, and unnecessary sensitive
  data are not quoted.
* Absence of scanner findings is reported as inconclusive outside scanner
  coverage.

Severity labels:

* `Critical`: likely severe compromise or irreversible harm; block unless fixed.
* `High`: exploitable control failure or sensitive exposure; block unless fixed
  or formally accepted by authorized owner.
* `Medium`: plausible security impact requiring mitigation or tracked owner.
* `Low`: defense-in-depth or low-impact issue.

### A. Scope, assets, and trust boundaries

* Assets, actors, attacker types, identities, privileges, trust boundaries,
  entrypoints, data stores, external systems, and sinks are identified.
* Assurance target is explicit or marked missing.
* Review evidence is sufficient to trace source-to-sink or decision-path
  behavior for each material finding.
* Unavailable evidence that affects Critical or High conclusions is a blocker or
  open question.

### B. Authentication, sessions, and tokens

Apply when identity, login, recovery, sessions, cookies, OAuth/OIDC/SAML, API
keys, or bearer credentials are touched:

* Centralized framework or identity-provider controls are preserved.
* Token/session validation covers issuer, audience, expiration, revocation,
  binding, rotation, replay, and privilege-change behavior where applicable.
* Recovery, MFA reset, credential change, and security-setting change flows are
  not weaker than primary authentication.
* Credentials and tokens do not leak through URLs, logs, analytics, errors,
  client state, screenshots, or command arguments.

### C. Authorization, tenant isolation, and privileged operations

Apply when protected resources, roles, permissions, tenants, admin actions,
valuable business operations, exports, batch jobs, or background work are
touched:

* Server-side authorization covers actor, action, object, owner, tenant,
  fields, state, delegation, and risk attributes.
* Client-provided owner, tenant, role, price, balance, entitlement, status, or
  workflow state is not trusted as authority.
* Permission errors, missing policy, stale authorization cache, and unavailable
  security dependency fail closed.
* Privileged or irreversible operations have step-up, audit, confirmation,
  separation, rate limit, or approval control when risk requires it.

### D. Input, canonicalization, and security sinks

Apply when untrusted input reaches parsing, storage, rendering, query, shell,
template, URL, file, serializer, or dynamic execution behavior:

* Validation occurs on the trusted side before business processing.
* Encodings, canonicalization, duplicate/conflicting parameters, boundary sizes,
  nesting, and malformed input are handled deliberately.
* SQL/NoSQL, command, template, HTML, JavaScript, CSS, URL, header, and log sinks
  use safe APIs or contextual encoding.
* Unsafe deserialization, dynamic execution, reflection, raw SQL, shell
  interpolation, and executable templates are absent or explicitly reviewed.

### E. Files, URLs, webhooks, parsers, and async abuse

Apply when uploads, downloads, archives, media, documents, server-side fetch,
callbacks, webhooks, queues, events, or background jobs are touched:

* File and archive handling has type, size, count, path, storage, scanning,
  execution, retention, and download controls.
* URL fetch and redirects restrict scheme, host, port, resolved IP range,
  redirect behavior, timeout, size, and content type where relevant.
* Webhooks verify signature over raw payload, timestamp/expiration, replay,
  idempotency, schema, duplicate delivery, and secret rotation.
* Async work defines authorization context, ordering, duplicate handling,
  replay, retry limits, dead-letter/quarantine, and partial-failure behavior.

### F. Sensitive data, privacy, secrets, and cryptography

Apply when sensitive data, personal data, secrets, keys, certificates,
encryption, signing, hashing, randomness, logging, analytics, export, retention,
deletion, backup, or non-production data use is touched:

* Data purpose, classification, authorized actors, storage, transmission,
  logging, retention, deletion, backup, and export paths are known.
* Sensitive data does not leak through URLs, logs, metrics labels, traces,
  analytics, cache keys, fixtures, screenshots, support dumps, or client bundles.
* Secrets have secure storage, minimum scope, rotation/revocation path, and are
  treated as compromised if exposed.
* Cryptography uses mature mechanisms with defined asset, key owner, lifecycle,
  algorithm, mode, randomness, rotation, and compromise recovery.

### G. Browser, API, and cross-origin controls

Apply when browser, API, web UI, CORS, CSRF, cookies, CSP, redirects,
postMessage, WebSocket, streaming, or public endpoint behavior is touched:

* Cookie, CSRF, CORS, CSP, frame, referrer, content-type, cache, and TLS controls
  are not weakened.
* API errors, status codes, resource existence behavior, pagination, rate
  limits, idempotency, scopes, and object ownership do not leak or bypass access.
* Cross-origin and streaming channels validate origin, authentication,
  authorization, message schema, token lifetime, and rate limits where relevant.

### H. Supply chain, configuration, CI/CD, and deployment

Apply when dependencies, generated artifacts, build pipeline, CI/CD,
infrastructure, container image, deployment config, security config, or runtime
environment changes:

* New or changed dependencies have necessity, maintenance, vulnerability,
  license, provenance, update path, and transitive-risk assessment.
* Build and CI/CD identities have least privilege and do not expose production
  secrets to untrusted code, forks, generated code, or dependency scripts.
* Security configuration has secure defaults, startup validation, reviewable
  storage, and fail-secure behavior.
* Debug mode, sample accounts, default credentials, test endpoints, permissive
  CORS, public storage, or development consoles are not enabled for production.

### I. Security logging, audit, and alerts

Apply when security-sensitive operations, admin actions, sensitive data access,
exports, authentication, authorization, recovery, role changes, key/secret
lifecycle, or security configuration are touched:

* Logs and audit records answer who, did what, to which object, when, from which
  security context, with what result.
* Security events avoid passwords, tokens, private keys, full payment data,
  unnecessary PII, and full sensitive request or response bodies.
* Critical operations have tamper-resistant auditability, actionable alerts,
  owner, severity, and response path where risk requires it.

### J. Verification and risk disposition

* Verification includes legitimate flow and bypass attempts.
* Negative tests or review evidence cover affected roles, tenants, objects,
  fields, invalid input, replay, concurrency, partial failure, and unavailable
  controls where relevant.
* Controls the agent cannot safely verify have manual security verification
  instructions or explicit `not checked` status with residual risk.
* Scanner findings are triaged with owner, rationale, mitigation, and expiration
  when ignored.
* Critical and High findings are fixed, blocked, or formally accepted by an
  authorized owner.

