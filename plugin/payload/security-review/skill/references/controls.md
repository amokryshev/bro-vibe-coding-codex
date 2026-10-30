# Inherited security controls

These are product-control expectations inherited from the Publisher's security
policy. Apply them as review questions to triggered surfaces, not as permission
to implement changes. "Use", "MUST implement" and similar wording below mean
verify the product's actual mechanism and recommend a correction where absent.
Always bind the result to the original ASVS requirement where one applies.
Stricter inherited rules and controls outside ASVS are supplemental `BRO-SEC`
requirements; never describe them as an OWASP requirement without an ASVS ID.

For every triggered topic inspect implementation, authoritative configuration,
negative behavior and evidence. Unknown applicability remains visible. A missing
or unavailable protective dependency must not yield a permissive conclusion.

## Security Rules

### Threat Model

High-risk change MUST определить:

```text
Threat:
Affected asset:
Attack path:
Security control:
Verification:
Residual risk:
```

Threat model MUST учитывать anonymous attacker, malicious authenticated user,
cross-tenant user, compromised account или session, malicious или compromised
administrator, compromised dependency, compromised external service, insider с
limited access, replay, reordering, automation и security dependency failure,
когда применимо.

Изменение trust boundary, public endpoint, sensitive data type или privileged
operation требует обновления threat model.

### Security Invariants

Security-sensitive design MUST сохранять:

* Deny by default: absent, invalid или unavailable security configuration
  приводит к отказу access.
* Complete mediation: каждый request, job, event, object reference и trust
  boundary crossing проверяется.
* Least privilege: users, services, processes, CI jobs и integrations получают
  минимальные actions, data scope, duration и network access.
* Secure by default: new functionality, accounts, endpoints, storage и
  integrations являются private или restricted, если explicitly не opened.
* Fail securely: timeout, exception, partial response или unavailable dependency
  не bypass control.
* Defense in depth: critical assets не зависят от single fragile control.
* Minimize attack surface: unused endpoints, methods, parsers, privileges,
  dependencies и admin interfaces удаляются или отключаются.
* Assume compromise: blast radius ограничен, а detection, revocation и recovery
  возможны.
* No security through obscurity: secret URL, identifier, schema или
  implementation detail не являются control.

### Trust Boundaries and Input

All data вне current trusted component MUST считаться untrusted, включая request
data, headers, cookies, tokens, filenames, user-created database values, cache
entries, queue messages, webhook payloads, external API responses, mutable
configuration, URLs, redirects и signed или encrypted data до integrity и
semantic validation.

Validation MUST выполняться на trusted side до business processing и SHOULD
определять schema, type, format, allowlisted values, length, numeric range,
collection cardinality, nesting depth, total size, relationships и allowed
workflow state.

Invalid, ambiguous или unexpectedly encoded input SHOULD отклоняться, а не
silently corrected. Parser и expensive operations, exposed to attacker input,
MUST иметь limits для bytes, objects, nesting, recursion, decompressed size,
processing time, memory, concurrency и external references.

### Injection and Sinks

Validation не заменяет safe sink usage.

Agent MUST использовать parameterized queries, typed query APIs, argument arrays
для shell commands, contextual auto-escaping, context-specific output encoding,
structured serializers и allowlisted identifiers для dynamic table, column,
field или sort names.

Untrusted data MUST NOT попадать в eval-like execution, shell interpreter,
source code generation, executable templates, dynamic imports, unsafe
reflection, raw SQL, unsafe deserialization или HTML/JavaScript/CSS/URL context
без correct contextual handling.

Rich HTML требует explicit product requirement и mature allowlist-based HTML
sanitizer. CSP является defense-in-depth, а не заменой output encoding и safe
DOM APIs.

### Identity, Sessions, and Tokens

Authentication, session management, OAuth/OIDC/SAML и token handling MUST
использовать centralized framework, platform или identity-provider mechanisms.

Authentication и recovery responses MUST NOT раскрывать account existence,
credential detail, account state, internal provider или useful policy detail.

MFA, reauthentication или step-up authentication MUST защищать administrators,
privileged operations, high-value transactions, security setting changes, access
to highly sensitive data и credential или recovery-method changes, когда
применимо.

