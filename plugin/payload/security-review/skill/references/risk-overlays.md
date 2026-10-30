# Additional risk lenses

These awareness lists are a cross-check for missed scenarios, not a substitute
for any ASVS requirement or a separate compliance claim. Apply relevant rows to
the scoped system; record gaps and supplemental findings separately. The source
editions and exact retrieved bytes are recorded in sources.json.

| OWASP Top 10:2025 | Review route and scenario |
| --- | --- |
| A01 Broken Access Control | ASVS V8, V1.3.6 and authorization controls: foreign objects/tenants, indirect requests, server-side fetch and default denial. |
| A02 Security Misconfiguration | V13, browser/API controls: effective defaults, parser flags, public storage and developer facilities. |
| A03 Software Supply Chain Failures | V13 and BRO-SEC-SUPPLY: transitive artifacts, privileged build inputs, provenance and update path. |
| A04 Cryptographic Failures | V11/V12 and key lifecycle: storage/transport, nonce/key reuse and compromise recovery. |
| A05 Injection | V1/V5: each interpreter and sink, contextual encoding, parsing and path handling. |
| A06 Insecure Design | V2/V15 and threat model: missing trust boundary, valuable workflow, replay and approval bypass. |
| A07 Authentication Failures | V6/V7/V9/V10: registration/recovery/MFA, credentials, sessions and token binding. |
| A08 Software or Data Integrity Failures | V13/V15 and BRO-SEC-DATA/SUPPLY: tampered code/config/data, trusted update origin and authoritative state. |
| A09 Security Logging and Alerting Failures | V16 and inherited audit rules: absent/unsafe events, tamper resistance, alerts and response owner. |
| A10 Mishandling of Exceptional Conditions | V17 and BRO-SEC-ASYNC/STATE: fail-open exceptions, timeouts, partial rollback, unsafe retry and stale owners. |

| API Security Top 10:2023 | Review route and scenario |
| --- | --- |
| API1 Broken Object Level Authorization | V8: same-function access to a foreign object across actor/owner/tenant combinations. |
| API2 Broken Authentication | V6/V7/V9/V10: credential lifecycle, token validation, recovery and session revocation. |
| API3 Broken Object Property Level Authorization | V8/V2: read/write field allowlists and mass assignment of owner, tenant, role, price or state. |
| API4 Unrestricted Resource Consumption | V2/V4/V5/V17, BRO-SEC-CAPACITY: nested queries, expansion, quotas and cost amplification. |
| API5 Broken Function Level Authorization | V8: direct calls to admin/functions, alternate verbs, jobs and batch endpoints. |
| API6 Unrestricted Access to Sensitive Business Flows | V2 and valuable-operation controls: automated purchase/recovery/export, replay and multidimensional limits. |
| API7 Server Side Request Forgery | V1.3.6, file/URL controls: schemes, redirects, resolved addresses, metadata/internal destinations and response bounds. |
| API8 Security Misconfiguration | V3/V4/V13: effective proxy/browser/API configuration, debug output and unnecessary methods. |
| API9 Improper Inventory Management | Threat model and BRO-SEC-DELIVERY: forgotten API versions/hosts, unmanaged endpoints, different rollout security behavior. |
| API10 Unsafe Consumption of APIs | V1/V4/V15 and external-flow controls: distrust third-party payloads, validate signatures/schema, bound calls and verify identity/redirects. |

These routes are authored mappings, not official one-to-one OWASP mappings.
Related infrastructure and CI/CD controls outside ASVS use `BRO-SEC-*` IDs in
controls.md. Mobile/desktop/AI platform-specific standards are outside this
skill's first release; still review their web/API surfaces when included.
