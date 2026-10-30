# Review record contract

The JSON record is the maintained source of review state. Render a concise human
report from it. Catalog/matrix, review execution, and product compliance are
different measurements; never use one percentage for all three.

## Identity and inputs

`node scripts/review.mjs new request.json` emits an unverified record. The request
contains `reviewId` and a `target` object:

- `identity`, `revision`, `scope`: nonempty object/version/boundary descriptions;
- `mode`: `scoped-review` or `full-assessment`;
- `version`: `5.0.0`; `level`: 1, 2, or 3;
- `confirmed`: boolean, reflecting actual user context;
- `surfaces`: nonempty array of `{id, description}`; explicitly inventory entry
  points, roles, tenants and protected objects, or justify shared-control groups;
- `selectedRequirements`: scoped-review IDs; full-assessment selects all norms
  at the target level. Omitted scoped selection leaves no implicit full audit.

The generated record uses `bro.security-review.record/v1` and includes the
skill fingerprint, catalog/matrix digests, target, evidence, rows, findings,
supplemental controls, manual checks, risks, threat model, limitations,
capabilities and continuation. `inventoryComplete` starts false. Set it true
only after the declared system's surfaces and requirements have been accounted
for; a small supplied file set is not evidence of completeness.
Record `reviewer` identity, overall confidence, security-control changes and
gate 0/A–J statuses with evidence/reasons. `secretsObserved` contains safe
categories/locations only, never values. `openQuestions` and `checksReviewed`
distinguish missing evidence from non-applicability and reviewed test source
from actual execution.

## Evidence

Each evidence object has `id`, `kind`, `locator`, `targetRevision`, `observedAt`,
`summary`, `obligationIds` and `surfaceIds`. Use unique IDs. Locator identifies a
file and lines/config field or an actual test/operator result. Summary describes
the observed fact without secrets. Record method/tool version and limitations in
the summary or additional fields. Evidence links must refer to the same target
revision, obligation and surface as the assessment row. A source file may prove
a static property; it does not prove an unexecuted runtime or operational check.

A test file is not a test run. A scanner report for another build, another scope,
an unsuccessful run or unsuitable configuration does not support a current
pass. A supplied operator report needs identity, revision, scope and sufficient
observations. Evidence truth and adequacy remain the reviewer's responsibility.

## Assessment rows

Each row binds `requirementId`, `obligationId`, `surfaceId`, `selection`,
`applicability`, `result`, `evidenceIds` and `rationale`.

| Dimension | Values and rules |
| --- | --- |
| selection | `selected`, `outside-scope`, `above-target`. Keep every catalog obligation visible. Higher-level enhancements remain above-target at a lower level. |
| applicability | `applicable`, `not-applicable`, `unknown`. N/A needs evidence of the absent condition or eligible alternative. Unknown is not N/A. |
| result | `pass`, `fail`, `unchecked`, `inconclusive`. Pass/fail require selected + applicable and current evidence. |

`unchecked`: no adequate subject-specific check has run or usable inputs are
absent. `inconclusive`: a performed check leaves insufficient/conflicting
evidence. Both require a reason and next evidence to obtain. Nonselected and N/A
rows keep `unchecked` for control verification; evidence for N/A is separate
from a control pass. Unknown allows unchecked/inconclusive only.

Evaluate every mandatory constituent at the requested level. One failed AND
part prevents the whole requirement passing; one unverified part prevents pass
without claiming an unproven failure. For an OR, preserve the selected allowed
branch and its evidence; the alternatives are not extra mandatory controls.
Shared controls require evidence that they govern all represented surfaces.
An obligation with `maxLevel` stays visible at a higher target level: evaluate
its normative condition and document why that retired branch is N/A; then
evaluate the stronger replacement. Do not silently remove the whole parent
requirement or assume that a lower-level alternative remains allowed.

## Compliance and coverage

The helper recomputes `summary` and checks the declared `conclusion`:

1. Scoped review or unconfirmed target → `not-assessed` for the whole application.
2. Full assessment with confirmed target and an in-target demonstrated failure
   → `not-satisfied`; still report everything unfinished.
3. Otherwise, incomplete inventory, unknown applicability, or selected applicable
   unchecked/inconclusive → `incomplete`.