Passwords MUST использовать adaptive password hashing, unique salt, approved
work factor, long passphrase support, no silent truncation, protected transport
и no plaintext or reversible storage.

Recovery tokens MUST быть high-entropy, single-use, short-lived, safely stored,
attempt-limited, invalidated after use и уведомлять account owner.

Account recovery MUST NOT быть слабее primary authentication flow. Recovery
destination changes MUST быть protected as security setting changes. MFA reset и
recovery codes MUST обрабатываться как credentials. Password, recovery-method,
MFA и other security-factor changes SHOULD revoke affected sessions and bearer
credentials, когда применимо.

Session identifiers и bearer credentials MUST иметь high entropy, не содержать
business data или PII, не попадать в URLs/logs/analytics/errors и использовать
secure transport и cookie attributes, где применимо. Session ID MUST rotate
после authentication, reauthentication, privilege change или account recovery.

OAuth/OIDC/SAML и security tokens MUST validate signature, allowed algorithm,
issuer, audience, expiration, not-before, nonce/state, PKCE, redirect URI, token
type, scopes и subject binding, где применимо. Unsigned tokens, attacker-chosen
algorithms и audience confusion запрещены.

### Authorization and Tenant Isolation

Authentication не заменяет authorization.

Authorization MUST проверяться server-side для каждой protected operation и
resource, включая UI, API, background jobs, exports, batch operations, internal
endpoints, webhooks, admin tools и direct object storage access.

Authorization MUST учитывать actor, action, object, object owner, tenant,
requested fields, current object state, delegation и relevant risk attributes.

Tenant и owner context MUST приходить из trusted identity context или
проверяться against it. Object identifier, route, UI state или request-provided
tenant не являются proof of access.

Policy errors, missing policy и inability to verify permission MUST deny.

Role, permission и tenant changes MUST invalidate affected sessions, tokens,
authorization caches и delegated access, где применимо.

User-controlled input MAY update только explicitly allowlisted bindable fields.
Security-relevant и business-critical values, including owner, tenant, role,
permission, price, balance, entitlement, status и workflow state, MUST быть
computed или validated by trusted server-side code.

### Privileged and Valuable Operations

Privileged и valuable business operations SHOULD использовать dedicated roles,
step-up authentication, just-in-time privilege, short privileged session
lifetime, explicit confirmation, separation of duties, two-person approval для
critical actions, immutable audit trail и restricted network или device context,
когда risk этого требует.

Workflow implementation MUST enforce server-side state transitions, allowed
actors, irreversible transitions, replay behavior, limits, concurrent request
handling и server-side computation of price, balance, entitlement, ownership,
status или permission values.

Rate limits и abuse controls SHOULD защищать recovery, invitations, referrals,
coupons, exports, verification messages, expensive search и другие valuable или
expensive operations, а не только login.

Rate limits SHOULD учитывать multiple dimensions, например account, IP/network,
device, tenant, resource и system load. Account-level lockout или throttling
SHOULD быть designed так, чтобы не создавать easy denial-of-service против
чужого account.

### Sensitive Data and Privacy

Перед processing sensitive data определи classification, purpose, authorized
actors, storage locations, transmission paths, retention, deletion, backup
behavior и permitted logging или analytics.

Sensitive data MUST NOT без explicit need попадать в URLs, query parameters,
browser history, referrer, logs, metrics labels, traces, analytics, exception
messages, token claims, client-controlled state, cache keys, fixtures,
screenshots или support dumps.

Protection MUST покрывать primary storage, caches, queues, search indexes,
analytics stores, temporary files, backups, exports, replicas, development и
test environments.

Production sensitive data MUST NOT копироваться в non-production environments
без explicit approval, minimization, masking или synthetic replacement, access
controls и retention limits.

Exports MUST использовать те же authorization, tenant isolation, rate limits и
audit requirements, что interactive access. Sensitive responses требуют safe
cache controls.

Deletion design MUST учитывать derived data, replicas, backups, caches и
external processors; limitations MUST быть documented.

### Cryptography, Keys, and Secrets

Custom cryptographic algorithms и protocols запрещены.

Cryptographic design MUST определять asset, attacker capabilities, algorithm и
mode, key ownership, key scope, lifecycle, rotation, revocation, versioning,
backup и compromise recovery.

Используй mature libraries, approved algorithms и parameters, CSPRNG для
security-sensitive randomness, authenticated encryption когда confidentiality и
integrity required, и correct signature или MAC verification.

Keys SHOULD храниться в KMS, HSM или dedicated key-management system. Один key
SHOULD NOT переиспользоваться для разных purposes, tenants или trust domains без
documented reason.

Leaked secret считается compromised и MUST быть revoked или rotated, а не только
removed из current code version.

### Transport, Browser, and Cross-Origin Security

Sensitive и authenticated communication MUST использовать correctly configured
TLS end to end. Plaintext fallback, disabled certificate validation, hostname
mismatch ignore, expired или untrusted certificate acceptance и production
accept-any-certificate modes запрещены.

Web applications SHOULD применять relevant browser controls: HSTS, restrictive
CSP, frame-ancestors или clickjacking protection, X-Content-Type-Options,
Referrer Policy, Permissions Policy, secure cookie attributes и cache
restrictions для sensitive responses.

Cookie-authenticated state-changing requests MUST иметь CSRF protection.
`SameSite` является defense-in-depth и MUST NOT считаться universal replacement
для CSRF token или origin validation.

CORS не является authentication или authorization. CORS MUST использовать
explicit origin allowlist, MUST NOT reflect arbitrary Origin, MUST NOT combine
wildcard origin with credentials и MUST allow только necessary methods и
headers.

Redirect и return URL MUST быть relative или exactly allowlisted. `postMessage`,
WebSocket и streaming channels требуют origin, authentication, authorization,
message validation, token lifetime и rate-limit controls, где применимо.

### Files, URLs, Webhooks, and Parsers

File upload является untrusted content processing. Upload flow MUST определить
allowed actors, readers, formats, max size, max count, storage location,
retention, scanning, processing и download behavior.

User filename MUST NOT быть storage path. File type checks SHOULD combine
extension, declared content type, magic bytes и parser result. Uploaded files
SHOULD храниться outside webroot, without execute permission и with minimal
permissions.

Archive extraction MUST защищать от path traversal, absolute paths, symlinks,
excessive file count, excessive expanded size, nested archives, decompression
bombs и overwrites.

Server-side URL fetch SHOULD использовать destination allowlist. URL handling
MUST restrict schemes, ports, hostnames, resolved IP ranges, redirects, response
size, content type, timeout и connection count; access к loopback, link-local,
private networks, cloud metadata, internal admin services, local files и
unexpected protocols MUST быть blocked, если explicitly не required и reviewed.

Webhook receiver MUST verify cryptographic signature over raw payload, timestamp
или expiration, replay protection, payload size, schema, duplicate delivery
idempotency и secret rotation. IP allowlist alone insufficient, когда provider
signatures существуют.

Unsafe native object deserialization запрещена для untrusted input. XML parsers
MUST disable external entities, DTD processing, network access и external schema
resolution, если explicitly не required и reviewed.

### Security Configuration and Supply Chain

Security-relevant configuration MUST иметь secure defaults, startup validation,
reviewable storage, no plaintext secrets и fail-secure behavior when invalid.

Production MUST NOT включать debug mode, user-visible stack traces, sample
accounts, default credentials, test endpoints, directory listing, unnecessary
HTTP methods, development consoles, permissive CORS или public storage by
default.

New dependency MUST иметь necessity, active maintenance, acceptable security
history, compatible license, update path и transitive dependency assessment.

Packages и build artifacts MUST приходить только из approved или repository
configured sources. Dependencies SHOULD фиксироваться lockfile или equivalent
reproducible mechanism, and integrity/provenance SHOULD проверяться where
ecosystem supports it.

Vulnerability и integrity scanning SHOULD охватывать direct и transitive
dependencies, base images, build tools, generated artifacts и runtime
components, когда они входят в delivery surface.