4. `satisfied` requires a complete accounted target, substantiated N/A, and pass
   for every applicable obligation on every surface. The record must validate.

Above-target and supplemental findings remain visible without changing the
denominator of the selected ASVS level. A malformed, omitted or duplicate row
is a validation error, not proof of completeness. No empty-record shortcut.

Counts include total rows, selection, applicability and result counts, selected
rows, selected applicable rows, verified applicable rows and pass rows. The
verification fraction is `(pass + fail) / selected applicable`; the pass fraction
is `pass / selected applicable`; report zero denominators as undefined. Always
show unknown applicability, N/A, nonselected exclusions and inventory gaps.
Matrix coverage counts refer to procedure support, not completed product checks.

## Findings and risk

Each finding has `id`, `severity` (Critical/High/Medium/Low), `confidence`,
`asset`, `location`, `requirementIds`, `evidenceIds`, `attackPath`,
`brokenControl`, `impact`, `recommendation`, `verification`, `owner`,
`approvalGate` and `residualRisk`. State unknown owners explicitly. Use the
severity guidance in controls.md; distinguish demonstrated findings from open
questions. Recommendations identify a concrete control and a testable repair.

Risk records identify the owner, basis, affected findings, scope, compensations
and expiry/review condition. Acceptance never rewrites fail to pass, makes a
requirement N/A or grants release authority. Include the management blocker
disposition separately from ASVS compliance, especially for Critical findings.

Use risk fields `id`, `owner`, `rationale`, `scope`, `compensations`,
`reviewCondition`, `findingIds`, and `disposition` (`accepted`, `unaccepted`,
`unknown`, `fixed`). Cite the actual owner's acceptance record in the rationale;
the reviewer cannot create that acceptance. Supplemental checks use `id`
(`BRO-SEC-*`), `scope`, `method`, `negativeScenario`, `applicability`, `result`,
`evidenceIds`, `rationale`, and `nextAction`.

## Manual verification

Each unresolved operator check states: prerequisite/access; operator; exact
authorized target; finite steps and limits; safe synthetic identities/data;
observations expected for pass/fail; evidence to return without secrets; linked
obligations/surfaces; cleanup and stop conditions. Leave the associated rows
unchecked/inconclusive until returned results are assessed for scope, revision
and adequacy. Do not describe proposed commands as performed checks.

JSON fields: `id`, `prerequisite`, `operator`, `target`, `limits`, `steps`
(nonempty string array), `expectedPass`, `expectedFail`, `evidenceNeeded`,
`cleanup`, `obligationIds`, `surfaceIds`, and `status` (`pending`, `received`,
`assessed`). Put stop conditions in `limits` and synthetic data in `prerequisite`.

`gateStatuses` contains exactly gates `0`, `A`–`J`, each with `id`, `status`
(`pass`, `issues`, `not-applicable`, `not-checked`), `rationale`, and `evidenceIds`.
Every decided gate needs evidence. `checksReviewed` entries contain
`description`, `performed` (boolean), and `evidenceIds`; performed needs actual
execution evidence. `openQuestions`, `limitations`, and `secretsObserved` are
string arrays. `threatModel` contains string arrays `assets`, `actors`,
`trustBoundaries`, `sensitiveData`, `flows`, and `abuseCases`. `capabilities` has
boolean `analysis`/`localExecution` and string-array `constraints`.

## Continuation and output

Save completed/pending obligation IDs, evidence, target and input fingerprints,
open assumptions and the next action. On target/source/control/dependency
changes, reassess affected rows; unknown impact invalidates inherited passes.
The validator rejects mismatched skill/catalog/matrix identities. Re-evaluate
old evidence before creating a record for a new revision; do not simply replace
its fingerprints. If interrupted, return the actual partial record.

Human output: findings by severity; target/mode/level/revision; assets, actors,
trust boundaries and sensitive-data categories; affected authn/authz controls;
counts and denominators; evidence and performed checks; N/A reasons, unknowns,
skipped methods and uncovered surfaces; manual instructions; accepted risk,
management blockers, residual risk/owners and next steps. Keep secret values out
of all representations. Neither a valid record nor completed examples implies
OWASP certification or absence of every possible vulnerability.