Build и CI/CD pipelines являются privileged systems. Untrusted pull requests,
forks, generated code или dependency scripts MUST NOT получать production
secrets. Pipeline identities требуют minimum permissions, minimum lifetime и
environment separation.

Security scanner findings требуют risk assessment. Ignoring finding требует
owner, rationale, mitigation и expiration.

### Security Logging, Audit, and Alerts

Security logging SHOULD отвечать, кто действовал, над каким object, какое action
выполнялось, когда, из какого security context, с каким result и какая policy
или control повлияли на decision.

Логируй applicable authentication events, MFA и recovery events, session
creation и revocation, authorization denials, role changes, admin actions,
security configuration changes, sensitive data access и export, rejected
signatures или tokens, apparent tampering, replay, dependency или integrity
failures и key или secret lifecycle events.

Logs MUST NOT содержать passwords, session identifiers, access или refresh
tokens, reset tokens, private keys, client secrets, full payment credentials,
unnecessary PII или full sensitive request/response bodies.

Critical operations SHOULD иметь append-only или tamper-evident audit trail и
actionable alerts с owner, severity, response procedure и controlled
false-positive rate.

## Security Verification

High-risk change MUST иметь security acceptance criteria и verification, которая
проверяет bypass attempts, а не только legitimate flow.

Applicable checks включают:

* authorization matrix по roles, objects, actions и tenants;
* negative tests;
* alternate HTTP methods и content types;
* missing, duplicate и conflicting parameters;
* boundary, oversized и deeply nested input;
* encoding и canonicalization variants;
* direct object reference manipulation;
* mass assignment;
* replay, expired и revoked credentials;
* session fixation, CSRF и cross-origin behavior;
* concurrent execution и workflow reordering;
* partial failure и unavailable security dependency;
* injection в every used sink;
* sensitive data leakage через logs, errors, URLs и analytics;
* malicious files, archives, URLs и parser input.

Security-sensitive code SHOULD получать manual review с trace от untrusted
sources до security-relevant sinks. Automated controls MAY включать SAST,
dependency scanning, secret scanning, IaC scanning, DAST, fuzzing, API schema
testing и artifact integrity checks.

Scanner finding не является proof of vulnerability без analysis. Absence of
findings не является proof of security.


## Supplemental delivery and integrity checks

Apply these to affected infrastructure, jobs, migrations and operator procedures:

- **BRO-SEC-SPECIALIST**: custom authentication/token/password/session mechanisms,
  sanitizers and untrusted-input parsers require specialist assessment. Inspect
  the security design, threat model, independent assessment and verified scope;
  recommend mature platform mechanisms. A missing assessment is an explicit gap,
  not permission for this reviewer to implement or accept an exception.
- **BRO-SEC-STATE**: inspect fencing tokens, lease ownership/expiry and ownership
  changes for distributed work; prevent a stale worker from committing after a
  newer owner. Inspect cache key isolation, consistency model, TTL, invalidation,
  bounds and stale-permission behavior. Challenge expired leases, duplicate
  owners and stale cache entries using synthetic state. Transactions must have
  bounded duration and correct rollback/compensation; avoid unbounded work or
  network I/O while holding transaction locks. Retries need explicit retryable
  error classification, transient-only retry and finite limits; permanent auth
  or validation errors must not become repeated privileged actions. Evidence:
  state/transaction code, effective limits, controlled stale-worker/retry traces.
  Include owner crash/recovery, cancellation, terminal failure and observability.
  Replay must be safe or protected by idempotency. A cache needs an authoritative
  source, size limit, outage behavior and metrics. Duplicated business rules need
  an explicit purpose, owner, consistency model and reconciliation/update path.
  Network coordination inside a transaction needs an explicit bounded strategy.
- **BRO-SEC-CAPACITY**: for hot paths, attacker-controlled collections and growing
  data inspect complexity, query counts/plans/indexes, result limits, dataset
  size, I/O, memory, concurrency, contention, capacity and cost. Evidence:
  query plans, effective limits and bounded synthetic load observations. A
  missing resource bound or attacker-amplifiable cost is a finding when proven;
  production-scale effects without measurements remain an explicit uncertainty.

- **BRO-SEC-ASYNC**: trace identity/tenant binding across queues and workers;
  inspect bounded retries, backoff, idempotency, ordering, dead-letter/quarantine,
  cancellation, timeouts, backpressure, duplicate delivery and partial failure.
  Challenge duplicate/reordered events and unavailable authorization. Pass only
  when no duplicate valuable effect or unauthorized processing occurs; absent
  execution evidence remains unchecked/inconclusive. Evidence: worker source,
  queue/retry configuration and synthetic failure/replay observations.
- **BRO-SEC-DATA**: identify authoritative data owner and transaction boundary;
  each transaction must correspond to one atomic business operation, with its
  invariants committed together or rolled back together;
  inspect database constraints/locks and stale, concurrent, malformed, missing
  or legacy records. For migrations/backfills inspect safe repetition, batching,
  lock duration, resumability, rollback/forward-fix and partial failure. Evidence:
  schemas, migration plan, bounded synthetic replay and recovery results. A test
  passing on one empty database does not prove production-size safety.
- **BRO-SEC-DELIVERY**: inspect least-privilege operator identities, rollback and
  restore evidence, backup retention/encryption/access, monitoring/alert owners,
  key compromise response, secrets in command arguments and blast radius.
  Commands proposed for production remain manual instructions, never executed
  by this review. Pass requires current configuration and relevant safe operator
  evidence; missing restore/rotation records are verification gaps.
  Include mixed-version compatibility, rollout/rollback stages, security flags,
  health signals and failure recovery. Check that feature flags cannot silently
  disable a security control and that rollout health checks observe the relevant
  failure mode. Test plans must cover old/new version combinations and partial
  rollout, not only the fully upgraded state.
  Configuration has an authoritative source, startup validation, safe defaults,
  invalid-value behavior, documented rollout/rollback and observable effective
  state. Flags need owner, monitoring, safe failure, removal/revisit condition
  and rollback/forward-fix. Health/readiness/liveness must not report healthy for
  an operation the component cannot safely perform; signal scope is explicit.
- **BRO-SEC-SUPPLY**: review dependency necessity, maintenance, vulnerability
  history, license, transitive dependencies, configured sources, integrity,
  reproducibility and update/rollback path. Inspect privileged CI inputs and
  whether untrusted forks/dependency hooks can reach secrets. Use pinned
  CI/CD Security, Infrastructure as Code and Vulnerable Dependency Management
  Cheat Sheets from the source bundle. Missing provenance or scan coverage is
  not a clean result. Record mitigations, exception owner and expiry.
- **BRO-SEC-CRYPTO**: the inherited policy excludes custom cryptographic
  algorithms/protocols. Flag such mechanisms and recommend mature mechanisms
  and specialist review. This stricter policy is separate from ASVS compliance;
  specialist advice alone does not authorize the reviewer to accept risk.

For each supplemental item record applicability, concrete inputs, method,
negative case, result and evidence using the same record rules as ASVS. Keep
supplemental coverage and denominators separate from the ASVS catalog.

## Risk and legacy adaptations

Critical: likely severe compromise or irreversible harm; retain a management
blocker pending verified correction. High: exploitable control failure or
sensitive exposure; retain a blocker unless the authorized owner has documented
acceptance. Medium: plausible impact needing mitigation/owner. Low: limited
impact or defense in depth. State confidence with evidence and uncertainties.
Owner acceptance of any severity is recorded, never changes control failure or
ASVS compliance, and never constitutes this reviewer's release approval.

Legacy instructions disagree on whether owner acceptance removes a Critical
blocker. Preserve the acceptance record and the stricter blocker separately.
Legacy implementation permissions become review questions and recommendations;
legacy role routers, task gates and context-refresh workflows become the local
inventory/procedure. Stop conditions limit unsafe execution or unsupported
conclusions, while safe defensive analysis continues.
For inherited MUST exceptions require an explicit authorized decision; SHOULD
exceptions need rationale, residual risk, owner and revisit/removal condition.
Record such decisions as evidence; they do not change the original ASVS result.
Prefer fail-closed, reversible recommendations. In change review distinguish
introduced issues from pre-existing issues and mark findings outside scope.
